#!/usr/bin/env node
"use strict";

// Usage:
//   npm run eval -- [--provider anthropic|openai|openrouter|ollama|compatible] [--model <id>]
//                   [--base-url <url>] [--api-key-env <ENV_NAME>]
//                   [--judge-provider <p>] [--judge-model <id>] [--judge-base-url <url>] [--judge-api-key-env <ENV>]
//                   [--no-server-instructions]
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
  const args = { repeat: 1, serverInstructions: true };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--help") args.help = true;
    else if (flag === "--no-server-instructions") args.serverInstructions = false;
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

async function evaluate({ agent, judge, cases, repeat = 1, serverInstructions = true, onProgress = () => {} }) {
  const server = await connectServer();
  const system = systemPrompt(server, serverInstructions);
  const results = [];
  const usage = { input_tokens: 0, output_tokens: 0 };
  try {
    for (const testCase of cases) {
      for (let run = 1; run <= repeat; run += 1) {
        const base = { id: testCase.id, category: testCase.category, prompt: testCase.prompt, run };
        try {
          const transcript = await agent.runAgent({ server, prompt: testCase.prompt, system });
          usage.input_tokens += transcript.usage.input_tokens;
          usage.output_tokens += transcript.usage.output_tokens;
          const deterministic = deterministicChecks(testCase, transcript);
          const verdicts = await judgeAnswer({ judge, testCase, transcript });
          results.push({ ...base, transcript, deterministic, judge: verdicts });
        } catch (error) {
          results.push({ ...base, error: String(error.message || error), deterministic: [{ id: "run_completed", passed: false, detail: String(error.message || error) }], judge: {} });
        }
        onProgress(results[results.length - 1]);
      }
    }
  } finally {
    await server.close();
  }
  return { results, usage };
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
  --only <id,...>  --category <name>  --limit <n>  --repeat <n>

Examples:
  npm run eval -- --limit 5
  npm run eval -- --provider ollama --model qwen2.5:7b --judge-provider anthropic
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
    agent = createProvider({ provider: args.provider, model: args.model, baseUrl: args.baseUrl, apiKeyEnv: args.apiKeyEnv });
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
      apiKeyEnv: args.judgeApiKeyEnv || (inherit ? args.apiKeyEnv : undefined)
    });
  } catch (error) {
    console.error(error.message);
    console.error("Run with --help for options.");
    process.exit(2);
  }

  const { cases: all } = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "cases.json"), "utf8"));
  const cases = selectCases(all, args);
  const startedAt = new Date().toISOString();
  console.error(`Running ${cases.length} case(s) × ${args.repeat} with ${agent.name} (judge: ${judge.name})` +
    `${args.serverInstructions ? "" : ", without server instructions"}`);

  const { results, usage } = await evaluate({
    agent, judge, cases, repeat: args.repeat, serverInstructions: args.serverInstructions,
    onProgress: (result) => {
      const failed = result.deterministic.filter((check) => !check.passed).length +
        Object.values(result.judge || {}).filter((item) => item.verdict === "fail" || item.verdict === "error").length;
      console.error(`${failed ? "✗" : "✓"} ${result.id}${args.repeat > 1 ? ` #${result.run}` : ""}${failed ? ` (${failed} failed)` : ""}`);
    }
  });

  const serverVersion = require("../../packages/mcp/package.json").version;
  const meta = { agent: agent.name, judge: judge.name, serverVersion, serverInstructions: args.serverInstructions, repeat: args.repeat, startedAt, usage };
  const report = buildReport({ results, meta });
  const outDir = path.join(__dirname, "..", "results");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = `${startedAt.replace(/[:.]/g, "-")}-${agent.name.replace(/[^a-zA-Z0-9.-]+/g, "_")}`;
  fs.writeFileSync(path.join(outDir, `${stamp}.json`), JSON.stringify({ meta, results }, null, 2));
  fs.writeFileSync(path.join(outDir, `${stamp}.md`), report.markdown);
  console.log(report.markdown);
  console.error(`Saved eval/results/${stamp}.md and .json`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { evaluate, parseArgs, selectCases, systemPrompt };
