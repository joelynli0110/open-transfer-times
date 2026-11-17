"use strict";

// Grading against the gold set (eval/gold.json): what a good answer concludes,
// written from airport and airline sources, independent of the engine. Unlike
// the rubric in judge.js, it does not look at tool results, so runs with and
// without the MCP server are graded the same way.

const fs = require("node:fs");
const path = require("node:path");

const GOLD_PATH = path.join(__dirname, "..", "gold.json");

function loadGold(file = GOLD_PATH) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}

function buildGoldPrompt({ question, answer, expectation, outcomes }) {
  const labels = Object.entries(outcomes).map(([id, text]) => `- ${id}: ${text}`).join("\n");
  const must = expectation.must.length
    ? expectation.must.map((point, index) => `${index + 1}. ${point}`).join("\n")
    : "(none)";
  return [
    "You grade one answer from an AI travel assistant about a flight connection.",
    "",
    "<question>", question, "</question>",
    "",
    "<answer>", answer || "(empty)", "</answer>",
    "",
    "1. Pick the ONE label that best describes the answer's overall conclusion:",
    labels,
    "",
    "2. Check whether the answer covers each required point (in any language or wording):",
    must,
    "",
    "Judge only what the answer says; do not add your own view of the connection.",
    "Reply with only a JSON object, no prose:",
    '{"label": "<one label>", "points": {"verdict": "pass|fail|n/a", "reason": "..."}}',
    "Use n/a for points only if there are none. For a fail, name the missing point."
  ].join("\n");
}

function parseGoldReply(text, outcomes) {
  const match = String(text).match(/\{[\s\S]*\}/);
  if (!match) throw new Error("gold judge reply contained no JSON object");
  const parsed = JSON.parse(match[0]);
  const label = String(parsed.label || "").trim().toLowerCase();
  if (!Object.hasOwn(outcomes, label)) throw new Error(`gold judge gave an unknown label "${parsed.label}"`);
  const verdict = String(parsed.points?.verdict || "").toLowerCase();
  if (!["pass", "fail", "n/a"].includes(verdict)) throw new Error("gold judge gave no valid verdict for points");
  return { label, points: { verdict, reason: String(parsed.points.reason || "") } };
}

/**
 * Returns { label, items: { gold_outcome, gold_points }, unsafe } or null when the case has no gold entry.
 * unsafe: the answer calls the connection workable although the gold set does not allow that.
 */
async function judgeGold({ judge, gold, testCase, answer }) {
  const expectation = gold?.cases?.[testCase.id];
  if (!expectation) return null;
  const prompt = buildGoldPrompt({ question: testCase.prompt, answer, expectation, outcomes: gold.outcomes });
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { label, points } = parseGoldReply(await judge.complete(prompt), gold.outcomes);
      const allowed = expectation.outcome.includes(label);
      return {
        label,
        unsafe: label === "workable" && !expectation.outcome.includes("workable"),
        items: {
          gold_outcome: { verdict: allowed ? "pass" : "fail", reason: allowed ? "" : `concluded "${label}", expected ${expectation.outcome.join(" or ")}` },
          gold_points: expectation.must.length ? points : { verdict: "n/a", reason: "" }
        }
      };
    } catch (error) {
      lastError = error;
    }
  }
  const failed = { verdict: "error", reason: `gold judge failed: ${lastError.message}` };
  return { label: null, unsafe: false, items: { gold_outcome: failed, gold_points: failed } };
}

module.exports = { loadGold, judgeGold, buildGoldPrompt, parseGoldReply, GOLD_PATH };
