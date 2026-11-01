#!/usr/bin/env node
"use strict";

// Usage:
//   ANTHROPIC_API_KEY=... npm run eval -- [--model <id>] [--judge-model <id>]
//                                         [--only <id,...>] [--category <name>] [--limit <n>] [--repeat <n>]
//
// Writes eval/results/<timestamp>.json and .md and prints the summary.

const fs = require("node:fs");
const path = require("node:path");
const { connectServer, runAgent } = require("./agent.js");
const { deterministicChecks } = require("./checks.js");
const { judgeAnswer } = require("./judge.js");
const { buildReport } = require("./report.js");

const DEFAULT_MODEL = "claude-sonnet-5-5";

function parseArgs(argv) {
  const args = { repeat: 1 };
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (flag === "--model") args.model = value;
    else if (flag === "--judge-model") args.judgeModel = value;
    else if (flag === "--only") args.only = value.split(",");
    else if (flag === "--category") args.category = value;
    else if (flag === "--limit") args.limit = Number(value);
    else if (flag === "--repeat") args.repeat = Number(value);
    else if (flag === "--help") args.help = true;
    else continue;
    if (flag !== "--help") i += 1;
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

async function evaluate({ anthropic, cases, model, judgeModel, repeat = 1, onProgress = () => {} }) {
  const server = await connectServer();
  const results = [];
  const usage = { input_tokens: 0, output_tokens: 0 };
  try {
    for (const testCase of cases) {
      for (let run = 1; run <= repeat; run += 1) {
        const base = { id: testCase.id, category: testCase.category, prompt: testCase.prompt, run };
        try {
          const transcript = await runAgent({ anthropic, server, model, prompt: testCase.prompt });
          usage.input_tokens += transcript.usage.input_tokens;
          usage.output_tokens += transcript.usage.output_tokens;
          const deterministic = deterministicChecks(testCase, transcript);
          const judge = await judgeAnswer({ anthropic, model: judgeModel, testCase, transcript });
          results.push({ ...base, transcript, deterministic, judge });
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: npm run eval -- [--model id] [--judge-model id] [--only id,...] [--category name] [--limit n] [--repeat n]");
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Set ANTHROPIC_API_KEY to run the evaluation (it calls the Claude API).");
    process.exit(2);
  }
  const Anthropic = require("@anthropic-ai/sdk").default;
  const anthropic = new Anthropic();
  const model = args.model || process.env.EVAL_MODEL || DEFAULT_MODEL;
  const judgeModel = args.judgeModel || process.env.EVAL_JUDGE_MODEL || model;
  const { cases: all } = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "cases.json"), "utf8"));
  const cases = selectCases(all, args);
  const startedAt = new Date().toISOString();
  console.error(`Running ${cases.length} case(s) × ${args.repeat} with ${model} (judge: ${judgeModel})`);

  const { results, usage } = await evaluate({
    anthropic, cases, model, judgeModel, repeat: args.repeat,
    onProgress: (result) => {
      const failed = result.deterministic.filter((check) => !check.passed).length +
        Object.values(result.judge || {}).filter((item) => item.verdict === "fail" || item.verdict === "error").length;
      console.error(`${failed ? "✗" : "✓"} ${result.id}${args.repeat > 1 ? ` #${result.run}` : ""}${failed ? ` (${failed} failed)` : ""}`);
    }
  });

  const serverVersion = require("../../packages/mcp/package.json").version;
  const report = buildReport({ results, meta: { model, judgeModel, serverVersion, repeat: args.repeat, startedAt, usage } });
  const outDir = path.join(__dirname, "..", "results");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = startedAt.replace(/[:.]/g, "-");
  fs.writeFileSync(path.join(outDir, `${stamp}.json`), JSON.stringify({ meta: { model, judgeModel, serverVersion, startedAt, usage }, results }, null, 2));
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

module.exports = { evaluate, parseArgs, selectCases, DEFAULT_MODEL };
