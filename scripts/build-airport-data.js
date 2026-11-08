#!/usr/bin/env node
// Validates airports/*.yaml and regions/schengen.yaml, then generates:
//   packages/core/src/data/airport-data.generated.js  (runtime data for the engine)
//   airports/COVERAGE.md                               (human-readable provenance report)
//
// Usage:
//   node scripts/build-airport-data.js           validate + write generated files
//   node scripts/build-airport-data.js --check   validate + fail if generated files are stale

const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");

const root = path.resolve(__dirname, "..");
const airportsDir = path.join(root, "airports");
const schengenFile = path.join(root, "regions", "schengen.yaml");
const generatedModule = path.join(root, "packages", "core", "src", "data", "airport-data.generated.js");
const coverageReport = path.join(airportsDir, "COVERAGE.md");
const checkOnly = process.argv.includes("--check");

const ALLOWANCE_KEYS = ["base_transfer", "passport_control", "terminal_change", "security_rescreening"];
const BASES = ["heuristic", "sourced"];
const AIRPORT_KEYS = ["iata", "name", "country", "timezone", "last_reviewed", "allowances", "facts", "sources"];
const FACT_KEYS = ["id", "claim", "source", "scope", "minimum_connection_minutes", "applies_when"];
const SOURCE_KEYS = ["title", "publisher", "url", "retrieved", "published", "note"];
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_ALLOWANCE_MINUTES = 240;

const errors = [];
function fail(file, message) {
  errors.push(`${path.relative(root, file)}: ${message}`);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function checkKeys(file, where, object, allowed) {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) fail(file, `${where}: unknown field "${key}"`);
  }
}

function isTimeZone(value) {
  if (typeof value !== "string" || !/^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function readYaml(file) {
  try {
    // Core schema keeps dates as plain strings and rejects YAML 1.1 surprises
    // such as `NO` being read as false.
    return YAML.parse(fs.readFileSync(file, "utf8"), { schema: "core", uniqueKeys: true });
  } catch (error) {
    fail(file, `invalid YAML: ${error.message}`);
    return null;
  }
}

function validateSources(file, sources) {
  if (!isPlainObject(sources)) {
    fail(file, "sources must be a mapping of source id → source");
    return {};
  }
  for (const [id, source] of Object.entries(sources)) {
    const where = `sources.${id}`;
    if (!ID_PATTERN.test(id)) fail(file, `${where}: id must be lowercase-kebab-case`);
    if (!isPlainObject(source)) {
      fail(file, `${where}: must be a mapping`);
      continue;
    }
    checkKeys(file, where, source, SOURCE_KEYS);
    for (const key of ["title", "publisher"]) {
      if (typeof source[key] !== "string" || !source[key].trim()) fail(file, `${where}.${key} is required`);
    }
    if (typeof source.url !== "string" || !/^https:\/\/\S+$/.test(source.url)) fail(file, `${where}.url must be an https URL`);
    if (!isIsoDate(source.retrieved)) fail(file, `${where}.retrieved must be a YYYY-MM-DD date`);
    if (source.published !== undefined && !isIsoDate(source.published)) fail(file, `${where}.published must be a YYYY-MM-DD date`);
    if (source.note !== undefined && typeof source.note !== "string") fail(file, `${where}.note must be text`);
  }
  return sources;
}

function validateFacts(file, facts, sources) {
  if (!Array.isArray(facts)) {
    fail(file, "facts must be a list");
    return [];
  }
  const seen = new Set();
  facts.forEach((fact, index) => {
    const where = `facts[${index}]`;
    if (!isPlainObject(fact)) {
      fail(file, `${where}: must be a mapping`);
      return;
    }
    checkKeys(file, where, fact, FACT_KEYS);
    if (!ID_PATTERN.test(fact.id || "")) fail(file, `${where}.id must be lowercase-kebab-case`);
    else if (seen.has(fact.id)) fail(file, `${where}.id "${fact.id}" is duplicated`);
    seen.add(fact.id);
    if (typeof fact.claim !== "string" || !fact.claim.trim()) fail(file, `${where}.claim is required`);
    if (!Object.hasOwn(sources, fact.source)) fail(file, `${where}.source "${fact.source}" is not defined in sources`);
    if (fact.scope !== undefined && typeof fact.scope !== "string") fail(file, `${where}.scope must be text`);
    if (fact.minimum_connection_minutes !== undefined) {
      if (!Number.isInteger(fact.minimum_connection_minutes) || fact.minimum_connection_minutes <= 0) {
        fail(file, `${where}.minimum_connection_minutes must be a positive whole number of minutes`);
      }
      // A published minimum connection time always belongs to some airline or route type.
      if (!fact.scope) fail(file, `${where}.minimum_connection_minutes needs a scope: whose minimum connection time is it?`);
    }
    if (fact.applies_when !== undefined) validateAppliesWhen(file, `${where}.applies_when`, fact.applies_when);
  });
  for (const id of Object.keys(sources)) {
    if (!facts.some((fact) => fact && fact.source === id)) fail(file, `sources.${id} is not used by any fact`);
  }
  return facts;
}

function validateAllowances(file, allowances, facts) {
  const factIds = new Set(facts.map((fact) => fact && fact.id));
  if (!isPlainObject(allowances)) {
    fail(file, "allowances must be a mapping");
    return null;
  }
  checkKeys(file, "allowances", allowances, ALLOWANCE_KEYS);
  const result = {};
  for (const key of ALLOWANCE_KEYS) {
    const allowance = allowances[key];
    const where = `allowances.${key}`;
    if (!isPlainObject(allowance)) {
      fail(file, `${where} is required`);
      continue;
    }
    checkKeys(file, where, allowance, ["minutes", "basis", "facts"]);
    if (!Number.isInteger(allowance.minutes) || allowance.minutes < 0 || allowance.minutes > MAX_ALLOWANCE_MINUTES) {
      fail(file, `${where}.minutes must be an integer between 0 and ${MAX_ALLOWANCE_MINUTES}`);
    }
    if (!BASES.includes(allowance.basis)) fail(file, `${where}.basis must be one of: ${BASES.join(", ")}`);
    const supporting = allowance.facts === undefined ? [] : allowance.facts;
    if (!Array.isArray(supporting)) fail(file, `${where}.facts must be a list of fact ids`);
    else {
      for (const id of supporting) {
        if (!factIds.has(id)) fail(file, `${where}.facts references unknown fact "${id}"`);
      }
      if (allowance.basis === "sourced" && supporting.length === 0) {
        fail(file, `${where}: basis "sourced" requires at least one supporting fact`);
      }
    }
    result[key] = { minutes: allowance.minutes, basis: allowance.basis, facts: Array.isArray(supporting) ? supporting : [] };
  }
  return result;
}

function validateAirport(file, data, expectedIata) {
  if (!isPlainObject(data)) {
    fail(file, "file must contain a mapping");
    return null;
  }
  checkKeys(file, "root", data, AIRPORT_KEYS);
  const isBaseline = expectedIata === "_baseline";
  if (data.iata !== expectedIata) fail(file, `iata must match the file name (${expectedIata})`);
  if (typeof data.name !== "string" || !data.name.trim()) fail(file, "name is required");
  if (!isBaseline && !/^[A-Z]{2}$/.test(data.country || "")) fail(file, "country must be an ISO 3166-1 alpha-2 code");
  if (isBaseline && data.country !== undefined) fail(file, "the baseline has no country");
  if (!isBaseline && !isTimeZone(data.timezone)) fail(file, "timezone must be an IANA time zone such as Europe/Berlin");
  if (isBaseline && data.timezone !== undefined) fail(file, "the baseline has no timezone");
  if (!isIsoDate(data.last_reviewed)) fail(file, "last_reviewed must be a YYYY-MM-DD date");
  if (isBaseline && (data.facts?.length || Object.keys(data.sources || {}).length)) {
    fail(file, "the baseline must not carry facts or sources");
  }
  const sources = validateSources(file, data.sources ?? {});
  const facts = validateFacts(file, data.facts ?? [], sources);
  const allowances = validateAllowances(file, data.allowances, facts);
  if (!allowances) return null;
  return {
    iata: data.iata,
    name: data.name,
    country: data.country,
    timezone: data.timezone,
    lastReviewed: data.last_reviewed,
    allowances: {
      baseTransfer: allowances.base_transfer,
      passportControl: allowances.passport_control,
      terminalChange: allowances.terminal_change,
      securityRescreening: allowances.security_rescreening
    },
    facts: facts.map((fact) => ({
      id: fact.id,
      claim: fact.claim.trim(),
      source: fact.source,
      ...(fact.scope ? { scope: fact.scope } : {}),
      ...(fact.minimum_connection_minutes ? { minimumConnectionMinutes: fact.minimum_connection_minutes } : {}),
      ...(fact.applies_when ? { appliesWhen: fact.applies_when } : {})
    })),
    sources,
    coverage: coverageFor(allowances, facts)
  };
}

function coverageFor(allowances, facts) {
  const values = Object.values(allowances);
  if (values.every((allowance) => allowance.basis === "sourced")) return "sourced";
  if (facts.length > 0) return "partial";
  return "heuristic";
}

// Machine-readable conditions for when a fact applies (RFC 0001, applies_when). Kept deliberately small:
//   operating_airline: [LH]          both flights operated by one of these airlines (IATA codes)
//   route_any:                       at least one route pattern matches
//     - { from_continent: EU, to_continent: EU }
//     - { from_schengen: true, to_country: [US, SG, ZA] }
const CONTINENTS = new Set(["AF", "AN", "AS", "EU", "NA", "OC", "SA"]);
const ROUTE_KEYS = ["from_continent", "to_continent", "from_country", "to_country", "from_schengen", "to_schengen"];

function validateAppliesWhen(file, where, value) {
  if (!isPlainObject(value)) return fail(file, `${where} must be a mapping`);
  checkKeys(file, where, value, ["operating_airline", "route_any"]);
  if (!Object.keys(value).length) fail(file, `${where} needs at least one condition`);
  if (value.operating_airline !== undefined) {
    if (!Array.isArray(value.operating_airline) || !value.operating_airline.length
      || value.operating_airline.some((code) => !/^[A-Z0-9]{2}$/.test(String(code)))) {
      fail(file, `${where}.operating_airline must be a list of two-character IATA airline codes`);
    }
  }
  if (value.route_any !== undefined) {
    if (!Array.isArray(value.route_any) || !value.route_any.length) return fail(file, `${where}.route_any must be a non-empty list`);
    value.route_any.forEach((route, index) => {
      const at = `${where}.route_any[${index}]`;
      if (!isPlainObject(route) || !Object.keys(route).length) return fail(file, `${at} must be a non-empty mapping`);
      checkKeys(file, at, route, ROUTE_KEYS);
      for (const key of ["from_continent", "to_continent"]) {
        if (route[key] !== undefined && !CONTINENTS.has(route[key])) fail(file, `${at}.${key} must be one of ${[...CONTINENTS].join(", ")}`);
      }
      for (const key of ["from_country", "to_country"]) {
        if (route[key] !== undefined && (!Array.isArray(route[key]) || route[key].some((code) => !/^[A-Z]{2}$/.test(String(code))))) {
          fail(file, `${at}.${key} must be a list of ISO 3166-1 alpha-2 codes`);
        }
      }
      for (const key of ["from_schengen", "to_schengen"]) {
        if (route[key] !== undefined && typeof route[key] !== "boolean") fail(file, `${at}.${key} must be true or false`);
      }
    });
  }
}

function validateSchengen(file, data, profiles) {
  if (!isPlainObject(data)) {
    fail(file, "file must contain a mapping");
    return null;
  }
  checkKeys(file, "root", data, ["countries", "source", "outside_schengen"]);
  const countries = isPlainObject(data.countries) ? data.countries : {};
  if (!isPlainObject(data.countries)) fail(file, "countries must be a mapping of ISO code → name");
  for (const code of Object.keys(countries)) {
    if (!/^[A-Z]{2}$/.test(code)) fail(file, `countries.${code}: must be an ISO 3166-1 alpha-2 code`);
  }
  if (!isPlainObject(data.source)) fail(file, "source is required");
  else {
    validateSources(file, { "schengen-source": data.source });
  }
  const outside = isPlainObject(data.outside_schengen) ? data.outside_schengen : {};
  if (data.outside_schengen !== undefined && !isPlainObject(data.outside_schengen)) {
    fail(file, "outside_schengen must be a mapping of IATA → reason");
  }
  for (const [iata, reason] of Object.entries(outside)) {
    if (!/^[A-Z]{3}$/.test(iata)) fail(file, `outside_schengen.${iata}: not an IATA code`);
    if (typeof reason !== "string" || !reason.trim()) fail(file, `outside_schengen.${iata}: give the reason`);
  }
  return {
    countries: Object.keys(countries).sort(),
    outsideSchengen: Object.keys(outside).sort(),
    source: data.source
  };
}

function loadAll() {
  const profiles = {};
  let baseline = null;
  const files = fs.readdirSync(airportsDir).filter((name) => name.endsWith(".yaml")).sort();
  for (const name of files) {
    const file = path.join(airportsDir, name);
    const stem = name.replace(/\.yaml$/, "");
    if (stem !== "_baseline" && !/^[A-Z]{3}$/.test(stem)) {
      fail(file, "file name must be an IATA code such as FRA.yaml");
      continue;
    }
    const data = readYaml(file);
    if (data === null) continue;
    const profile = validateAirport(file, data, stem);
    if (!profile) continue;
    if (stem === "_baseline") baseline = profile;
    else profiles[stem] = profile;
  }
  if (!baseline) errors.push("airports/_baseline.yaml is required");
  const schengenData = readYaml(schengenFile);
  const regions = schengenData === null ? null : validateSchengen(schengenFile, schengenData, profiles);
  return { profiles, baseline, regions };
}

function renderModule({ profiles, baseline, regions }) {
  const { coverage: _ignored, facts: _f, sources: _s, ...baselineRuntime } = baseline;
  const data = {
    baseline: baselineRuntime,
    airports: profiles,
    schengen: {
      countries: regions.countries,
      outsideSchengen: regions.outsideSchengen,
      source: regions.source
    }
  };
  return `// GENERATED FILE — do not edit by hand.\n` +
    `// Source: airports/*.yaml and regions/schengen.yaml. Rebuild with \`npm run airports:build\`.\n` +
    `(function exposeAirportData(root, factory) {\n` +
    `  const api = factory();\n` +
    `  if (typeof module === "object" && module.exports) module.exports = api;\n` +
    `  root.ConnectionQualityAirportData = api;\n` +
    `})(typeof globalThis !== "undefined" ? globalThis : this, function createAirportData() {\n` +
    `  "use strict";\n` +
    `  function deepFreeze(value) {\n` +
    `    if (value && typeof value === "object") {\n` +
    `      for (const child of Object.values(value)) deepFreeze(child);\n` +
    `      Object.freeze(value);\n` +
    `    }\n` +
    `    return value;\n` +
    `  }\n` +
    `  return deepFreeze(${JSON.stringify(data, null, 2).replace(/\n/g, "\n  ")});\n` +
    `});\n`;
}

function renderCoverage({ profiles }) {
  const rows = Object.values(profiles).map((profile) => {
    const allowances = Object.values(profile.allowances);
    const sourced = allowances.filter((allowance) => allowance.basis === "sourced").length;
    const supported = allowances.filter((allowance) => allowance.facts.length > 0).length;
    return `| ${profile.iata} | ${profile.name} | ${profile.coverage} | ${sourced}/4 | ${supported}/4 | ${profile.facts.length} | ${Object.keys(profile.sources).length} | ${profile.lastReviewed} |`;
  });
  const counts = { sourced: 0, partial: 0, heuristic: 0 };
  for (const profile of Object.values(profiles)) counts[profile.coverage] += 1;
  return `<!-- GENERATED FILE — do not edit by hand. Rebuild with \`npm run airports:build\`. -->\n` +
    `# Airport data coverage\n\n` +
    `${Object.keys(profiles).length} airports have their own transfer profile: ` +
    `${counts.sourced} fully sourced, ${counts.partial} partially sourced, ${counts.heuristic} heuristic only. ` +
    `Every other airport uses [the standard baseline](_baseline.yaml).\n\n` +
    `- **Coverage** — \`sourced\`: every allowance is backed by a cited fact. \`partial\`: at least one cited fact. \`heuristic\`: rule-of-thumb values only.\n` +
    `- **Sourced minutes** — allowances whose *duration* comes from a source.\n` +
    `- **Steps confirmed** — allowances whose *existence* (e.g. a security re-check) is confirmed by a cited fact, even if the duration is still estimated.\n\n` +
    `Help wanted: add official sources for airports marked \`heuristic\`, confirm more transfer steps, ` +
    `or replace estimated durations with sourced ones (\`Sourced minutes\`). See [CONTRIBUTING.md](../CONTRIBUTING.md). ` +
    `Open questions are noted as comments in the airport files.\n\n` +
    `| IATA | Airport | Coverage | Sourced minutes | Steps confirmed | Facts | Sources | Last reviewed |\n` +
    `| --- | --- | --- | --- | --- | --- | --- | --- |\n` +
    `${rows.join("\n")}\n`;
}

const loaded = loadAll();
if (errors.length) {
  console.error(`Airport data is invalid (${errors.length} problem${errors.length === 1 ? "" : "s"}):`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

const outputs = [
  [generatedModule, renderModule(loaded)],
  [coverageReport, renderCoverage(loaded)]
];

if (checkOnly) {
  // Compare ignoring line endings: Git on Windows (core.autocrlf) checks files
  // out with CRLF, which is not a real difference.
  const normalize = (text) => text.replace(/\r\n/g, "\n");
  const stale = outputs.filter(([file, content]) =>
    !fs.existsSync(file) || normalize(fs.readFileSync(file, "utf8")) !== normalize(content));
  if (stale.length) {
    console.error("Generated airport data is out of date. Run `npm run airports:build` and commit the result:");
    for (const [file] of stale) console.error(`  - ${path.relative(root, file)}`);
    process.exit(1);
  }
  console.log(`Airport data valid and up to date (${Object.keys(loaded.profiles).length} airports).`);
} else {
  for (const [file, content] of outputs) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, "utf8");
  }
  console.log(`Generated airport data for ${Object.keys(loaded.profiles).length} airports.`);
}
