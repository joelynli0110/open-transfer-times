const test = require("node:test");
const assert = require("node:assert/strict");
const { actionForExtraction, failurePresentation } = require("../src/ui/assessment-flow.js");

function result(confidence, ticketStatusHint = "protected") {
  return {
    ok: true,
    confidence,
    itinerary: {
      ticketStatusHint,
      segments: [
        { origin: "BER", destination: "FRA", arrivalTime: "2026-09-20T10:00:00" },
        { origin: "FRA", destination: "PVG", departureTime: "2026-09-20T11:05:00" }
      ]
    }
  };
}

test("high-confidence extraction with known ticket status may assess automatically", () => {
  assert.equal(actionForExtraction(result("high")), "assess");
});

test("confirm confidence requires confirmation before assessment", () => {
  assert.equal(actionForExtraction(result("confirm")), "confirm");
});

test("unknown ticket status requires a protected, separate, or not-sure choice", () => {
  assert.equal(actionForExtraction(result("high", "unknown")), "confirm");
});

test("invalid or incomplete extraction fails closed", () => {
  assert.equal(actionForExtraction({ ok: false }), "invalid");
  assert.equal(actionForExtraction({ ok: true, confidence: "high", itinerary: { segments: [] } }), "invalid");
});

test("ambiguous extraction produces retry guidance and no assessment action", () => {
  const result = { ok: false, code: "AMBIGUOUS_ITINERARY", candidatesFound: 2 };
  assert.equal(actionForExtraction(result), "invalid");
  assert.deepEqual(failurePresentation(result), {
    title: "We couldn't identify the selected itinerary.",
    detail: "Open or expand one itinerary and try again."
  });
});
