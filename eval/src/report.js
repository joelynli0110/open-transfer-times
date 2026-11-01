"use strict";

// Turns graded results into a markdown report: pass rate per check, per
// category, and every failure with its reason.

function pct(passed, total) {
  return total ? `${Math.round((passed / total) * 100)}%` : "–";
}

function caseOutcome(result) {
  const checks = [
    ...result.deterministic.map((check) => ({ id: check.id.replace(/^expected_call_\d+$/, "expected_call"), passed: check.passed, detail: check.detail, kind: "tool" })),
    ...Object.entries(result.judge || {})
      .filter(([, item]) => item.verdict !== "n/a")
      .map(([id, item]) => ({ id, passed: item.verdict === "pass", detail: item.reason, kind: "answer" }))
  ];
  return { checks, passed: checks.every((check) => check.passed) };
}

function buildReport({ results, meta }) {
  const outcomes = results.map((result) => ({ result, ...caseOutcome(result) }));
  const lines = [];
  const passedCases = outcomes.filter((outcome) => outcome.passed).length;

  lines.push("# Agent evaluation report", "");
  lines.push(`- Model: \`${meta.model}\` · Judge: \`${meta.judgeModel}\``);
  lines.push(`- Server: open-transfer-times-mcp ${meta.serverVersion} · Cases: ${results.length}${meta.repeat > 1 ? ` (${meta.repeat} runs each)` : ""}`);
  lines.push(`- Run: ${meta.startedAt}`);
  lines.push(`- Tokens: ${meta.usage.input_tokens} in / ${meta.usage.output_tokens} out (agent only)`);
  lines.push("", `**${passedCases} of ${results.length} runs passed every check (${pct(passedCases, results.length)}).**`, "");

  const byCheck = new Map();
  for (const outcome of outcomes) {
    for (const check of outcome.checks) {
      const key = `${check.kind}:${check.id}`;
      const entry = byCheck.get(key) || { kind: check.kind, id: check.id, passed: 0, total: 0 };
      entry.total += 1;
      if (check.passed) entry.passed += 1;
      byCheck.set(key, entry);
    }
  }
  lines.push("## By check", "", "| Check | Type | Passed | Rate |", "| --- | --- | --- | --- |");
  for (const entry of [...byCheck.values()].sort((a, b) => a.passed / a.total - b.passed / b.total)) {
    lines.push(`| ${entry.id} | ${entry.kind === "tool" ? "tool call" : "answer (judge)"} | ${entry.passed}/${entry.total} | ${pct(entry.passed, entry.total)} |`);
  }

  const byCategory = new Map();
  for (const outcome of outcomes) {
    const entry = byCategory.get(outcome.result.category) || { passed: 0, total: 0 };
    entry.total += 1;
    if (outcome.passed) entry.passed += 1;
    byCategory.set(outcome.result.category, entry);
  }
  lines.push("", "## By category", "", "| Category | Runs passed | Rate |", "| --- | --- | --- |");
  for (const [category, entry] of [...byCategory.entries()].sort()) {
    lines.push(`| ${category} | ${entry.passed}/${entry.total} | ${pct(entry.passed, entry.total)} |`);
  }

  const failures = outcomes.filter((outcome) => !outcome.passed);
  lines.push("", "## Failures", "");
  if (!failures.length) lines.push("None.");
  for (const outcome of failures) {
    const { result } = outcome;
    lines.push(`### ${result.id}${result.run > 1 ? ` (run ${result.run})` : ""}`, "", `> ${result.prompt}`, "");
    for (const check of outcome.checks.filter((item) => !item.passed)) lines.push(`- **${check.id}**: ${check.detail}`);
    if (result.error) lines.push(`- **error**: ${result.error}`);
    lines.push("", "<details><summary>Answer</summary>", "", result.transcript?.answer || "(none)", "", "</details>", "");
  }
  return { markdown: lines.join("\n") + "\n", passedCases, total: results.length };
}

module.exports = { buildReport, caseOutcome };
