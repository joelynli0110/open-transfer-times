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

// Gold-set metrics (eval/gold.json), comparable across modes:
//   outcome: the answer's conclusion is one the gold set allows
//   points: the answer covers the gold set's required points
//   unsafe: the answer calls a connection workable when the gold set does not allow it
//   consistent: every run of a case reached the same conclusion
function goldSummary(results) {
  const graded = results.filter((result) => result.gold && result.gold.label);
  const count = (fn) => graded.filter(fn).length;
  const withPoints = graded.filter((result) => result.gold.items.gold_points.verdict !== "n/a");
  const byCase = new Map();
  for (const result of graded) byCase.set(result.id, [...(byCase.get(result.id) || []), result.gold.label]);
  const repeated = [...byCase.values()].filter((labels) => labels.length > 1);
  return {
    graded: graded.length,
    errors: results.filter((result) => result.gold && !result.gold.label).length,
    outcome: { passed: count((result) => result.gold.items.gold_outcome.verdict === "pass"), total: graded.length },
    points: { passed: withPoints.filter((result) => result.gold.items.gold_points.verdict === "pass").length, total: withPoints.length },
    unsafe: { passed: count((result) => result.gold.unsafe), total: graded.length },
    consistent: { passed: repeated.filter((labels) => labels.every((label) => label === labels[0])).length, total: repeated.length }
  };
}

function buildReport({ results, meta }) {
  const outcomes = results.map((result) => ({ result, ...caseOutcome(result) }));
  const lines = [];
  const passedCases = outcomes.filter((outcome) => outcome.passed).length;

  lines.push("# Agent evaluation report", "");
  lines.push(`- Agent: \`${meta.agent}\` · Judge: \`${meta.judge}\`${meta.serverInstructions === false ? " · without server instructions" : ""}`);
  lines.push(`- Server: open-transfer-times-mcp ${meta.serverVersion} · Cases: ${results.length}${meta.repeat > 1 ? ` (${meta.repeat} runs each)` : ""}`);
  lines.push(`- Mode: ${meta.mode || "mcp"}${meta.mode === "no-tools" ? " (no tools, own knowledge)" : meta.mode === "docs" ? " (no tools, airport data in the prompt)" : ""}`);
  lines.push(`- Run: ${meta.startedAt}`);
  lines.push(`- Tokens: ${meta.usage.input_tokens} in / ${meta.usage.output_tokens} out (agent only)`);
  const gold = goldSummary(results);
  if (gold.graded) {
    lines.push("", `## Against the gold set${meta.goldStatus === "draft" ? " (draft, not yet reviewed)" : ""}`, "",
      "| Measure | Result |", "| --- | --- |",
      `| Conclusion allowed by the gold set | ${gold.outcome.passed}/${gold.outcome.total} (${pct(gold.outcome.passed, gold.outcome.total)}) |`,
      `| Required points covered | ${gold.points.passed}/${gold.points.total} (${pct(gold.points.passed, gold.points.total)}) |`,
      `| Called a connection workable when it is not (lower is better) | ${gold.unsafe.passed}/${gold.unsafe.total} (${pct(gold.unsafe.passed, gold.unsafe.total)}) |`,
      `| Same conclusion in every run of a case | ${gold.consistent.passed}/${gold.consistent.total} (${pct(gold.consistent.passed, gold.consistent.total)}) |`);
    if (gold.errors) lines.push("", `${gold.errors} run(s) could not be graded against the gold set (judge errors).`);
  }
  if ((meta.mode || "mcp") !== "mcp") {
    // Without tools there are no tool checks and nothing for the tool-grounded rubric to compare against.
    lines.push("", "Tool checks and the tool-grounded rubric apply to mcp runs only.", "");
    return { markdown: lines.join("\n") + "\n", passedCases: null, total: results.length, gold };
  }
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
  return { markdown: lines.join("\n") + "\n", passedCases, total: results.length, gold };
}

module.exports = { buildReport, caseOutcome, goldSummary };
