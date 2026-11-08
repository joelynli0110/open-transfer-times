#!/usr/bin/env node
"use strict";

// Lists every failed check in a run with its reason and the start of the answer.
//
//   npm run eval:failures -- eval/results/<run>.json [check-id-prefix ...]

const fs = require("node:fs");
const [file, ...only] = process.argv.slice(2);
if (!file) {
  console.error("Usage: npm run eval:failures -- <run.json> [check-id-prefix ...]");
  process.exit(2);
}
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const results = data.results || [];
for (const r of results) {
  const fails = [
    ...(r.deterministic || []).filter((c) => !c.passed).map((c) => [c.id, c.detail]),
    ...Object.entries(r.judge || {}).filter(([, v]) => v.verdict === "fail" || v.verdict === "error").map(([id, v]) => [id, v.reason])
  ].filter(([id]) => !only.length || only.some((o) => id.startsWith(o)));
  if (!fails.length) continue;
  const calls = (r.transcript?.calls || []).map((c) => c.name).join(", ") || "none";
  console.log(`\n=== ${r.id} #${r.run} (${r.category || ""}) · tools: ${calls}`);
  for (const [id, why] of fails) console.log(`  ✗ ${id}: ${String(why).slice(0, 300)}`);
  const answer = String(r.transcript?.answer || r.error || "").replace(/\s+/g, " ");
  console.log(`  answer: ${answer.slice(0, 250)}${answer.length > 250 ? "…" : ""}`);
}
