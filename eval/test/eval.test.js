const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { deterministicChecks, legMatches } = require("../src/checks.js");
const { parseJudgeReply, buildJudgePrompt, RUBRIC } = require("../src/judge.js");
const { buildReport } = require("../src/report.js");
const { evaluate, selectCases, parseArgs, systemPrompt } = require("../src/run.js");
const { createProvider, toFunctionTool } = require("../src/providers.js");
const { compareRuns } = require("../src/compare.js");
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
        // "*absent*" means the field must not be sent at all. Alternatives (e.g. PVG or SHA): try the first.
        const leg = Object.fromEntries(Object.entries(expected.leg).filter(([, value]) => value !== "*absent*")
          .map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
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

// --- end to end, with scripted stand-ins for both provider types ------------

const JUDGE_ALL_PASS = (prompt) => {
  const items = [...prompt.matchAll(/^- ([a-z_]+): /gm)].map((match) => match[1]);
  return JSON.stringify({ items: Object.fromEntries(items.map((id) => [id, { verdict: "pass", reason: "scripted" }])) });
};
const FRA_50 = { from: "BER", via: "FRA", to: "PVG", layover_minutes: 50 };

function scriptedAnthropicClient() {
  const requests = [];
  return {
    requests,
    messages: {
      async create(request) {
        requests.push(request);
        if (!request.tools) return { content: [{ type: "text", text: JUDGE_ALL_PASS(request.messages[0].content) }], usage: {} };
        const last = request.messages[request.messages.length - 1];
        if (typeof last.content === "string") {
          return { stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 },
            content: [{ type: "tool_use", id: "t1", name: "check_connection", input: FRA_50 }] };
        }
        return { stop_reason: "end_turn", usage: { input_tokens: 20, output_tokens: 8 },
          content: [{ type: "text", text: `Tool said: ${last.content[0].content.split("\n")[0]}` }] };
      }
    }
  };
}

function scriptedFetch({ argumentsAsString = true, badArguments = false } = {}) {
  const requests = [];
  async function fetchImpl(url, init) {
    const body = JSON.parse(init.body);
    requests.push({ url, headers: init.headers, body });
    const reply = (payload) => ({ ok: true, status: 200, text: async () => JSON.stringify(payload) });
    if (!body.tools) return reply({ choices: [{ message: { content: JUDGE_ALL_PASS(body.messages[0].content) } }] });
    const last = body.messages[body.messages.length - 1];
    if (last.role === "user") {
      const args = badArguments ? "{not json" : argumentsAsString ? JSON.stringify(FRA_50) : FRA_50;
      return reply({
        choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: null,
          tool_calls: [{ id: "call_1", type: "function", function: { name: "check_connection", arguments: args } }] } }],
        usage: { prompt_tokens: 12, completion_tokens: 6 }
      });
    }
    return reply({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: `Tool said: ${last.content.split("\n")[0]}` } }],
      usage: { prompt_tokens: 30, completion_tokens: 9 } });
  }
  return { fetchImpl, requests };
}

test("Anthropic provider: agent loop against the real server, graded", async () => {
  const client = scriptedAnthropicClient();
  const provider = createProvider({ provider: "anthropic", model: "scripted", env: { ANTHROPIC_API_KEY: "x" }, anthropicClient: client });
  const { results, usage } = await evaluate({ agent: provider, judge: provider, cases: [durationCase] });
  const [result] = results;
  assert.equal(result.transcript.calls[0].result.quality, "risky");
  assert.match(result.transcript.answer, /BER–FRA–PVG: AVOID/);
  assert.ok(result.deterministic.every((check) => check.passed), JSON.stringify(result.deterministic));
  assert.ok(Object.values(result.judge).every((item) => item.verdict === "pass"));
  assert.deepEqual(usage, { input_tokens: 30, output_tokens: 13 });
  assert.deepEqual(client.requests[0].tools.map((tool) => tool.name).sort(), ["check_connection", "compare_connections", "get_airport_profile", "list_airports"]);
  // The agent's system prompt carries whatever instructions the server sends.
  const server = await connectServer();
  try {
    assert.equal(client.requests[0].system, systemPrompt(server, true));
    if (server.instructions) assert.ok(client.requests[0].system.includes(server.instructions));
  } finally {
    await server.close();
  }

  const report = buildReport({ results, meta: { agent: provider.name, judge: provider.name, serverVersion: "x", repeat: 1, startedAt: "t", usage } });
  assert.match(report.markdown, /\*\*1 of 1 runs passed every check \(100%\)\.\*\*/);
});

test("OpenAI-compatible provider: function tools, tool messages, real server", async () => {
  const { fetchImpl, requests } = scriptedFetch();
  const provider = createProvider({ provider: "openrouter", model: "vendor/model", env: { OPENROUTER_API_KEY: "secret" }, fetchImpl });
  assert.equal(provider.name, "openrouter:vendor/model");
  const { results, usage } = await evaluate({ agent: provider, judge: provider, cases: [durationCase], serverInstructions: false });
  const [result] = results;
  assert.equal(result.transcript.calls[0].result.quality, "risky");
  assert.ok(result.deterministic.every((check) => check.passed), JSON.stringify(result.deterministic));
  assert.ok(Object.values(result.judge).every((item) => item.verdict === "pass"));
  assert.deepEqual(usage, { input_tokens: 42, output_tokens: 15 });

  const [first, second] = requests;
  assert.equal(first.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(first.headers.authorization, "Bearer secret");
  assert.equal(first.body.model, "vendor/model");
  assert.equal(first.body.messages[0].role, "system");
  assert.doesNotMatch(first.body.messages[0].content, /Instructions from the open-transfer-times/, "--no-server-instructions");
  const tool = first.body.tools.find((item) => item.function.name === "check_connection");
  assert.equal(tool.type, "function");
  assert.ok(tool.function.parameters.properties.layover_minutes);
  assert.equal(tool.function.parameters.$schema, undefined);
  // the tool result goes back as a "tool" message tied to the call id
  const toolMessage = second.body.messages.find((message) => message.role === "tool");
  assert.equal(toolMessage.tool_call_id, "call_1");
  assert.match(toolMessage.content, /^BER–FRA–PVG: AVOID/);
});

test("OpenAI-compatible provider: object arguments work, malformed arguments become a failed call", async () => {
  const objectArgs = scriptedFetch({ argumentsAsString: false });
  const ollama = createProvider({ provider: "ollama", model: "local", env: {}, fetchImpl: objectArgs.fetchImpl });
  const ok = await evaluate({ agent: ollama, judge: ollama, cases: [durationCase] });
  assert.equal(ok.results[0].transcript.calls[0].isError, false);
  assert.equal(objectArgs.requests[0].url, "http://127.0.0.1:11434/v1/chat/completions");
  assert.equal(objectArgs.requests[0].headers.authorization, undefined, "Ollama needs no key");

  const bad = scriptedFetch({ badArguments: true });
  const broken = createProvider({ provider: "ollama", model: "local", env: {}, fetchImpl: bad.fetchImpl });
  const failed = await evaluate({ agent: broken, judge: broken, cases: [durationCase] });
  assert.equal(failed.results[0].transcript.calls[0].isError, true);
  assert.match(failed.results[0].transcript.calls[0].text, /Invalid JSON arguments/);
  assert.ok(failed.results[0].deterministic.some((check) => check.id === "tool_calls_succeeded" && !check.passed));
});

test("provider setup errors are explicit", () => {
  assert.throws(() => createProvider({ provider: "nope" }), /Unknown provider "nope"/);
  assert.throws(() => createProvider({ provider: "openai", env: { OPENAI_API_KEY: "x" } }), /--model is required/);
  assert.throws(() => createProvider({ provider: "openai", model: "m", env: {} }), /Set OPENAI_API_KEY/);
  assert.throws(() => createProvider({ provider: "compatible", model: "m", env: { OPENAI_API_KEY: "x" } }), /needs a base URL/);
  const custom = createProvider({ provider: "compatible", model: "m", baseUrl: "http://host:8000/v1/", apiKeyEnv: "MY_KEY", env: { MY_KEY: "k" } });
  assert.equal(custom.name, "compatible:m");
  assert.equal(toFunctionTool({ name: "t", description: "d", inputSchema: { $schema: "x", type: "object", properties: {} } }).function.parameters.$schema, undefined);
});

test("comparison report lines up runs on shared cases and flags different judges", () => {
  const run = (agent, judge, passes, ids) => ({
    meta: { agent, judge, serverVersion: "0.2.0", usage: { input_tokens: 1, output_tokens: 2 } },
    results: ids.map((id, index) => ({
      id, category: "times", deterministic: [{ id: "tool_called", passed: passes[index], detail: "" }],
      judge: { numbers_match: { verdict: "pass", reason: "" } }
    }))
  });
  const markdown = compareRuns([
    run("anthropic:a", "anthropic:j", [true, false, true], ["c1", "c2", "c3"]),
    run("ollama:b", "anthropic:j", [true, true], ["c1", "c2"])
  ]);
  assert.match(markdown, /Compared on 2 case\(s\) present in every run\./);
  assert.match(markdown, /\| \*\*Runs passing every check\*\* \| \*\*50% \(1\/2\)\*\* \| \*\*100% \(2\/2\)\*\* \|/);
  assert.match(markdown, /\| tool_called \(tool call\) \| 50% \(1\/2\) \| 100% \(2\/2\) \|/);
  assert.doesNotMatch(markdown, /different judges/);
  assert.match(compareRuns([run("a", "j1", [true], ["c1"]), run("b", "j2", [true], ["c1"])]), /runs used different judges/);
});

test("CLI argument parsing and case selection", () => {
  const args = parseArgs(["--provider", "ollama", "--model", "qwen", "--judge-provider", "anthropic", "--category", "compare",
    "--limit", "2", "--repeat", "3", "--no-server-instructions"]);
  assert.deepEqual(args, { repeat: 3, serverInstructions: false, noThink: false, provider: "ollama", model: "qwen", judgeProvider: "anthropic", category: "compare", limit: 2 });
  assert.deepEqual(parseArgs(["--no-think", "--resume", "eval/results/x.json"]), { repeat: 1, serverInstructions: true, noThink: true, resume: "eval/results/x.json" });
  assert.equal(selectCases(cases, args).length, 2);
  assert.ok(selectCases(cases, args).every((testCase) => testCase.category === "compare"));
  assert.deepEqual(selectCases(cases, { only: ["low-vie-zh"] }).map((testCase) => testCase.id), ["low-vie-zh"]);
});

// --- robustness: thinking, connection errors, checkpoint and resume ---------

const { stripThinking } = require("../src/providers.js");
const { orderResults, runKey } = require("../src/run.js");
const http = require("node:http");
const os = require("node:os");
const { spawn } = require("node:child_process");

test("thinking blocks are removed from answers and judge replies", () => {
  assert.equal(stripThinking("<think>check {a} and {b}</think>\n{\"items\":{}}"), "{\"items\":{}}");
  assert.equal(stripThinking("unopened reasoning {x}</think>The answer."), "The answer.");
  assert.equal(stripThinking("Plain answer."), "Plain answer.");
  assert.equal(stripThinking(null), "");
});

test("--no-think appends /no_think to system and user prompts; Ollama defaults to 127.0.0.1", async () => {
  const { fetchImpl, requests } = scriptedFetch();
  const provider = createProvider({ provider: "ollama", model: "qwen3:4b", env: {}, fetchImpl, noThink: true });
  await evaluate({ agent: provider, judge: provider, cases: [durationCase] });
  assert.equal(requests[0].url, "http://127.0.0.1:11434/v1/chat/completions");
  assert.match(requests[0].body.messages[0].content, /\n\/no_think$/);
  assert.match(requests[0].body.messages[1].content, /\n\/no_think$/);
  const judgeRequest = requests.find((request) => !request.body.tools);
  assert.match(judgeRequest.body.messages[0].content, /\n\/no_think$/);
});

test("an unreachable endpoint gives an actionable error and stops after three in a row", async () => {
  const refused = async () => {
    const error = new TypeError("fetch failed");
    error.cause = { code: "ECONNREFUSED" };
    throw error;
  };
  const provider = createProvider({ provider: "ollama", model: "m", env: {}, fetchImpl: refused });
  const saved = [];
  const { results, stoppedEarly } = await evaluate({ agent: provider, judge: provider, cases: cases.slice(0, 6), onResult: (result) => saved.push(result.id) });
  assert.equal(results.length, 3, "stopped after three connection errors, not six");
  assert.deepEqual(saved, cases.slice(0, 3).map((testCase) => testCase.id), "every result was handed over for saving");
  assert.match(stoppedEarly, /Could not reach http:\/\/127\.0\.0\.1:11434\/v1\/chat\/completions \(ECONNREFUSED\)\. Is the server running\?/);
});

test("evaluate skips runs that are already done", async () => {
  const { fetchImpl, requests } = scriptedFetch();
  const provider = createProvider({ provider: "ollama", model: "m", env: {}, fetchImpl });
  const pair = [durationCase, cases.find((testCase) => testCase.id === "duration-doh-2h-en")];
  const { results } = await evaluate({ agent: provider, judge: provider, cases: pair, skip: new Set([runKey(durationCase.id, 1)]) });
  assert.deepEqual(results.map((result) => result.id), ["duration-doh-2h-en"]);
  assert.ok(requests.length > 0);
  assert.deepEqual(orderResults([{ id: "duration-doh-2h-en", run: 1 }, { id: durationCase.id, run: 1 }], pair).map((r) => r.id),
    [durationCase.id, "duration-doh-2h-en"]);
});

// A tiny OpenAI-compatible server that can be made to "die" partway through.
function fakeModelServer({ failAfterRequests = Infinity } = {}) {
  let count = 0;
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      count += 1;
      if (count > failAfterRequests) {
        req.socket.destroy(); // like a machine that stopped answering
        return;
      }
      const body = JSON.parse(raw);
      const reply = (payload) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (!body.tools) return reply({ choices: [{ message: { content: JUDGE_ALL_PASS(body.messages[0].content) } }] });
      const last = body.messages[body.messages.length - 1];
      if (last.role === "user") {
        const via = /Frankfurt|FRA|法兰克福/.test(last.content) ? "FRA" : "DOH";
        return reply({ choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{
          id: "c1", type: "function", function: { name: "check_connection", arguments: JSON.stringify({ from: "BER", via, to: "PVG", layover_minutes: 60 }) } }] } }] });
      }
      return reply({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: "<think>…</think>Answer." } }] });
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port })));
}

function runCli(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, "..", "src", "run.js"), ...args], { env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("an interrupted run is saved as it goes and can be resumed to completion", async () => {
  const resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-results-"));
  const ids = ["duration-fra-50-zh", "duration-doh-2h-en", "duration-ams-75-en", "duration-nrt-90-zh", "duration-hkg-60-en"];
  const common = ["--provider", "ollama", "--model", "m", "--only", ids.join(",")];
  try {
    // 1) The model server dies after two cases (each case: 2 agent calls + 1 judge call).
    const dying = await fakeModelServer({ failAfterRequests: 6 });
    const first = await runCli([...common, "--base-url", `http://127.0.0.1:${dying.port}/v1`], { EVAL_RESULTS_DIR: resultsDir });
    dying.server.close();
    assert.equal(first.code, 1, first.stderr);
    assert.match(first.stderr, /Stopped: Could not reach/);
    const [file] = fs.readdirSync(resultsDir).filter((name) => name.endsWith(".json"));
    const partial = JSON.parse(fs.readFileSync(path.join(resultsDir, file), "utf8"));
    assert.equal(partial.meta.status, "partial");
    assert.equal(partial.results.filter((result) => !result.error).length, 2, "the two finished cases were saved before the failure");

    // 2) Resuming with different settings is refused.
    const healthy = await fakeModelServer();
    const url = `http://127.0.0.1:${healthy.port}/v1`;
    const wrong = await runCli([...common, "--base-url", url, "--no-server-instructions", "--resume", path.join(resultsDir, file)], { EVAL_RESULTS_DIR: resultsDir });
    assert.equal(wrong.code, 2);
    assert.match(wrong.stderr, /Cannot resume: .*\n.*server instructions: was true, now false/);

    // 3) Resuming with the same settings keeps the two finished cases and runs the rest.
    const resumed = await runCli([...common, "--base-url", url, "--resume", path.join(resultsDir, file)], { EVAL_RESULTS_DIR: resultsDir });
    healthy.server.close();
    assert.equal(resumed.code, 0, resumed.stderr);
    assert.match(resumed.stderr, /Resuming .*: 2 finished run\(s\) kept, 3 failed run\(s\) will be retried\./);
    assert.match(resumed.stderr, /Running 3 of 5 run\(s\)/);
    const complete = JSON.parse(fs.readFileSync(path.join(resultsDir, file), "utf8"));
    assert.equal(complete.meta.status, "complete");
    assert.deepEqual(complete.results.map((result) => result.id), ids, "all cases, in case order, no duplicates");
    assert.ok(complete.results.every((result) => !result.error));
    assert.equal(complete.results[0].transcript.answer, "Answer.", "thinking stripped from the answer");
    assert.ok(fs.existsSync(path.join(resultsDir, file.replace(/\.json$/, ".md"))));
  } finally {
    fs.rmSync(resultsDir, { recursive: true, force: true });
  }
});

test("a comparison done with separate check_connection calls fails only compare_used", () => {
  const testCase = cases.find((c) => c.id === "compare-three-durations-zh");
  const calls = [["FRA", 50], ["IST", 180], ["DOH", 120]].map(([via, minutes]) =>
    ({ name: "check_connection", args: { from: "BER", via, to: "PVG", layover_minutes: minutes }, isError: false, result: {} }));
  const failed = deterministicChecks(testCase, { answer: "x", stopReason: "end_turn", calls })
    .filter((check) => !check.passed).map((check) => check.id);
  assert.deepEqual(failed, ["compare_used"]);
});

test("an expected value may list alternatives (Shanghai: PVG or SHA)", () => {
  const testCase = cases.find((c) => c.id === "times-fra-schengen-zh");
  for (const to of ["PVG", "SHA"]) {
    const calls = [{ name: "check_connection", args: { from: "BER", via: "FRA", to, arrival_time: "09:40", departure_time: "10:35" }, isError: false, result: {} }];
    assert.ok(deterministicChecks(testCase, { answer: "x", stopReason: "end_turn", calls }).every((check) => check.passed));
  }
  assert.ok(!legMatches({ to: ["PVG", "SHA"] }, { to: "HND" }));
});
