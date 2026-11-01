const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { deterministicChecks, legMatches } = require("../src/checks.js");
const { parseJudgeReply, buildJudgePrompt, RUBRIC } = require("../src/judge.js");
const { buildReport } = require("../src/report.js");
const { evaluate, selectCases, parseArgs } = require("../src/run.js");
const { connectServer } = require("../src/agent.js");

const { cases } = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "cases.json"), "utf8"));

// --- cases.json is well formed and every expectation is achievable -------

test("cases have unique ids, a category, and only known expectation keys", () => {
  const ids = new Set();
  for (const testCase of cases) {
    assert.ok(testCase.id && !ids.has(testCase.id), `duplicate or missing id ${testCase.id}`);
    ids.add(testCase.id);
    assert.ok(testCase.category && testCase.prompt, testCase.id);
    for (const key of Object.keys(testCase.expect)) {
      assert.ok(["calls", "compare", "forbid_leg_fields", "no_tool", "judge"].includes(key), `${testCase.id}: unknown key ${key}`);
    }
    for (const item of testCase.expect.judge || []) assert.ok(RUBRIC[item], `${testCase.id}: unknown judge item ${item}`);
  }
  assert.ok(cases.length >= 30);
});

test("every expected call is accepted by the real MCP server", async () => {
  const server = await connectServer();
  try {
    for (const testCase of cases) {
      for (const expected of testCase.expect.calls || []) {
        const tool = expected.tool || "check_connection";
        const leg = { ...expected.leg };
        if (leg.arrival_time === "*present*") Object.assign(leg, { arrival_time: "2026-09-20T10:00", departure_time: "2026-09-20T11:30" });
        // Expectations may leave the layover open (e.g. they only pin the airport); fill one in.
        if (tool !== "get_airport_profile" && tool !== "list_airports" && leg.layover_minutes === undefined && leg.arrival_time === undefined) {
          leg.layover_minutes = 90;
        }
        const itinerary = { from: "BER", via: "IST", to: "PVG", ...leg };
        const args = tool === "check_connection" ? itinerary
          : tool === "compare_connections" ? { options: [itinerary, { ...itinerary, id: "second" }] }
            : leg;
        const result = await server.client.callTool({ name: tool, arguments: args });
        assert.ok(!result.isError, `${testCase.id}: ${tool} rejected ${JSON.stringify(args)}: ${JSON.stringify(result.content)}`);
      }
    }
  } finally {
    await server.close();
  }
});

// --- deterministic checks -------------------------------------------------

const durationCase = cases.find((testCase) => testCase.id === "duration-fra-50-zh");

test("a correct duration-only call passes every deterministic check", () => {
  const transcript = { answer: "Risky.", stopReason: "end_turn", calls: [
    { name: "check_connection", args: { from: "BER", via: "fra", to: "PVG", layover_minutes: 50 }, isError: false, result: {} }
  ] };
  const results = deterministicChecks(durationCase, transcript);
  assert.ok(results.every((check) => check.passed), JSON.stringify(results));
});

test("inventing clock times for a duration-only question fails", () => {
  const transcript = { answer: "Risky.", stopReason: "end_turn", calls: [
    { name: "check_connection", args: { from: "BER", via: "FRA", to: "PVG", arrival_time: "2026-11-02T10:00", departure_time: "2026-11-02T10:50" }, isError: false, result: {} }
  ] };
  const failed = deterministicChecks(durationCase, transcript).filter((check) => !check.passed).map((check) => check.id);
  assert.deepEqual(failed, ["expected_call_1", "no_arrival_time", "no_departure_time"]);
});

test("answering without a tool fails; clarify cases fail when a tool is called", () => {
  assert.ok(deterministicChecks(durationCase, { answer: "Probably fine.", calls: [], stopReason: "end_turn" })
    .some((check) => check.id === "tool_called" && !check.passed));
  const clarify = cases.find((testCase) => testCase.id === "clarify-no-airport-zh");
  const guessed = deterministicChecks(clarify, { answer: "x", stopReason: "end_turn", calls: [{ name: "check_connection", args: { via: "FRA" } }] });
  assert.deepEqual(guessed.map((check) => [check.id, check.passed]), [["no_tool_call", false]]);
});

test("compare expectations look inside compare_connections options", () => {
  const compareCase = cases.find((testCase) => testCase.id === "compare-protection-en");
  const transcript = { answer: "B is safer.", stopReason: "end_turn", calls: [{ name: "compare_connections", isError: false, result: {}, args: { options: [
    { id: "A", from: "BER", via: "IST", to: "PVG", layover_minutes: 240, ticket: "separate" },
    { id: "B", from: "BER", via: "IST", to: "PVG", layover_minutes: 180, ticket: "protected" }
  ] } }] };
  assert.ok(deterministicChecks(compareCase, transcript).every((check) => check.passed));
  // two separate check_connection calls do not satisfy a compare expectation
  const separately = { ...transcript, calls: transcript.calls[0].args.options.map((args) => ({ name: "check_connection", args, isError: false })) };
  assert.ok(deterministicChecks(compareCase, separately).some((check) => check.id === "compare_used" && !check.passed));
});

test("an omitted ticket matches the server default 'unknown'", () => {
  assert.ok(legMatches({ via: "MUC", ticket: "unknown" }, { via: "MUC" }));
  assert.ok(!legMatches({ via: "MUC", ticket: "protected" }, { via: "MUC" }));
});

// --- judge ----------------------------------------------------------------

test("judge replies are parsed strictly", () => {
  const items = ["numbers_match", "fact_scope"];
  const parsed = parseJudgeReply('Here: {"items": {"numbers_match": {"verdict": "PASS", "reason": "ok"}, "fact_scope": {"verdict": "n/a", "reason": ""}}}', items);
  assert.deepEqual(parsed.numbers_match, { verdict: "pass", reason: "ok" });
  assert.throws(() => parseJudgeReply('{"items": {"numbers_match": {"verdict": "maybe"}}}', items), /no valid verdict/);
  assert.throws(() => parseJudgeReply("no json", items), /no JSON/);
});

test("the judge prompt shows counted steps, confidence and fact scopes", () => {
  const prompt = buildJudgePrompt({
    question: "q", answer: "a", items: ["no_invented_steps"],
    calls: [{ name: "check_connection", args: {}, isError: false, result: {
      route: "BER–FRA–PVG", quality: "risky", steps: [{ label: "Move through airport", minutes: 35, basis: "heuristic" }],
      confidence: { level: "medium", reasons: [] }, ticket: { status: "protected" },
      connection_airport: { facts: [{ claim: "Lufthansa MCT 60", scope: "Lufthansa-operated connections only" }] }
    } }]
  });
  assert.match(prompt, /Move through airport: 35 min \(heuristic\)/);
  assert.match(prompt, /Lufthansa-operated connections only/);
  assert.match(prompt, /no_invented_steps:/);
});

// --- end to end with a scripted stand-in for the Claude API ----------------

function scriptedAnthropic() {
  const calls = [];
  return {
    calls,
    messages: {
      async create(request) {
        calls.push(request);
        const isJudge = !request.tools;
        if (isJudge) {
          const items = [...request.messages[0].content.matchAll(/^- ([a-z_]+): /gm)].map((match) => match[1]);
          return { content: [{ type: "text", text: JSON.stringify({ items: Object.fromEntries(items.map((id) => [id, { verdict: "pass", reason: "scripted" }])) }) }], usage: {} };
        }
        const last = request.messages[request.messages.length - 1];
        if (last.role === "user" && typeof last.content === "string") {
          return {
            stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 },
            content: [{ type: "tool_use", id: "t1", name: "check_connection", input: { from: "BER", via: "FRA", to: "PVG", layover_minutes: 50 } }]
          };
        }
        const toolText = last.content[0].content;
        return { stop_reason: "end_turn", usage: { input_tokens: 20, output_tokens: 8 }, content: [{ type: "text", text: `Tool said: ${toolText.split("\n")[0]}` }] };
      }
    }
  };
}

test("evaluate() runs the agent loop against the real server and grades it", async () => {
  const anthropic = scriptedAnthropic();
  const { results, usage } = await evaluate({ anthropic, cases: [durationCase], model: "scripted", judgeModel: "scripted" });
  assert.equal(results.length, 1);
  const [result] = results;
  assert.equal(result.transcript.calls[0].result.quality, "risky");
  assert.match(result.transcript.answer, /BER–FRA–PVG: RISKY/);
  assert.ok(result.deterministic.every((check) => check.passed), JSON.stringify(result.deterministic));
  assert.ok(Object.values(result.judge).every((item) => item.verdict === "pass"));
  assert.deepEqual(usage, { input_tokens: 30, output_tokens: 13 });
  // the MCP tool list is passed to the model as Claude API tools
  assert.deepEqual(anthropic.calls[0].tools.map((tool) => tool.name).sort(), ["check_connection", "compare_connections", "get_airport_profile", "list_airports"]);
  assert.ok(anthropic.calls[0].tools[0].input_schema.properties);

  const report = buildReport({ results, meta: { model: "scripted", judgeModel: "scripted", serverVersion: "x", repeat: 1, startedAt: "t", usage } });
  assert.match(report.markdown, /\*\*1 of 1 runs passed every check \(100%\)\.\*\*/);
  assert.match(report.markdown, /\| no_arrival_time \| tool call \| 1\/1 \| 100% \|/);
});

test("CLI argument parsing and case selection", () => {
  const args = parseArgs(["--model", "m", "--category", "compare", "--limit", "2", "--repeat", "3"]);
  assert.deepEqual(args, { repeat: 3, model: "m", category: "compare", limit: 2 });
  assert.equal(selectCases(cases, args).length, 2);
  assert.ok(selectCases(cases, args).every((testCase) => testCase.category === "compare"));
  assert.deepEqual(selectCases(cases, { only: ["low-vie-zh"] }).map((testCase) => testCase.id), ["low-vie-zh"]);
});
