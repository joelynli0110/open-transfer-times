const test = require("node:test");
const assert = require("node:assert/strict");
const adapter = require("../src/adapters/googleFlights/index.js");

const BOOKING_TFS = "CBwQAhpsEgoyMDI2LTA5LTAxIiAKA0JFUhIKMjAyNi0wOS0wMRoDU1RSKgJFVzIEMjAwMSIgCgNTVFISCjIwMjYtMDktMDEaA0xIUioCRVcyBDI0NjJqDAgCEggvbS8wMTU2cXIMCAMSCC9tLzA0anBsQAFIAXABggELCP___________wGYAQI";

function documentFor(selectedText, pageText = selectedText, href = "https://www.google.com/travel/flights/search") {
  return {
    location: { href },
    body: { innerText: pageText },
    querySelectorAll: () => selectedText ? [{ innerText: selectedText }] : []
  };
}

const NORMAL = `Monday, September 20, 2026
Flight LH 171 · 8:30 AM – 10:00 AM · BER–FRA
1 hr 5 min layover in Frankfurt
Flight LH 728 · 11:05 AM – 5:10 AM +1 · FRA–PVG`;

const IST_CANDIDATE = `Monday, September 20, 2026
Flight TK 100 · 8:45 AM – 11:45 AM · BER–IST
1 hr 30 min layover in Istanbul
Flight TK 200 · 1:15 PM – 5:40 AM +1 · IST–PVG`;

const BOOKING_CANDIDATE = `Tuesday, September 1, 2026
Flight EW 2001 · 8:00 AM – 9:15 AM · BER–STR
1 hr 20 min layover in Stuttgart
Flight EW 2462 · 10:35 AM – 12:20 PM · STR–LHR`;

function groupedDocument(groups, pageText, href = "https://www.google.com/travel/flights/search") {
  return {
    location: { href },
    body: { innerText: pageText },
    querySelectorAll: (selector) => groups[selector] || []
  };
}

test("adapter converts the selected itinerary to normalized segments", () => {
  const result = adapter.extract(documentFor(NORMAL));
  assert.equal(result.ok, true);
  assert.equal(result.confidence, "confirm");
  assert.equal(result.itinerary.ticketStatusHint, "unknown");
  assert.deepEqual(result.itinerary.segments.map(({ origin, destination }) => ({ origin, destination })), [
    { origin: "BER", destination: "FRA" }, { origin: "FRA", destination: "PVG" }
  ]);
});

test("unrelated page-wide separate-ticket text cannot contaminate the selected itinerary", () => {
  const selected = `${NORMAL}\nOne ticket\nBags are checked through to PVG`;
  const page = `${selected}\nAnother result: Separate tickets booked together`;
  const result = adapter.extract(documentFor(selected, page));
  assert.equal(result.ok, true);
  assert.equal(result.itinerary.ticketStatusHint, "protected");
  assert.notEqual(result.itinerary.ticketStatusHint, "separate");
});

test("adapter detects a separate-ticket warning inside the selected itinerary", () => {
  const selected = `${NORMAL}\nSeparate tickets booked together`;
  const result = adapter.extract(documentFor(selected));
  assert.equal(result.ok, true);
  assert.equal(result.itinerary.ticketStatusHint, "separate");
  assert.equal(result.itinerary.ticketStatusConfidence, "high");
  assert.equal(result.itinerary.baggageRecheckRequired, false);
});

test("adapter returns unknown when selected-itinerary ticket evidence is insufficient", () => {
  const result = adapter.extract(documentFor(NORMAL));
  assert.equal(result.ok, true);
  assert.equal(result.itinerary.ticketStatusHint, "unknown");
});

test("explicit baggage recheck evidence becomes a physical process hint", () => {
  const selected = `${NORMAL}\nCollect and recheck bags`;
  const result = adapter.extract(documentFor(selected));
  assert.equal(result.ok, true);
  assert.equal(result.itinerary.ticketStatusHint, "unknown");
  assert.equal(result.itinerary.baggageRecheckRequired, true);
});

test("through-checked baggage does not imply a protected ticket", () => {
  const selected = `${NORMAL}\nBags checked through`;
  const result = adapter.extract(documentFor(selected));
  assert.equal(result.ok, true);
  assert.equal(result.itinerary.ticketStatusHint, "unknown");
  assert.equal(result.itinerary.baggageRecheckRequired, false);
  assert.equal(result.itinerary.baggageEvidence.throughChecked, true);
});

test("protected ticket and baggage recheck remain independent", () => {
  const selected = `${NORMAL}\nOne ticket\nCollect and recheck bags`;
  const result = adapter.extract(documentFor(selected));
  assert.equal(result.ok, true);
  assert.equal(result.itinerary.ticketStatusHint, "protected");
  assert.equal(result.itinerary.baggageRecheckRequired, true);
});

test("page accessibility text is a route-only fallback that cannot supply ticket evidence", () => {
  const result = adapter.extract(documentFor("", `${NORMAL}\nSeparate tickets booked together`));
  assert.equal(result.ok, true);
  assert.equal(result.confidence, "confirm");
  assert.equal(result.itinerary.ticketStatusHint, "unknown");
});

test("adapter fails closed when page text has no complete itinerary", () => {
  const result = adapter.extract(documentFor("", "Google Flights results are still loading"));
  assert.equal(result.ok, false);
  assert.equal(result.code, "NO_RELIABLE_CANDIDATE");
});

test("multiple candidates with one exact booking match select the booking candidate", () => {
  const cardSelector = 'article,li[role="listitem"]';
  const documentStub = groupedDocument(
    { [cardSelector]: [{ innerText: NORMAL }, { innerText: BOOKING_CANDIDATE }] },
    `${NORMAL}\n${BOOKING_CANDIDATE}`,
    `https://www.google.com/travel/flights/booking?tfs=${BOOKING_TFS}`
  );
  const result = adapter.extract(documentStub);
  assert.equal(result.ok, true);
  assert.deepEqual(result.itinerary.segments.map(({ origin, destination }) => ({ origin, destination })), [
    { origin: "BER", destination: "STR" }, { origin: "STR", destination: "LHR" }
  ]);
});

test("multiple candidates with one active dialog select the active candidate", () => {
  const activeSelector = '[role="dialog"],[aria-modal="true"],[role="dialog"] div,[aria-modal="true"] div';
  const cardSelector = 'article,li[role="listitem"]';
  const documentStub = groupedDocument({
    [activeSelector]: [{ innerText: NORMAL }],
    [cardSelector]: [{ innerText: NORMAL }, { innerText: IST_CANDIDATE }]
  }, `${NORMAL}\n${IST_CANDIDATE}`);
  const result = adapter.extract(documentStub);
  assert.equal(result.ok, true);
  assert.equal(result.itinerary.segments[0].destination, "FRA");
});

test("multiple plausible candidates without unique selection evidence fail closed", () => {
  const cardSelector = 'article,li[role="listitem"]';
  const documentStub = groupedDocument({
    [cardSelector]: [{ innerText: NORMAL }, { innerText: IST_CANDIDATE }]
  }, `${NORMAL}\n${IST_CANDIDATE}`);
  const result = adapter.extract(documentStub);
  assert.equal(result.ok, false);
  assert.equal(result.code, "AMBIGUOUS_ITINERARY");
  assert.equal(result.candidatesFound, 2);
});

test("page-level fallback with multiple routes fails closed as ambiguous", () => {
  const result = adapter.extract(documentFor("", `${NORMAL}\n${IST_CANDIDATE}`));
  assert.equal(result.ok, false);
  assert.equal(result.code, "AMBIGUOUS_ITINERARY");
});
