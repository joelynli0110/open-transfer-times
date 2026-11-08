#!/usr/bin/env node
"use strict";

// Usage:
//   npm run eval -- [--provider anthropic|openai|openrouter|ollama|compatible] [--model <id>]
//                   [--base-url <url>] [--api-key-env <ENV_NAME>]
//                   [--judge-provider <p>] [--judge-model <id>] [--judge-base-url <url>] [--judge-api-key-env <ENV>]
//                   [--no-server-instructions] [--no-think] [--resume <results.json>]
//                   [--only <id,...>] [--category <name>] [--limit <n>] [--repeat <n>]
//
// Writes eval/results/<timestamp>-<model>.json and .md and prints the summary.

const fs = require("node:fs");
const path = require("node:path");
const { connectServer } = require("./agent.js");
const { createProvider, DEFAULT_SYSTEM } = require("./providers.js");
const { deterministicChecks } = require("./checks.js");
const { judgeAnswer } = require("./judge.js");
const { buildReport } = require("./report.js");

const VALUE_FLAGS = {
  "--provider": "provider", "--model": "model", "--base-url": "baseUrl", "--api-key-env": "apiKeyEnv",
  "--judge-provider": "judgeProvider", "--judge-model": "judgeModel", "--judge-base-url": "judgeBaseUrl",
  "--judge-api-key-env": "judgeApiKeyEnv", "--only": "only", "--category": "category", "--limit": "limit", "--repeat": "repeat"
};

function parseArgs(argv) {
  const args = { repeat: 1, serverInstructions: true, noThink: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--help") args.help = true;
    else if (flag === "--no-server-instructions") args.serverInstructions = false;
    else if (flag === "--no-think") args.noThink = true;
    else if (flag === "--resume") {
      args.resume = argv[i + 1];
      i += 1;
    }
    else if (VALUE_FLAGS[flag]) {
      const key = VALUE_FLAGS[flag];
      const value = argv[i + 1];
      args[key] = key === "only" ? value.split(",") : key === "limit" || key === "repeat" ? Number(value) : value;
      i += 1;
    }
  }
  return args;
}

function selectCases(all, args) {
  let cases = all;
  if (args.only) cases = cases.filter((testCase) => args.only.includes(testCase.id));
  if (args.category) cases = cases.filter((testCase) => testCase.category === args.category);
  if (args.limit) cases = cases.slice(0, args.limit);
  return cases;
}

// The system prompt the agent sees. MCP clients differ in whether they pass a
// server's instructions to the model; by default we do, like clients that support it.
function systemPrompt(server, serverInstructions) {
  return serverInstructions && server.instructions
    ? `${DEFAULT_SYSTEM}\n\nInstructions from the open-transfer-times tool server:\n${server.instructions}`
    : DEFAULT_SYSTEM;
}

const runKey = (id, run) => `${id}#${run}`;
// After this many consecutive "could not reach the model" errors, stop instead
// of marking every remaining case as failed.
const MAX_CONSECUTIVE_CONNECTION_ERRORS = 3;

/**
 * @param {object} options
 * @param {Set<string>} [options.skip]       `${id}#${run}` keys already done (when resuming)
 * @param {(result) => void} [options.onResult]  called after every case, e.g. to save progress
 */
async function evaluate({ agent, judge, cases, repeat = 1, serverInstructions = true, skip = new Set(), onResult = () => {}, onProgress = () => {} }) {
  const server = await connectServer();
  const system = systemPrompt(server, serverInstructions);
  const results = [];
  const usage = { input_tokens: 0, output_tokens: 0 };
  let connectionErrors = 0;
  let stoppedEarly = null;
  try {
    outer: for (const testCase of cases) {
      for (let run = 1; run <= repeat; run += 1) {
        if (skip.has(runKey(testCase.id, run))) continue;
        const base = { id: testCase.id, category: testCase.category, prompt: testCase.prompt, run };
        let result;
        try {
          const transcript = await agent.runAgent({ server, prompt: testCase.prompt, system });
          usage.input_tokens += transcript.usage.input_tokens;
          usage.output_tokens += transcript.usage.output_tokens;
          const deterministic = deterministicChecks(testCase, transcript);
          const verdicts = await judgeAnswer({ judge, testCase, transcript });
          result = { ...base, transcript, deterministic, judge: verdicts };
          connectionErrors = 0;
        } catch (error) {
          const message = String(error.message || error);
          result = { ...base, error: message, deterministic: [{ id: "run_completed", passed: false, detail: message }], judge: {} };
          connectionErrors = /^Could not reach /.test(message) ? connectionErrors + 1 : 0;
        }
        results.push(result);
        onResult(result, usage);
        onProgress(result);
        if (connectionErrors >= MAX_CONSECUTIVE_CONNECTION_ERRORS) {
          stoppedEarly = result.error;
          break outer;
        }
      }
    }
  } finally {
    await server.close();
  }
  return { results, usage, stoppedEarly };
}

// Results in case order, then run order, whatever order they were produced in.
function orderResults(results, cases) {
  const position = new Map(cases.map((testCase, index) => [testCase.id, index]));
  return [...results].sort((a, b) => (position.get(a.id) ?? 1e9) - (position.get(b.id) ?? 1e9) || a.run - b.run);
}

const HELP = `Usage: npm run eval -- [options]

Agent model:
  --provider <name>        anthropic (default), openai, openrouter, ollama, compatible
  --model <id>             model id (required except for anthropic)
  --base-url <url>         endpoint for "compatible" (or to override a preset)
  --api-key-env <ENV>      environment variable holding the API key

Judge model (defaults to the agent's provider and model):
  --judge-provider, --judge-model, --judge-base-url, --judge-api-key-env

Other:
  --no-server-instructions  do not pass the MCP server's instructions to the agent
  --no-think                ask reasoning models (e.g. qwen3) to skip their thinking phase: much faster
  --resume <results.json>   continue an interrupted run; finished cases are kept, failed ones re-run
  --only <id,...>  --category <name>  --limit <n>  --repeat <n>

Examples:
  npm run eval -- --limit 5
  npm run eval -- --provider ollama --model qwen3:4b --no-think --judge-provider anthropic
  npm run eval -- <the interrupted run's options> --resume eval/results/<interrupted-run>.json
  npm run eval -- --provider openrouter --model <vendor/model> --judge-provider anthropic`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }
  let agent;
  let judge;
  try {
    agent = createProvider({ provider: args.provider, model: args.model, baseUrl: args.baseUrl, apiKeyEnv: args.apiKeyEnv, noThink: args.noThink });
    // The judge inherits every setting it was not given, but only from the agent's
    // own provider: a different judge provider starts from its own preset.
    const agentProvider = args.provider || "anthropic";
    const judgeProvider = args.judgeProvider || agentProvider;
    const inherit = judgeProvider === agentProvider;
    const anyJudgeFlag = args.judgeProvider || args.judgeModel || args.judgeBaseUrl || args.judgeApiKeyEnv;
    judge = !anyJudgeFlag ? agent : createProvider({
      provider: judgeProvider,
      model: args.judgeModel || (inherit ? args.model : undefined),
      baseUrl: args.judgeBaseUrl || (inherit ? args.baseUrl : undefined),
      apiKeyEnv: args.judgeApiKeyEnv || (inherit ? args.apiKeyEnv : undefined),
      noThink: args.noThink
    });
  } catch (error) {
    console.error(error.message);
    console.error("Run with --help for options.");
    process.exit(2);
  }

  const { cases: all } = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "cases.json"), "utf8"));
  const cases = selectCases(all, args);
  const serverVersion = require("../../packages/mcp/package.json").version;
  const outDir = process.env.EVAL_RESULTS_DIR || path.join(__dirname, "..", "results");
  fs.mkdirSync(outDir, { recursive: true });

  // A new run, or the continuation of an interrupted one (same file, same settings).
  let startedAt = new Date().toISOString();
  let kept = [];
  let previousUsage = { input_tokens: 0, output_tokens: 0 };
  let jsonPath = path.join(outDir, `${startedAt.replace(/[:.]/g, "-")}-${agent.name.replace(/[^a-zA-Z0-9.-]+/g, "_")}.json`);
  if (args.resume) {
    let previous;
    try {
      previous = JSON.parse(fs.readFileSync(args.resume, "utf8"));
    } catch (error) {
      console.error(`Cannot read ${args.resume}: ${error.message}`);
      process.exit(2);
    }
    const mismatches = [
      ["agent", previous.meta.agent, agent.name],
      ["judge", previous.meta.judge, judge.name],
      ["server version", previous.meta.serverVersion, serverVersion],
      ["server instructions", previous.meta.serverInstructions, args.serverInstructions],
      ["repeat", previous.meta.repeat, args.repeat]
    ].filter(([, before, now]) => before !== now);
    if (mismatches.length) {
      console.error("Cannot resume: the settings differ from the interrupted run, so the results would not be comparable:");
      for (const [name, before, now] of mismatches) console.error(`  ${name}: was ${before}, now ${now}`);
      process.exit(2);
    }
    jsonPath = path.resolve(args.resume);
    startedAt = previous.meta.startedAt;
    previousUsage = previous.meta.usage || previousUsage;
    kept = previous.results.filter((result) => !result.error);
    console.error(`Resuming ${path.basename(jsonPath)}: ${kept.length} finished run(s) kept, ` +
      `${previous.results.length - kept.length} failed run(s) will be retried.`);
  }
  const skip = new Set(kept.map((result) => runKey(result.id, result.run)));

  const totalRuns = cases.length * args.repeat;
  const alreadyDone = cases.reduce((count, testCase) => {
    for (let run = 1; run <= args.repeat; run += 1) if (skip.has(runKey(testCase.id, run))) count += 1;
    return count;
  }, 0);
  console.error(`Running ${totalRuns - alreadyDone} of ${totalRuns} run(s) with ${agent.name} (judge: ${judge.name})` +
    `${args.serverInstructions ? "" : ", without server instructions"}${args.noThink ? ", no thinking" : ""}`);
  console.error(`Progress is saved after every case to ${path.relative(process.cwd(), jsonPath)}`);

  const meta = (status, usage) => ({
    agent: agent.name, judge: judge.name, serverVersion, serverInstructions: args.serverInstructions,
    noThink: args.noThink, repeat: args.repeat, startedAt, status,
    usage: { input_tokens: previousUsage.input_tokens + usage.input_tokens, output_tokens: previousUsage.output_tokens + usage.output_tokens }
  });
  const fresh = [];
  const save = (status, usage) => {
    const results = orderResults([...kept, ...fresh], cases);
    fs.writeFileSync(jsonPath, JSON.stringify({ meta: meta(status, usage), results }, null, 2));
    return results;
  };

  const { usage, stoppedEarly } = await evaluate({
    agent, judge, cases, repeat: args.repeat, serverInstructions: args.serverInstructions, skip,
    onResult: (result, usageSoFar) => {
      fresh.push(result);
      save("partial", usageSoFar);
    },
    onProgress: (result) => {
      const failed = result.deterministic.filter((check) => !check.passed).length +
        Object.values(result.judge || {}).filter((item) => item.verdict === "fail" || item.verdict === "error").length;
      console.error(`${failed ? "✗" : "✓"} ${result.id}${args.repeat > 1 ? ` #${result.run}` : ""}${failed ? ` (${failed} failed)` : ""}`);
    }
  });

  if (stoppedEarly) {
    save("partial", usage);
    console.error(`\nStopped: ${stoppedEarly}`);
    console.error(`Fix the connection, then continue with:\n  npm run eval -- <same options> --resume ${path.relative(process.cwd(), jsonPath)}`);
    // Not process.exit(): on Windows, exiting while the MCP server's pipes are still closing can crash Node
    // (libuv assertion in src\\win\\async.c, exit code 3221226505). Let the event loop drain instead.
    process.exitCode = 1;
    return;
  }
  const results = save("complete", usage);
  const report = buildReport({ results, meta: meta("complete", usage) });
  const mdPath = jsonPath.replace(/\.json$/, ".md");
  fs.writeFileSync(mdPath, report.markdown);
  console.log(report.markdown);
  console.error(`Saved ${path.relative(process.cwd(), mdPath)} and .json`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { evaluate, parseArgs, selectCases, systemPrompt, orderResults, runKey };
