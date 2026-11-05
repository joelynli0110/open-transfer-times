const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
const core = require("open-transfer-times");
const { createServer } = require("../src/server.js");

async function connect() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, close: () => Promise.all([client.close(), server.close()]) };
}

const LHR_CONNECTION = {
  from: "BER", via: "LHR", to: "PVG",
  arrival_time: "2026-09-20T10:00", departure_time: "2026-09-20T11:30",
  ticket: "protected"
};

test("lists the four read-only tools with schemas", async () => {
  const { client, close } = await connect();
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(),
      ["check_connection", "compare_connections", "get_airport_profile", "list_airports"]);
    for (const tool of tools) {
      assert.equal(tool.annotations.readOnlyHint, true, tool.name);
      assert.ok(tool.outputSchema, `${tool.name} declares an output schema`);
    }
    const check = tools.find((tool) => tool.name === "check_connection");
    assert.deepEqual(check.inputSchema.required.sort(), ["from", "to", "via"]);
    assert.ok(check.inputSchema.properties.layover_minutes);
  } finally {
    await close();
  }
});

test("check_connection matches the core engine and cites airport facts", async () => {
  const { client, close } = await connect();
  try {
    const result = await client.callTool({ name: "check_connection", arguments: LHR_CONNECTION });
    assert.ok(!result.isError);
    const expected = core.assessConnection({
      segments: [
        { origin: "BER", destination: "LHR", arrivalTime: "2026-09-20T10:00" },
        { origin: "LHR", destination: "PVG", departureTime: "2026-09-20T11:30" }
      ]
    }, { ticketStatus: "protected" });
    const data = result.structuredContent;
    assert.equal(data.quality, expected.quality);
    assert.equal(data.buffer_minutes, expected.structuralBufferMinutes);
    assert.equal(data.layover_minutes, 90);
    assert.equal(data.connection_airport.has_profile, true);
    assert.ok(data.connection_airport.facts.some((fact) => fact.source.url.startsWith("https://www.heathrow.com")));
    const security = data.steps.find((step) => step.code === "SECURITY_RESCREENING");
    assert.deepEqual(security.supporting_facts, ["transfer-security"]);
    assert.equal(data.connection_airport.allowances, undefined, "assessments list counted steps, not every allowance");
    assert.match(result.content[0].text, /^BER–LHR–PVG: RECOMMEND — .*\nRating: REASONABLE — /);
    assert.match(result.content[0].text, /\nComparing several options\? Send them together to compare_connections/);
  } finally {
    await close();
  }
});

test("check_connection normalizes lowercase codes and falls back to the baseline", async () => {
  const { client, close } = await connect();
  try {
    const result = await client.callTool({ name: "check_connection", arguments: {
      from: "ber", via: "vie", to: "jfk", arrival_time: "2026-09-20T10:00", departure_time: "2026-09-20T12:00"
    } });
    assert.ok(!result.isError);
    assert.equal(result.structuredContent.route, "BER–VIE–JFK");
    assert.equal(result.structuredContent.connection_airport.coverage, "baseline");
    assert.equal(result.structuredContent.ticket.status, "unknown");
  } finally {
    await close();
  }
});

test("separate tickets change the verdict and baggage re-check consumes time", async () => {
  const { client, close } = await connect();
  try {
    const base = { ...LHR_CONNECTION, departure_time: "2026-09-20T14:00" };
    const single = (await client.callTool({ name: "check_connection", arguments: base })).structuredContent;
    const separate = (await client.callTool({ name: "check_connection", arguments: { ...base, ticket: "separate", baggage_recheck: true } })).structuredContent;
    assert.equal(separate.ticket.status, "separate");
    assert.equal(separate.transfer_process_minutes, single.transfer_process_minutes + 45);
    assert.ok(separate.factors.some((factor) => factor.code === "BAGGAGE_RECHECK"));
  } finally {
    await close();
  }
});

test("invalid input is rejected, impossible itineraries return a tool error", async () => {
  const { client, close } = await connect();
  try {
    const badCode = await client.callTool({ name: "check_connection", arguments: { ...LHR_CONNECTION, via: "LONDON" } });
    assert.equal(badCode.isError, true);
    const backwards = await client.callTool({ name: "check_connection", arguments: { ...LHR_CONNECTION, departure_time: "2026-09-20T09:00" } });
    assert.equal(backwards.isError, true);
    assert.match(backwards.content[0].text, /Could not assess this connection/);
  } finally {
    await close();
  }
});

test("compare_connections ranks safest first and keeps ids", async () => {
  const { client, close } = await connect();
  try {
    const result = await client.callTool({ name: "compare_connections", arguments: { options: [
      { id: "cheap", from: "BER", via: "FRA", to: "PVG", arrival_time: "2026-09-20T10:00", departure_time: "2026-09-20T10:50", ticket: "protected" },
      { id: "long", from: "BER", via: "IST", to: "PVG", arrival_time: "2026-09-20T10:00", departure_time: "2026-09-20T13:15", ticket: "protected" },
      { id: "broken", from: "BER", via: "DOH", to: "PVG", arrival_time: "2026-09-20T10:00", departure_time: "2026-09-20T09:00" }
    ] } });
    assert.ok(!result.isError);
    const ranked = result.structuredContent.ranked;
    assert.deepEqual(ranked.map((entry) => entry.id), ["long", "cheap", "broken"]);
    assert.equal(ranked[0].assessment.quality, "comfortable");
    assert.equal(ranked[1].assessment.quality, "risky");
    assert.ok(ranked[2].error);
  } finally {
    await close();
  }
});

test("get_airport_profile and list_airports expose the dataset", async () => {
  const { client, close } = await connect();
  try {
    const profile = await client.callTool({ name: "get_airport_profile", arguments: { airport: "nrt" } });
    assert.equal(profile.structuredContent.iata, "NRT");
    assert.ok(profile.structuredContent.facts.length >= 2);
    const baseline = await client.callTool({ name: "get_airport_profile", arguments: { airport: "BER" } });
    assert.equal(baseline.structuredContent.has_profile, false);
    const list = await client.callTool({ name: "list_airports", arguments: {} });
    assert.equal(list.structuredContent.airports.length, core.listAirportProfiles().length);
  } finally {
    await close();
  }
});

test("the CLI speaks MCP over stdio", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(__dirname, "..", "src", "cli.js")],
    stderr: "ignore"
  });
  const client = new Client({ name: "stdio-test", version: "0.0.0" });
  await client.connect(transport);
  try {
    const result = await client.callTool({ name: "check_connection", arguments: LHR_CONNECTION });
    assert.equal(result.structuredContent.quality, "reasonable");
  } finally {
    await client.close();
  }
});

test("steps list only what was counted and add up to the transfer time", async () => {
  const { client, close } = await connect();
  try {
    // IST has a terminal_change allowance, but no terminal change happens here.
    const ist = (await client.callTool({ name: "check_connection", arguments: {
      from: "BER", via: "IST", to: "PVG", arrival_time: "2026-11-02T10:00", departure_time: "2026-11-02T11:15", ticket: "protected"
    } })).structuredContent;
    assert.deepEqual(ist.steps.map((step) => [step.code, step.minutes]), [["AIRPORT_TRANSFER", 35], ["SECURITY_RESCREENING", 10]]);
    assert.equal(ist.transfer_process_minutes, 45);

    const cases = [
      { from: "BER", via: "FRA", to: "PVG", layover_minutes: 50 },
      { from: "BER", via: "LHR", to: "PVG", layover_minutes: 120, terminal_change: true, baggage_recheck: true, ticket: "separate" },
      { from: "BER", via: "VIE", to: "ZZZ", layover_minutes: 90 },
      { from: "JFK", via: "MUC", to: "BER", layover_minutes: 90, arrival_terminal: "1", departure_terminal: "2" }
    ];
    for (const args of cases) {
      const data = (await client.callTool({ name: "check_connection", arguments: args })).structuredContent;
      const total = data.steps.reduce((sum, step) => sum + step.minutes, 0);
      assert.equal(total, data.transfer_process_minutes, JSON.stringify(args));
    }
  } finally {
    await close();
  }
});

test("summary text names the counted steps and the scope of each fact", async () => {
  const { client, close } = await connect();
  try {
    const result = await client.callTool({ name: "check_connection", arguments: { from: "BER", via: "FRA", to: "PVG", layover_minutes: 50 } });
    const text = result.content[0].text;
    assert.match(text, /Steps counted: Move through airport 35 min \(heuristic\); Allow for Schengen border control 20 min \(heuristic\)\. No other steps were counted\./);
    assert.match(text, /- \(Only for: Lufthansa-operated intra-European connections and Schengen connections to the USA, Singapore and South Africa\) Lufthansa moved/);
  } finally {
    await close();
  }
});

test("layover_minutes works without dates and matches the times-based result", async () => {
  const { client, close } = await connect();
  try {
    const byDuration = (await client.callTool({ name: "check_connection", arguments: { from: "BER", via: "DOH", to: "PVG", layover_minutes: 120 } })).structuredContent;
    const byTimes = (await client.callTool({ name: "check_connection", arguments: {
      from: "BER", via: "DOH", to: "PVG", arrival_time: "2026-09-20T23:10", departure_time: "2026-09-21T01:10"
    } })).structuredContent;
    assert.equal(byDuration.layover_source, "duration");
    assert.equal(byTimes.layover_source, "times");
    for (const key of ["quality", "layover_minutes", "transfer_process_minutes", "buffer_minutes"]) {
      assert.equal(byDuration[key], byTimes[key], key);
    }
    assert.deepEqual(byDuration.steps, byTimes.steps);
  } finally {
    await close();
  }
});

test("missing or conflicting layover information is a tool error", async () => {
  const { client, close } = await connect();
  try {
    const none = await client.callTool({ name: "check_connection", arguments: { from: "BER", via: "IST", to: "PVG" } });
    assert.equal(none.isError, true);
    assert.match(none.content[0].text, /layover_minutes/);
    const half = await client.callTool({ name: "check_connection", arguments: { from: "BER", via: "IST", to: "PVG", arrival_time: "2026-11-02T10:00" } });
    assert.equal(half.isError, true);
    const conflict = await client.callTool({ name: "check_connection", arguments: {
      ...LHR_CONNECTION, layover_minutes: 60
    } });
    assert.equal(conflict.isError, true);
    assert.match(conflict.content[0].text, /does not match the given times \(90 min\)/);
    const tooLong = await client.callTool({ name: "check_connection", arguments: { from: "BER", via: "IST", to: "PVG", layover_minutes: 2000 } });
    assert.equal(tooLong.isError, true);
  } finally {
    await close();
  }
});

test("compare_connections accepts durations, as in 'Frankfurt 50 min vs Istanbul 3 h vs Doha 2 h'", async () => {
  const { client, close } = await connect();
  try {
    const result = await client.callTool({ name: "compare_connections", arguments: { options: [
      { id: "FRA 50m", from: "BER", via: "FRA", to: "PVG", layover_minutes: 50 },
      { id: "IST 3h", from: "BER", via: "IST", to: "PVG", layover_minutes: 180 },
      { id: "DOH 2h", from: "BER", via: "DOH", to: "PVG", layover_minutes: 120 }
    ] } });
    assert.ok(!result.isError);
    const ranked = result.structuredContent.ranked;
    assert.deepEqual(ranked.map((entry) => entry.id), ["IST 3h", "DOH 2h", "FRA 50m"]);
    assert.deepEqual(ranked.map((entry) => entry.assessment.buffer_minutes), [135, 80, -5]);
    assert.ok(ranked.every((entry) => entry.assessment.layover_source === "duration"));
  } finally {
    await close();
  }
});

test("compare_connections puts a protected ticket ahead of a longer self-transfer", async () => {
  const { client, close } = await connect();
  try {
    const result = await client.callTool({ name: "compare_connections", arguments: { options: [
      { id: "self-transfer 4h", from: "BER", via: "IST", to: "PVG", layover_minutes: 240, ticket: "separate" },
      { id: "unknown 3h30", from: "BER", via: "IST", to: "PVG", layover_minutes: 210 },
      { id: "one ticket 3h", from: "BER", via: "IST", to: "PVG", layover_minutes: 180, ticket: "protected" }
    ] } });
    const ranked = result.structuredContent.ranked;
    assert.ok(ranked.every((entry) => entry.assessment.quality === "comfortable"));
    assert.deepEqual(ranked.map((entry) => entry.id), ["one ticket 3h", "unknown 3h30", "self-transfer 4h"]);
  } finally {
    await close();
  }
});

test("compare_connections prefers better data when quality and protection tie", async () => {
  const { client, close } = await connect();
  try {
    const result = await client.callTool({ name: "compare_connections", arguments: { options: [
      { id: "VIE baseline", from: "BER", via: "VIE", to: "JFK", layover_minutes: 240, ticket: "protected" },
      { id: "MUC profile", from: "BER", via: "MUC", to: "JFK", layover_minutes: 180, ticket: "protected" }
    ] } });
    const ranked = result.structuredContent.ranked;
    assert.deepEqual(ranked.map((entry) => [entry.id, entry.assessment.confidence.level]), [["MUC profile", "medium"], ["VIE baseline", "low"]]);
    assert.match(result.content[0].text, /low confidence/);
  } finally {
    await close();
  }
});

test("low confidence is stated up front in the summary", async () => {
  const { client, close } = await connect();
  try {
    const result = await client.callTool({ name: "check_connection", arguments: { from: "ZZZ", via: "XXX", to: "YYY", layover_minutes: 120 } });
    assert.equal(result.structuredContent.quality, "comfortable");
    assert.equal(result.structuredContent.confidence.level, "low");
    const lines = result.content[0].text.split("\n");
    // The decision names what is missing, and the reassuring rating is not in the text at all.
    assert.match(lines[0], /^ZZZ–XXX–YYY: INSUFFICIENT DATA — No transfer profile for this airport.*cannot be relied on\.$/);
    assert.match(lines[1], /^Do not call this connection safe, fine or comfortable\./);
    assert.equal(lines[2], "Confidence: LOW, for the reasons above.");
    assert.match(lines[3], /^Rough estimate only: layover 120 min/);
    assert.doesNotMatch(result.content[0].text, /COMFORTABLE|[Cc]omfortable connection|Healthy transfer margin|^Factors:/m);
  } finally {
    await close();
  }
});

test("server.json for the MCP Registry matches package.json", () => {
  const pkg = require("../package.json");
  const server = require("../server.json");
  assert.equal(server.name, pkg.mcpName, "server.json name must equal package.json mcpName");
  assert.match(server.name, /^io\.github\.joelynli0110\//);
  assert.equal(server.version, pkg.version);
  assert.equal(server.packages[0].identifier, pkg.name);
  assert.equal(server.packages[0].version, pkg.version);
  assert.ok(server.description.length <= 100, "registry limit is 100 characters");
});

// --- 0.2.0 ------------------------------------------------------------------

test("the server sends usage instructions on connect", async () => {
  const { client, close } = await connect();
  try {
    const instructions = client.getInstructions();
    assert.match(instructions, /pass layover_minutes\. Never invent dates or clock times/);
    assert.match(instructions, /Explain only the transfer steps listed in `steps`/);
    assert.match(instructions, /insufficient_data/);
    assert.match(instructions, /Call a tool first with what the user gave/);
    assert.match(instructions, /use compare_connections once/);
  } finally {
    await close();
  }
});

test("check_connection reports the decision and the real layover across a clock change", async () => {
  const { client, close } = await connect();
  try {
    const result = await client.callTool({ name: "check_connection", arguments: {
      from: "BER", via: "FRA", to: "PVG", arrival_time: "2026-03-29T01:30", departure_time: "2026-03-29T03:30", ticket: "protected"
    } });
    const data = result.structuredContent;
    assert.equal(data.layover_minutes, 60);
    assert.equal(data.wall_clock_layover_minutes, 120);
    assert.equal(data.layover_basis, "timezone");
    assert.equal(data.decision.value, "caution");
    assert.match(result.content[0].text, /Layover 60 min \(clocks change: local clocks show 120 min\)/);
    assert.match(result.content[0].text, /^BER–FRA–PVG: CAUTION — Little time is left.*\nRating: TIGHT — /);
  } finally {
    await close();
  }
});

test("UTC offsets are accepted, and durations are never shifted by a time zone", async () => {
  const { client, close } = await connect();
  try {
    const offsets = (await client.callTool({ name: "check_connection", arguments: {
      from: "BER", via: "VIE", to: "JFK", arrival_time: "2026-03-29T01:30+01:00", departure_time: "2026-03-29T03:30+02:00"
    } })).structuredContent;
    assert.equal(offsets.layover_minutes, 60);
    assert.equal(offsets.layover_basis, "offset");
    for (const via of ["FRA", "LHR", "SIN", "VIE"]) {
      const duration = (await client.callTool({ name: "check_connection", arguments: { from: "BER", via, to: "PVG", layover_minutes: 95 } })).structuredContent;
      assert.equal(duration.layover_minutes, 95, via);
      assert.equal(duration.layover_basis, "duration", via);
    }
    const conflict = await client.callTool({ name: "check_connection", arguments: {
      from: "BER", via: "FRA", to: "PVG", arrival_time: "2026-03-29T01:30", departure_time: "2026-03-29T03:30", layover_minutes: 120
    } });
    assert.equal(conflict.isError, true);
    assert.match(conflict.content[0].text, /does not match the given times \(60 min\)/);
  } finally {
    await close();
  }
});

test("separate tickets: unknown bags are surfaced, an explicit false is respected", async () => {
  const { client, close } = await connect();
  try {
    const base = { from: "BER", via: "IST", to: "PVG", layover_minutes: 100, ticket: "separate" };
    const unknown = await client.callTool({ name: "check_connection", arguments: base });
    assert.equal(unknown.structuredContent.baggage_recheck, "unknown");
    assert.deepEqual(unknown.structuredContent.if_baggage_recheck, { buffer_minutes: 10, quality: "tight" });
    assert.equal(unknown.structuredContent.decision.value, "insufficient_data");
    assert.match(unknown.content[0].text, /Bags: not stated\. If they must be collected .* margin is 10 min \(tight\)\. Ask the user\./);

    const handLuggage = (await client.callTool({ name: "check_connection", arguments: { ...base, baggage_recheck: false } })).structuredContent;
    assert.equal(handLuggage.baggage_recheck, "not_required");
    assert.equal(handLuggage.if_baggage_recheck, undefined);
    assert.equal(handLuggage.decision.value, "caution");

    const rechecked = (await client.callTool({ name: "check_connection", arguments: { ...base, baggage_recheck: true } })).structuredContent;
    assert.equal(rechecked.baggage_recheck, "required");
    assert.equal(rechecked.quality, "tight");
  } finally {
    await close();
  }
});

test("compare_connections ranks by decision: missing data never outranks a usable connection", async () => {
  const { client, close } = await connect();
  try {
    const result = await client.callTool({ name: "compare_connections", arguments: { options: [
      { id: "VIE 4h no data", from: "BER", via: "VIE", to: "JFK", layover_minutes: 240, ticket: "protected" },
      { id: "MUC 80m", from: "BER", via: "MUC", to: "JFK", layover_minutes: 80, ticket: "protected" },
      { id: "FRA 45m", from: "BER", via: "FRA", to: "JFK", layover_minutes: 45, ticket: "protected" }
    ] } });
    const ranked = result.structuredContent.ranked;
    assert.deepEqual(ranked.map((entry) => [entry.id, entry.assessment.decision.value]),
      [["MUC 80m", "recommend"], ["VIE 4h no data", "insufficient_data"], ["FRA 45m", "avoid"]]);
    assert.match(result.content[0].text, /^1\. MUC 80m BER–MUC–JFK: RECOMMEND — rated reasonable, margin 30 min/);
    // Options that are not recommended say why, so "comfortable" is not read as "fine".
    assert.match(result.content[0].text, /\n2\. VIE 4h no data BER–VIE–JFK: INSUFFICIENT DATA — estimate only, margin.*\n   Why: Key information is missing.*No transfer profile/);
    assert.match(result.content[0].text, /\nOnly RECOMMEND and CAUTION options may be presented as workable; for the others, say why\.$/);
  } finally {
    await close();
  }
});
