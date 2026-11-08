#!/usr/bin/env node
"use strict";

// Compares evaluation runs side by side.
//
//   npm run eval:compare -- eval/results/<run-a>.json eval/results/<run-b>.json [...] [--out comparison.md]
//
// One column per run: share of runs passing every check, then each check's pass
// rate, then each category. Only cases present in every run are compared, so
// runs over different case sets stay comparable.

const fs = require("node:fs");
const { caseOutcome } = require("./report.js");

function pct(passed, total) {
  return total ? `${Math.round((passed / total) * 100)}% (${passed}/${total})` : "–";
}

function label(meta) {
  return `${meta.agent}${meta.serverInstructions === false ? " (no instructions)" : ""} · ${meta.serverVersion}`;
}

function compareRuns(runs) {
  const shared = runs
    .map((run) => new Set(run.results.map((result) => result.id)))
    .reduce((acc, ids) => new Set([...acc].filter((id) => ids.has(id))));
  const outcomes = runs.map((run) => run.results.filter((result) => shared.has(result.id)).map((result) => ({ result, ...caseOutcome(result) })));
  const judges = [...new Set(runs.map((run) => run.meta.judge))];

  const lines = ["# Agent evaluation: comparison", ""];
  lines.push(`Compared on ${shared.size} case(s) present in every run.`);
  if (judges.length > 1) lines.push(`**Warning:** runs used different judges (${judges.join(", ")}); answer checks are not directly comparable.`);
  // A judge error (rate limit, unreadable reply) counts as a failed check; say so, or the table looks like a regression.
  outcomes.forEach((list, index) => {
    const errors = list.filter((o) => Object.values(o.result.judge || {}).some((item) => item.verdict === "error")).length;
    if (errors) lines.push(`**Warning:** ${label(runs[index].meta)} has ${errors} run(s) with judge errors, counted as failures. Regrade them with \`npm run eval:rejudge -- <file> <judge options> --errors-only\`.`);
  });
  lines.push("", `| | ${runs.map((run) => label(run.meta)).join(" | ")} |`, `| --- |${runs.map(() => " --- |").join("")}`);
  lines.push(`| **Runs passing every check** | ${outcomes.map((list) => `**${pct(list.filter((o) => o.passed).length, list.length)}**`).join(" | ")} |`);

  const checkIds = [...new Set(outcomes.flatMap((list) => list.flatMap((o) => o.checks.map((c) => `${c.kind}:${c.id}`))))].sort();
  for (const key of checkIds) {
    const [kind, id] = key.split(":");
    const cells = outcomes.map((list) => {
      const checks = list.flatMap((o) => o.checks.filter((c) => c.kind === kind && c.id === id));
      return checks.length ? pct(checks.filter((c) => c.passed).length, checks.length) : "–";
    });
    lines.push(`| ${id} (${kind === "tool" ? "tool call" : "answer"}) | ${cells.join(" | ")} |`);
  }

  const categories = [...new Set(outcomes.flatMap((list) => list.map((o) => o.result.category)))].sort();
  lines.push("", "## By category", "", `| Category | ${runs.map((run) => label(run.meta)).join(" | ")} |`, `| --- |${runs.map(() => " --- |").join("")}`);
  for (const category of categories) {
    const cells = outcomes.map((list) => {
      const inCategory = list.filter((o) => o.result.category === category);
      return pct(inCategory.filter((o) => o.passed).length, inCategory.length);
    });
    lines.push(`| ${category} | ${cells.join(" | ")} |`);
  }

  lines.push("", "## Token use (agent)", "", `| | ${runs.map((run) => label(run.meta)).join(" | ")} |`, `| --- |${runs.map(() => " --- |").join("")}`);
  lines.push(`| input / output | ${runs.map((run) => `${run.meta.usage.input_tokens} / ${run.meta.usage.output_tokens}`).join(" | ")} |`);
  return lines.join("\n") + "\n";
}

function main() {
  const files = [];
  let out = null;
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--out") {
      out = argv[i + 1];
      i += 1;
    } else {
      files.push(argv[i]);
    }
  }
  if (files.length < 2) {
    console.error("Usage: npm run eval:compare -- <run-a>.json <run-b>.json [...] [--out file.md]");
    process.exit(2);
  }
  const runs = files.map((file) => JSON.parse(fs.readFileSync(file, "utf8")));
  for (const [index, run] of runs.entries()) {
    // Results written before providers existed carry model/judgeModel instead of agent/judge.
    run.meta.agent = run.meta.agent || `anthropic:${run.meta.model}`;
    run.meta.judge = run.meta.judge || `anthropic:${run.meta.judgeModel}`;
    if (!run.results) throw new Error(`${files[index]} is not an eval result file`);
  }
  const markdown = compareRuns(runs);
  if (out) fs.writeFileSync(out, markdown);
  console.log(markdown);
}

if (require.main === module) main();

module.exports = { compareRuns };
