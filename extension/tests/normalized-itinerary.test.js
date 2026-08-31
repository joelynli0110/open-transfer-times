const test = require("node:test");
const assert = require("node:assert/strict");
const { createNormalizedItinerary } = require("../src/models/normalized-itinerary.js");

test("normalizes connected source-neutral segments", () => {
  const result = createNormalizedItinerary({ source: "google-flights", segments: [{ origin: "ber", destination: "fra", arrivalGate: "A12" }, { origin: "FRA", destination: "pvg" }] });
  assert.equal(result.ok, true);
  assert.equal(result.itinerary.source, "google-flights");
  assert.equal(result.itinerary.segments[0].arrivalGate, "A12");
  assert.deepEqual(result.itinerary.segments.map(({ origin, destination }) => ({ origin, destination })), [
    { origin: "BER", destination: "FRA" }, { origin: "FRA", destination: "PVG" }
  ]);
});

test("defaults source to unknown when omitted", () => {
  const result = createNormalizedItinerary({
    segments: [{ origin: "BER", destination: "FRA" }, { origin: "FRA", destination: "PVG" }]
  });

  assert.equal(result.ok, true);
  assert.equal(result.itinerary.source, "unknown");
});

test("rejects disconnected segments", () => {
  const result = createNormalizedItinerary({ segments: [{ origin: "BER", destination: "FRA" }, { origin: "MUC", destination: "PVG" }] });
  assert.equal(result.ok, false);
  assert.equal(result.code, "DISCONNECTED_SEGMENTS");
});

test("preserves only explicit baggage recheck requirements", () => {
  const segments = [{ origin: "BER", destination: "FRA" }, { origin: "FRA", destination: "PVG" }];
  assert.equal(createNormalizedItinerary({ segments }).itinerary.baggageRecheckRequired, false);
  const result = createNormalizedItinerary({
    segments,
    baggageRecheckRequired: true,
    baggageEvidence: { recheckRequired: true, throughChecked: false, confidence: "high", evidence: ["Collect and recheck bags"] }
  });
  assert.equal(result.itinerary.baggageRecheckRequired, true);
  assert.equal(result.itinerary.baggageEvidence.recheckRequired, true);
  assert.equal(result.itinerary.baggageEvidence.throughChecked, false);
});
