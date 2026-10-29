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

test("runtime data is immutable", () => {
  const profile = core.getAirportProfile("FRA");
  assert.ok(Object.isFrozen(profile.allowances.baseTransfer));
  assert.ok(Object.isFrozen(profile.facts));
  assert.throws(() => { "use strict"; profile.allowances.baseTransfer.minutes = 1; }, TypeError);
});

// Validator behaviour: run the build script against a scratch copy of the data.
function withScratchDataset(mutate) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "airport-data-"));
  fs.cpSync(path.join(repository, "airports"), path.join(scratch, "airports"), { recursive: true });
  fs.cpSync(path.join(repository, "regions"), path.join(scratch, "regions"), { recursive: true });
  fs.mkdirSync(path.join(scratch, "scripts"));
  fs.copyFileSync(buildScript, path.join(scratch, "scripts", "build-airport-data.js"));
  fs.symlinkSync(path.join(repository, "node_modules"), path.join(scratch, "node_modules"), "dir");
  mutate(scratch);
  const result = spawnSync(process.execPath, [path.join(scratch, "scripts", "build-airport-data.js")], { encoding: "utf8" });
  fs.rmSync(scratch, { recursive: true, force: true });
  return result;
}

function edit(scratch, file, transform) {
  const target = path.join(scratch, file);
  fs.writeFileSync(target, transform(fs.readFileSync(target, "utf8")));
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

test("validator rejects a profile that disagrees with the Schengen list", () => {
  const result = withScratchDataset((scratch) => edit(scratch, "regions/schengen.yaml", (text) =>
    text.replace("    MUC: DE\n", "")));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /MUC is in Schengen country DE but is not listed/);
});
