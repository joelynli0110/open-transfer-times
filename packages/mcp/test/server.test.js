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
    assert.deepEqual(check.inputSchema.required.sort(), ["arrival_time", "departure_time", "from", "to", "via"]);
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
    const security = data.connection_airport.allowances.find((a) => a.step === "security_rescreening");
    assert.deepEqual(security.supporting_facts, ["transfer-security"]);
    assert.match(result.content[0].text, /BER–LHR–PVG: REASONABLE/);
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
