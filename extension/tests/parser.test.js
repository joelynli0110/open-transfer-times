const test = require("node:test");
const assert = require("node:assert/strict");

const parser = require("../src/adapters/googleFlights/parser.js");

const BOOKING_TFS = "CBwQAhpsEgoyMDI2LTA5LTAxIiAKA0JFUhIKMjAyNi0wOS0wMRoDU1RSKgJFVzIEMjAwMSIgCgNTVFISCjIwMjYtMDktMDEaA0xIUioCRVcyBDI0NjJqDAgCEggvbS8wMTU2cXIMCAMSCC9tLzA0anBsQAFIAXABggELCP___________wGYAQI";

const SAME_DAY = `
  Monday, September 20, 2026
  Wizz Air · Flight W6 2316
  8:30 AM – 10:00 AM
  BER–BUD
  3 hr 20 min layover in Budapest (BUD)
  China Eastern · Flight MU 8640
  1:20 PM – 5:10 AM +1
  BUD–PVG
  Separate tickets booked together
`;

test("parses an expanded, one-stop Google Flights itinerary", () => {
  const result = parser.parseGoogleFlightsText(SAME_DAY, {
    now: new Date("2026-08-21T12:00:00")
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.itinerary, {
    travelDate: "2026-09-20",
    origin: "BER",
    connectionAirport: "BUD",
    destination: "PVG",
    inboundFlight: "W62316",
    outboundFlight: "MU8640",
    scheduledArrival: "2026-09-20T10:00:00",
    scheduledDeparture: "2026-09-20T13:20:00",
    selfTransferDetected: true
  });
});

test("handles an overnight layover using Google Flights day offsets", () => {
  const result = parser.parseGoogleFlightsText(`
    Friday, December 18, 2026
    Flight BA 281 · 10:30 PM – 11:55 PM · LHR–BUD
    1 hr 15 min layover in Budapest
    Flight W6 2301 · 1:10 AM +1 – 2:35 AM +1 · BUD–BER
  `);

  assert.equal(result.ok, true);
  assert.equal(result.itinerary.scheduledArrival, "2026-12-18T23:55:00");
  assert.equal(result.itinerary.scheduledDeparture, "2026-12-19T01:10:00");
});

test("parses airport-name accessibility text and a page-level date", () => {
  const details = `
    Wizz Air · Flight W6 2316
    8:30 AM – 10:00 AM
    Berlin Brandenburg Airport (BER)
    Budapest Ferenc Liszt International Airport (BUD)
    3 hr 20 min layover in Budapest
    China Eastern · Flight MU 8640
    1:20 PM – 5:10 AM +1
    Budapest Ferenc Liszt International Airport (BUD)
    Shanghai Pudong International Airport (PVG)
  `;
  const documentStub = {
    body: { innerText: `Monday, September 20, 2026\n${details}` },
    querySelectorAll: () => [{ innerText: details }]
  };

  const result = parser.parseGoogleFlightsDocument(documentStub);

  assert.equal(result.ok, true);
  assert.equal(result.itinerary.origin, "BER");
  assert.equal(result.itinerary.connectionAirport, "BUD");
  assert.equal(result.itinerary.destination, "PVG");
  assert.equal(result.itinerary.travelDate, "2026-09-20");
});

test("parses a localized booking page with 24-hour times and a tfs date", () => {
  const details = `
    Eurowings · Flug EW 2001
    08:00 – 09:15
    Flughafen Berlin Brandenburg (BER)
    Flughafen Stuttgart (STR)
    1 Std. 20 Min. Zwischenstopp in Stuttgart
    Eurowings · Flug EW 2462
    10:35 – 12:20
    Flughafen Stuttgart (STR)
    Flughafen London Heathrow (LHR)
  `;
  const documentStub = {
    location: { href: `https://www.google.com/travel/flights/booking?tfs=${BOOKING_TFS}` },
    body: { innerText: details },
    querySelectorAll: () => [{ innerText: details }]
  };

  const result = parser.parseGoogleFlightsDocument(documentStub);

  assert.equal(result.ok, true);
  assert.equal(result.itinerary.travelDate, "2026-09-01");
  assert.equal(result.itinerary.inboundFlight, "EW2001");
  assert.equal(result.itinerary.outboundFlight, "EW2462");
  assert.equal(result.itinerary.scheduledArrival, "2026-09-01T09:15:00");
  assert.equal(result.itinerary.scheduledDeparture, "2026-09-01T10:35:00");
  assert.equal(result.confidence, "high");
});

test("uses two URL segments as connection evidence when booking text has no layover label", () => {
  const details = `
    Eurowings EW 2001 · 08:00 – 09:15 · BER · STR
    Eurowings EW 2462 · 10:35 – 12:20 · STR · LHR
    Select fare
  `;
  const url = `https://www.google.com/travel/flights/booking?tfs=${BOOKING_TFS}`;
  const documentStub = {
    location: { href: url },
    body: { innerText: details },
    querySelectorAll: () => [{ innerText: details }]
  };

  assert.deepEqual(parser.extractBookingItinerary(url), {
    travelDate: "2026-09-01",
    segments: [
      { origin: "BER", travelDate: "2026-09-01", destination: "STR", flightNumber: "EW2001" },
      { origin: "STR", travelDate: "2026-09-01", destination: "LHR", flightNumber: "EW2462" }
    ]
  });

  const result = parser.parseGoogleFlightsDocument(documentStub);
  assert.equal(result.ok, true);
  assert.equal(result.itinerary.connectionAirport, "STR");
  assert.equal(result.itinerary.scheduledArrival, "2026-09-01T09:15:00");
  assert.equal(result.itinerary.scheduledDeparture, "2026-09-01T10:35:00");
});

test("parses Google Flights innerText when times touch airport names", () => {
  const visibleText = `
    Departing flight
    Tue 1 Sept
    08:55Berlin Brandenburg Airport (BER)
    Travel time: 1 hr 10 min
    10:05Stuttgart Airport (STR)
    Eurowings Airbus A319EW 2001
    3 hrs 5 min layoverStuttgart (STR)
    13:10Stuttgart Airport (STR)
    Travel time: 1 hr 40 min
    13:50Heathrow Airport (LHR)
    Eurowings Airbus A320neoEW 2462
  `;
  const documentStub = {
    location: { href: `https://www.google.com/travel/flights/booking?tfs=${BOOKING_TFS}` },
    body: { innerText: visibleText },
    querySelectorAll: () => [{ innerText: visibleText }]
  };

  const result = parser.parseGoogleFlightsDocument(documentStub);

  assert.equal(result.ok, true);
  assert.equal(result.itinerary.scheduledArrival, "2026-09-01T10:05:00");
  assert.equal(result.itinerary.scheduledDeparture, "2026-09-01T13:10:00");
  assert.equal(result.itinerary.connectionAirport, "STR");
});

test("finds details rendered inside a generic Google Flights main container", () => {
  const details = `
    Monday, September 20, 2026
    Flight LH 171 · 8:30 AM – 10:00 AM · BER–FRA
    1 hr 5 min layover in Frankfurt
    Flight LH 728 · 11:05 AM – 5:10 AM +1 · FRA–PVG
  `;
  const documentStub = {
    location: { href: "https://www.google.com/travel/flights/search" },
    body: { innerText: `Google Flights search results\n${details}` },
    querySelectorAll: (selector) => selector === "main div, main section" ? [{ innerText: details }] : []
  };

  const result = parser.parseGoogleFlightsDocument(documentStub);

  assert.equal(result.ok, true);
  assert.equal(result.itinerary.connectionAirport, "FRA");
  assert.equal(result.itinerary.scheduledDeparture, "2026-09-20T11:05:00");
  assert.equal(result.ticketEvidence.status, "unknown");
  assert.equal(result.confidence, "confirm");
});

test("maps parsed fields and traveler settings to the stable v1 API", () => {
  const parsed = parser.parseGoogleFlightsText(SAME_DAY);
  const payload = parser.toApiPayload(parsed.itinerary, {
    checkedBaggage: true,
    selfTransfer: false,
    terminalChange: true,
    schengenToNonSchengen: true
  });

  assert.deepEqual(payload, {
    connection_airport: "BUD",
    inbound: {
      flight_number: "W62316",
      origin: "BER",
      scheduled_arrival: "2026-09-20T10:00:00"
    },
    outbound: {
      flight_number: "MU8640",
      destination: "PVG",
      scheduled_departure: "2026-09-20T13:20:00"
    },
    checked_baggage: true,
    self_transfer: true,
    terminal_change: true,
    transfer_context: { schengen_to_non_schengen: true }
  });
});

test("does not invent missing flight details", () => {
  const result = parser.parseGoogleFlightsText(`
    September 20, 2026
    8:30 AM – 10:00 AM · BER–BUD
    3 hr 20 min layover in Budapest
    1:20 PM – 5:10 AM +1 · BUD–PVG
  `);

  assert.deepEqual(result, {
    ok: false,
    code: "MISSING_FLIGHTS",
    message: "Open both flight segments to show the flight numbers."
  });
});

test("rejects nonstop text as out of scope", () => {
  const result = parser.parseGoogleFlightsText("September 20, 2026 · W6 2316 · BER–BUD · Nonstop");
  assert.equal(result.ok, false);
  assert.equal(result.code, "NO_CONNECTION");
});

test("detects explicit ticket evidence and preserves uncertainty otherwise", () => {
  assert.equal(parser.detectTicketStatus("Separate tickets booked together").status, "separate");
  assert.equal(parser.detectTicketStatus("One ticket").status, "protected");
  assert.equal(parser.detectTicketStatus("Bags are checked through to PVG").status, "unknown");
  assert.deepEqual(parser.detectTicketStatus("Two connected flights", { bookingSegments: [{}, {}] }), {
    status: "unknown",
    confidence: "medium",
    basis: "Both segments appear together, but ticket protection is not stated."
  });
  assert.deepEqual(parser.detectTicketStatus("No ticket information"), {
    status: "unknown",
    confidence: "low",
    basis: "The visible itinerary does not state the ticket protection."
  });
});

test("keeps baggage process evidence independent from ticket status", () => {
  const recheckOnly = "Collect and recheck bags";
  assert.equal(parser.detectTicketStatus(recheckOnly).status, "unknown");
  assert.equal(parser.detectBaggageEvidence(recheckOnly).recheckRequired, true);

  const throughOnly = "Bags checked through";
  assert.equal(parser.detectTicketStatus(throughOnly).status, "unknown");
  assert.equal(parser.detectBaggageEvidence(throughOnly).recheckRequired, false);

  const separateRecheck = "Separate tickets. Collect and recheck bags";
  assert.equal(parser.detectTicketStatus(separateRecheck).status, "separate");
  assert.equal(parser.detectBaggageEvidence(separateRecheck).recheckRequired, true);

  const protectedRecheck = "One ticket. Collect and recheck bags";
  assert.equal(parser.detectTicketStatus(protectedRecheck).status, "protected");
  assert.equal(parser.detectBaggageEvidence(protectedRecheck).recheckRequired, true);
});
