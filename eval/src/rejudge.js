#!/usr/bin/env node
"use strict";

// Grades the stored answers of an earlier run again with the current judge, without
// re-running the agent. Use it after changing the rubric or what the judge sees, so
// two runs are compared under the same grading.
//
//   npm run eval:rejudge -- eval/results/<run>.json --judge-provider <p> --judge-model <id>
//                           [--judge-base-url <url>] [--judge-api-key-env <ENV>] [--errors-only]
//
// Writes <run>-rejudged.json and .md next to the input; the input is not changed.
// Given a -rejudged.json file, it updates that file. --errors-only regrades only the
// runs whose judge failed (for example after a rate limit) and keeps the rest.

const fs = require("node:fs");
const path = require("node:path");
const { createProvider } = require("./providers.js");
const { judgeAnswer } = require("./judge.js");
const { buildReport } = require("./report.js");

const FLAGS = { "--judge-provider": "provider", "--judge-model": "model", "--judge-base-url": "baseUrl", "--judge-api-key-env": "apiKeyEnv" };

function parseRejudgeArgs(argv) {
  const out = { file: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (FLAGS[argv[i]]) out[FLAGS[argv[i]]] = argv[++i];
    else if (argv[i] === "--help" || argv[i] === "-h") out.help = true;
    else if (argv[i] === "--errors-only") out.errorsOnly = true;
    else if (!out.file) out.file = argv[i];
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return out;
}

const judgeFailed = (result) => Object.values(result.judge || {}).some((item) => item.verdict === "error");

async function rejudge({ data, cases, judge, errorsOnly = false, onProgress = () => {} }) {
  const byId = new Map(cases.map((testCase) => [testCase.id, testCase]));
  const results = [];
  for (const result of data.results) {
    const testCase = byId.get(result.id);
    // Runs that failed before an answer, or cases that no longer exist, keep their old grading.
    if (!result.transcript || !testCase || (errorsOnly && !judgeFailed(result))) {
      results.push(result);
      continue;
    }
    const judged = { ...result, judge: await judgeAnswer({ judge, testCase, transcript: result.transcript }) };
    results.push(judged);
    onProgress(judged);
  }
  return { meta: { ...data.meta, judge: judge.name, rejudgedAt: new Date().toISOString() }, results };
}

async function main() {
  let args;
  try {
    args = parseRejudgeArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  if (args.help || !args.file) {
    console.log("Usage: npm run eval:rejudge -- <run.json> --judge-provider <p> --judge-model <id> [--judge-base-url <url>] [--judge-api-key-env <ENV>] [--errors-only]");
    process.exit(args.help ? 0 : 2);
  }
  const data = JSON.parse(fs.readFileSync(args.file, "utf8"));
  const { cases } = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "cases.json"), "utf8"));
  let judge;
  try {
    judge = createProvider({ provider: args.provider, model: args.model, baseUrl: args.baseUrl, apiKeyEnv: args.apiKeyEnv });
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  if (data.meta?.judge && data.meta.judge !== judge.name) {
    console.error(`Note: this run was graded by ${data.meta.judge}; regrading with ${judge.name}.`);
  }
  const todo = data.results.filter((result) => result.transcript && (!args.errorsOnly || judgeFailed(result))).length;
  console.error(`Regrading ${todo} stored answer(s) with ${judge.name}`);
  const out = await rejudge({
    data, cases, judge, errorsOnly: args.errorsOnly,
    onProgress: (result) => {
      const failed = result.deterministic.filter((check) => !check.passed).length +
        Object.values(result.judge || {}).filter((item) => item.verdict === "fail" || item.verdict === "error").length;
      console.error(`${failed ? "✗" : "✓"} ${result.id} #${result.run}`);
    }
  });
  const jsonPath = /-rejudged\.json$/.test(args.file) ? args.file : args.file.replace(/\.json$/, "-rejudged.json");
  fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2));
  const report = buildReport({ results: out.results, meta: out.meta });
  fs.writeFileSync(jsonPath.replace(/\.json$/, ".md"), report.markdown);
  console.log(report.markdown);
  const failed = out.results.filter(judgeFailed).length;
  console.error(`Saved ${jsonPath} and .md`);
  if (failed) console.error(`${failed} run(s) still have judge errors. Retry them with:\n  npm run eval:rejudge -- ${jsonPath} <same judge options> --errors-only`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { rejudge, parseRejudgeArgs, judgeFailed };
