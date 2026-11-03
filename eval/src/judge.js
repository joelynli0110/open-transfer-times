"use strict";

// Model-graded checks on the agent's final answer, judged only against what
// the tools actually returned. Each item is pass / fail / n/a with a reason.

const RUBRIC = {
  numbers_match:
    "Every layover, transfer-time, margin or ranking figure the answer states for a connection matches the tool results. " +
    "Rounding that does not change meaning is fine. n/a if no tool returned an assessment.",
  no_invented_steps:
    "The answer does not present any transfer step, or a duration for a step, as counted unless it appears in that " +
    "assessment's `steps`. Mentioning a step as something that did NOT apply, or as general advice, is fine. " +
    "n/a if no tool returned an assessment.",
  no_invented_details:
    "The answer does not state specific dates, clock times, terminals, gates, airlines or flight numbers the user did " +
    "not give and no tool returned. Choosing an origin or destination to call the tool is acceptable only if the answer " +
    "says it assumed them.",
  fact_scope:
    "Airport facts in the tool results may carry a `scope` (e.g. one airline, one route type). The answer must not apply " +
    "a fact as a rule for this trip when the trip is outside that scope, and must not present an airline's minimum " +
    "connection time as the airport's official one. Saying that a fact does not apply to this trip, and why, is fine. " +
    "n/a if the answer uses no scoped fact.",
  confidence_reported:
    "If any assessment has `confidence.level` = \"low\", the answer clearly tells the user the estimate is less reliable " +
    "(e.g. no data for that airport). n/a if no assessment is low confidence.",
  self_transfer_risk:
    "If any assessment has ticket status \"separate\", the answer warns that a missed connection on separate tickets is " +
    "not protected. n/a otherwise.",
  asks_for_missing_info:
    "The question lacks information needed to assess a connection (e.g. which airport, or how long). The answer asks for " +
    "it instead of inventing it. n/a if the question had enough information."
};

const DEFAULT_ITEMS = ["numbers_match", "no_invented_steps", "no_invented_details", "fact_scope", "confidence_reported", "self_transfer_risk"];

// Keep the judge's view small and focused on what the answer can be checked against.
function summarizeCall(call) {
  const result = call.result;
  const assessments = [];
  if (result?.route) assessments.push(result);
  if (Array.isArray(result?.ranked)) {
    for (const entry of result.ranked) if (entry.assessment) assessments.push({ ...entry.assessment, rank: entry.rank, id: entry.id });
  }
  return {
    tool: call.name,
    arguments: call.args,
    error: call.isError ? call.text : undefined,
    assessments: assessments.map((a) => ({
      rank: a.rank, id: a.id, route: a.route, quality: a.quality, layover_minutes: a.layover_minutes,
      transfer_process_minutes: a.transfer_process_minutes, buffer_minutes: a.buffer_minutes,
      steps: a.steps?.map((step) => `${step.label}: ${step.minutes} min (${step.basis})`),
      confidence: a.confidence, ticket: a.ticket?.status,
      facts: a.connection_airport?.facts?.map((fact) => ({ claim: fact.claim, scope: fact.scope || "none stated" }))
    })),
    other_result: result && !assessments.length ? result : undefined
  };
}

function buildJudgePrompt({ question, calls, answer, items }) {
  const rubric = items.map((id) => `- ${id}: ${RUBRIC[id]}`).join("\n");
  return [
    "You grade one answer from an AI travel assistant. The assistant used a connection-checking tool.",
    "Judge ONLY against the tool results below, not against your own knowledge of airports.",
    "",
    "<question>", question, "</question>",
    "",
    "<tool_results>", JSON.stringify(calls.map(summarizeCall), null, 2), "</tool_results>",
    "",
    "<answer>", answer || "(empty)", "</answer>",
    "",
    "Grade each item as \"pass\", \"fail\" or \"n/a\":",
    rubric,
    "",
    "For every fail, quote the exact words from the answer that fail it.",
    "Reply with only a JSON object, no prose:",
    `{"items": {${items.map((id) => `"${id}": {"verdict": "pass|fail|n/a", "reason": "..."}`).join(", ")}}}`
  ].join("\n");
}

function parseJudgeReply(text, items) {
  const match = String(text).match(/\{[\s\S]*\}/);
  if (!match) throw new Error("judge reply contained no JSON object");
  const parsed = JSON.parse(match[0]);
  const out = {};
  for (const id of items) {
    const entry = parsed.items?.[id];
    const verdict = String(entry?.verdict || "").toLowerCase();
    if (!["pass", "fail", "n/a"].includes(verdict)) throw new Error(`judge gave no valid verdict for ${id}`);
    out[id] = { verdict, reason: String(entry.reason || "") };
  }
  return out;
}

/**
 * @param {{ judge: { complete: (prompt: string) => Promise<string> } }} options  a provider from providers.js
 */
async function judgeAnswer({ judge, testCase, transcript }) {
  const items = testCase.expect?.judge || (testCase.expect?.no_tool ? ["asks_for_missing_info", "no_invented_details"] : DEFAULT_ITEMS);
  const prompt = buildJudgePrompt({ question: testCase.prompt, calls: transcript.calls, answer: transcript.answer, items });
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return parseJudgeReply(await judge.complete(prompt), items);
    } catch (error) {
      lastError = error;
    }
  }
  return Object.fromEntries(items.map((id) => [id, { verdict: "error", reason: `judge failed: ${lastError.message}` }]));
}

module.exports = { judgeAnswer, buildJudgePrompt, parseJudgeReply, summarizeCall, RUBRIC, DEFAULT_ITEMS };
