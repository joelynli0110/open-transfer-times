"use strict";

// Deterministic checks on the tool calls an agent made. No model involved.

// Arguments the MCP server defaults when omitted.
const ARG_DEFAULTS = { ticket: "unknown" };

/** Every itinerary-like argument object a call carries: a check_connection's
 * args, each compare_connections option, or the raw args of other tools. */
function legsOf(call) {
  if (call.name === "compare_connections" && Array.isArray(call.args?.options)) return call.args.options;
  return [call.args || {}];
}

function sameValue(expected, actual) {
  if (expected === "*present*") return actual !== undefined && actual !== null && actual !== "";
  if (expected === "*absent*") return actual === undefined || actual === null;
  if (typeof expected === "string" && typeof actual === "string") return expected.toUpperCase() === actual.trim().toUpperCase();
  return expected === actual;
}

function legMatches(expectedLeg, leg) {
  return Object.entries(expectedLeg).every(([key, expected]) => {
    const actual = leg[key] !== undefined ? leg[key] : ARG_DEFAULTS[key];
    return sameValue(expected, actual);
  });
}

/**
 * @returns {{ id: string, passed: boolean, detail: string }[]}
 */
function deterministicChecks(testCase, transcript) {
  const expect = testCase.expect || {};
  const calls = transcript.calls;
  const results = [];
  const add = (id, passed, detail) => results.push({ id, passed, detail });

  if (expect.no_tool) {
    add("no_tool_call", calls.length === 0,
      calls.length === 0 ? "no tool called" : `called ${calls.map((call) => call.name).join(", ")} without enough information`);
    return results;
  }

  add("tool_called", calls.length > 0, calls.length ? `${calls.length} call(s)` : "the agent answered without using a tool");

  for (const [index, expected] of (expect.calls || []).entries()) {
    const candidates = calls.filter((call) => !expected.tool || call.name === expected.tool);
    const hit = candidates.some((call) => legsOf(call).some((leg) => legMatches(expected.leg, leg)));
    const want = `${expected.tool || "any tool"} with ${JSON.stringify(expected.leg)}`;
    add(`expected_call_${index + 1}`, hit, hit ? want : `missing: ${want}; got ${JSON.stringify(calls.map((call) => ({ name: call.name, args: call.args })))}`);
  }

  if (expect.compare) {
    const compares = calls.filter((call) => call.name === "compare_connections");
    const counts = compares.map((call) => (call.args?.options || []).length);
    const ok = counts.includes(expect.compare.options);
    add("compare_used", ok, ok
      ? `compare_connections with ${expect.compare.options} options`
      : compares.length ? `compare_connections option counts ${counts.join(", ")}, expected ${expect.compare.options}` : "compare_connections not used");
  }

  for (const field of expect.forbid_leg_fields || []) {
    const offending = calls.flatMap(legsOf).filter((leg) => leg[field] !== undefined);
    add(`no_${field}`, offending.length === 0,
      offending.length ? `invented ${field}: ${offending.map((leg) => leg[field]).join(", ")}` : `${field} not invented`);
  }

  const failedCalls = calls.filter((call) => call.isError);
  add("tool_calls_succeeded", failedCalls.length === 0,
    failedCalls.length ? failedCalls.map((call) => `${call.name}: ${call.text}`).join(" | ") : "all calls succeeded");

  add("answered", transcript.answer.length > 0, transcript.answer ? "final answer present" : `no final answer (${transcript.stopReason})`);
  return results;
}

module.exports = { deterministicChecks, legsOf, legMatches };
