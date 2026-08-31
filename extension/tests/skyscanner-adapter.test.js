const test = require("node:test");
const assert = require("node:assert/strict");
const adapter = require("../src/adapters/skyscanner/index.js");
const parser = require("../src/adapters/skyscanner/parser.js");

const DETAILS = `Flight details
Berlin Brandenburg (BER)
Monday, September 20, 2026
Flight LH 171 · 8:30 AM – 10:00 AM · BER–FRA
Departs from Terminal 1
Arrives at Terminal 2, Gate A12
1 hr 5 min stop in Frankfurt
Frankfurt Airport (FRA)
Flight LH 728 · 11:05 AM – 5:10 AM +1 · FRA–PVG
Departs from Terminal 1, Gate B20
Arrives at Terminal 2
Shanghai Pudong (PVG)
One booking
Bags checked through`;

function documentFor(groups, pageText = DETAILS, href = "https://www.skyscanner.com/transport/flights/ber/pvg/260920/") {
  return {
    location: { href },
    body: { innerText: pageText },
    querySelectorAll: (selector) => groups[selector] || []
  };
}

test("reads the outbound date from a Skyscanner route URL", () => {
  assert.equal(parser.dateFromUrl("https://www.skyscanner.net/transport/flights/ber/pvg/260920/"), "2026-09-20");
});

test("normalizes one selected Skyscanner connection with airport and terminal details", () => {
  const selector = '[aria-expanded="true"]';
  const result = adapter.extract(documentFor({ [selector]: [{ innerText: DETAILS }] }));
  assert.equal(result.ok, true);
  assert.equal(result.confidence, "high");
  assert.equal(result.itinerary.source, "skyscanner");
  assert.equal(result.itinerary.ticketStatusHint, "protected");
  assert.equal(result.itinerary.segments[0].destinationName, "Frankfurt Airport");
  assert.equal(result.itinerary.segments[0].arrivalTerminal, "2");
  assert.equal(result.itinerary.segments[0].arrivalGate, "A12");
  assert.equal(result.itinerary.segments[1].departureTerminal, "1");
  assert.equal(result.itinerary.segments[1].departureGate, "B20");
});

test("page-wide Skyscanner fallback requires confirmation", () => {
  const result = adapter.extract(documentFor({}));
  assert.equal(result.ok, true);
  assert.equal(result.confidence, "confirm");
});

test("fails closed when multiple result cards are equally plausible", () => {
  const other = DETAILS.replaceAll("FRA", "MUC").replace("Frankfurt Airport", "Munich Airport").replace("LH 171", "LH 200").replace("LH 728", "LH 201");
  const selector = 'article,[data-testid*="itinerary"],[data-testid*="flight-card"]';
  const result = adapter.extract(documentFor({ [selector]: [{ innerText: DETAILS }, { innerText: other }] }, `${DETAILS}\n${other}`));
  assert.equal(result.ok, false);
  assert.equal(result.code, "AMBIGUOUS_ITINERARY");
});
