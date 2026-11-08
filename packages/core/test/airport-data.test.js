const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const core = require("../src/index.js");
const rules = require("../src/airport-rules.js");

const repository = path.resolve(__dirname, "..", "..", "..");
const buildScript = path.join(repository, "scripts", "build-airport-data.js");

test("every airport profile exposes all four allowances with a basis", () => {
  const profiles = core.listAirportProfiles();
  assert.ok(profiles.length >= 13);
  for (const profile of profiles) {
    assert.match(profile.iata, /^[A-Z]{3}$/);
    for (const key of ["baseTransfer", "passportControl", "terminalChange", "securityRescreening"]) {
      const allowance = profile.allowances[key];
      assert.ok(Number.isInteger(allowance.minutes), `${profile.iata}.${key}.minutes`);
      assert.ok(["heuristic", "sourced"].includes(allowance.basis), `${profile.iata}.${key}.basis`);
    }
  }
});

test("every cited fact resolves to an https source", () => {
  for (const profile of core.listAirportProfiles()) {
    for (const fact of profile.facts) {
      const source = profile.sources[fact.source];
      assert.ok(source, `${profile.iata}: fact ${fact.id} cites missing source ${fact.source}`);
      assert.match(source.url, /^https:\/\//);
    }
  }
});

test("airport profile lookup is case-insensitive and undefined for unprofiled airports", () => {
  assert.equal(core.getAirportProfile("lhr").name, "London Heathrow");
  assert.equal(core.getAirportProfile("BER"), undefined);
});

test("engine rules are derived from the dataset", () => {
  const lhr = core.getAirportProfile("LHR");
  assert.equal(rules.AIRPORT_RULES.LHR.securityMinutes, lhr.allowances.securityRescreening.minutes);
  assert.equal(rules.FALLBACK_RULE.baseTransferMinutes, 35);
  assert.equal(core.travelZone("FRA"), "schengen");
  assert.equal(core.travelZone("LHR"), "non-schengen");
  assert.equal(core.travelZone("ZZZ"), "unknown");
});

test("every catalog airport has a Schengen zone from its country", () => {
  // Airports without a profile used to be "unknown"; the country now decides.
  assert.equal(core.travelZone("KEF"), "schengen");
  assert.equal(core.travelZone("LPA"), "schengen", "the Canary Islands are Spain and in Schengen");
  assert.equal(core.travelZone("ADD"), "non-schengen");
  assert.equal(core.travelZone("RUN"), "non-schengen", "Réunion has its own ISO code");
  assert.equal(core.travelZone("LYR"), "non-schengen", "Svalbard is listed as outside Schengen");
  assert.equal(core.travelZone("fra"), "schengen");
  assert.equal(core.countryForAirport("PVG"), "CN");
  assert.equal(core.continentForAirport("IST"), "EU");
  const catalog = require("../src/airport-catalog.js");
  assert.ok(Object.keys(catalog.AIRPORTS).length > 8000);
  const unknown = Object.keys(catalog.AIRPORTS).filter((iata) => core.travelZone(iata) === "unknown");
  assert.ok(unknown.length < 50, `${unknown.length} catalog airports have no country`);
});

test("runtime data is immutable", () => {
  const profile = core.getAirportProfile("FRA");
  assert.ok(Object.isFrozen(profile.allowances.baseTransfer));
  assert.ok(Object.isFrozen(profile.facts));
  assert.throws(() => { "use strict"; profile.allowances.baseTransfer.minutes = 1; }, TypeError);
});

// Validator behaviour: run the build script against a scratch copy of the data.
function withScratchDataset(mutate, args = []) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "airport-data-"));
  fs.cpSync(path.join(repository, "airports"), path.join(scratch, "airports"), { recursive: true });
  fs.cpSync(path.join(repository, "regions"), path.join(scratch, "regions"), { recursive: true });
  fs.mkdirSync(path.join(scratch, "scripts"));
  fs.copyFileSync(buildScript, path.join(scratch, "scripts", "build-airport-data.js"));
  fs.symlinkSync(path.join(repository, "node_modules"), path.join(scratch, "node_modules"), "dir");
  mutate(scratch);
  const result = spawnSync(process.execPath, [path.join(scratch, "scripts", "build-airport-data.js"), ...args], { encoding: "utf8" });
  fs.rmSync(scratch, { recursive: true, force: true });
  return result;
}

function edit(scratch, file, transform) {
  const target = path.join(scratch, file);
  const original = fs.readFileSync(target, "utf8");
  const changed = transform(original);
  // Guard against silent no-ops (e.g. a "\n" pattern on a CRLF checkout).
  if (changed === original) throw new Error(`edit() did not change ${file}; the test's search pattern no longer matches`);
  fs.writeFileSync(target, changed);
}

test("validator accepts the committed dataset", () => {
  const result = withScratchDataset(() => {});
  assert.equal(result.status, 0, result.stderr);
});

test("validator rejects a sourced allowance without a supporting fact", () => {
  const result = withScratchDataset((scratch) => edit(scratch, "airports/MUC.yaml", (text) =>
    text.replace("base_transfer: { minutes: 30, basis: heuristic }", "base_transfer: { minutes: 30, basis: sourced }")));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /basis "sourced" requires at least one supporting fact/);
});

test("validator rejects a fact citing an undefined source", () => {
  const result = withScratchDataset((scratch) => edit(scratch, "airports/HKG.yaml", (text) =>
    text.replace("source: hkg-transfer", "source: missing-source")));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /source "missing-source" is not defined/);
});

test("validator rejects a non-https source and a file name mismatch", () => {
  const result = withScratchDataset((scratch) => {
    edit(scratch, "airports/SIN.yaml", (text) => text.replace("https://www.changiairport.com", "http://www.changiairport.com"));
    fs.renameSync(path.join(scratch, "airports/NRT.yaml"), path.join(scratch, "airports/XYZ.yaml"));
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /url must be an https URL/);
  assert.match(result.stderr, /iata must match the file name \(XYZ\)/);
});

test("validator requires a reason for every airport outside Schengen in a member country", () => {
  const result = withScratchDataset((scratch) => edit(scratch, "regions/schengen.yaml", (text) =>
    text.replace(/LYR: [^\n]*/, 'LYR: ""')));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /outside_schengen\.LYR: give the reason/);
});

test("--check ignores CRLF line endings from a Windows checkout", () => {
  const toCrlf = (file) => fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/\r?\n/g, "\r\n"));
  const result = withScratchDataset((scratch) => {
    const generated = path.join(scratch, "packages", "core", "src", "data", "airport-data.generated.js");
    const build = spawnSync(process.execPath, [path.join(scratch, "scripts", "build-airport-data.js")], { encoding: "utf8" });
    assert.equal(build.status, 0, build.stderr);
    toCrlf(generated);
    toCrlf(path.join(scratch, "airports", "COVERAGE.md"));
    toCrlf(path.join(scratch, "airports", "FRA.yaml"));
  }, ["--check"]);
  assert.equal(result.status, 0, result.stderr);
});

test("--check still detects real changes", () => {
  const result = withScratchDataset((scratch) => {
    spawnSync(process.execPath, [path.join(scratch, "scripts", "build-airport-data.js")]);
    const target = path.join(scratch, "airports", "MUC.yaml");
    fs.writeFileSync(target, fs.readFileSync(target, "utf8").replace("base_transfer: { minutes: 30", "base_transfer: { minutes: 31"));
  }, ["--check"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /out of date/);
});

test("validator requires a scope and whole minutes for a published minimum connection time", () => {
  const unscoped = withScratchDataset((scratch) => edit(scratch, "airports/FRA.yaml", (text) =>
    text.replace(/\n    scope: Lufthansa[^\n]*/, "")));
  assert.notEqual(unscoped.status, 0);
  assert.match(unscoped.stderr, /minimum_connection_minutes needs a scope/);
  const fractional = withScratchDataset((scratch) => edit(scratch, "airports/FRA.yaml", (text) =>
    text.replace("minimum_connection_minutes: 60", "minimum_connection_minutes: 59.5")));
  assert.notEqual(fractional.status, 0);
  assert.match(fractional.stderr, /must be a positive whole number of minutes/);
});

test("validator checks the applies_when vocabulary", () => {
  const result = withScratchDataset((scratch) => edit(scratch, "airports/FRA.yaml", (text) =>
    text.replace("operating_airline: [LH]", "operating_airline: [Lufthansa]").replace("from_continent: EU, to_continent: EU", "from_continent: Europe, to_contnent: EU")));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /operating_airline must be a list of two-character IATA airline codes/);
  assert.match(result.stderr, /from_continent must be one of/);
  assert.match(result.stderr, /unknown field "to_contnent"/);
});
