const test = require("node:test");
const assert = require("node:assert/strict");
const { assessConnection, minutesBetween, layoverMinutes } = require("../src/engine.js");
const { listAirportProfiles } = require("../src/airport-rules.js");

function itinerary(origin, connection, destination, arrival, departure, extra = {}) {
  return {
    source: "google-flights",
    ...extra,
    segments: [
      { origin, destination: connection, arrivalTime: arrival },
      { origin: connection, destination, departureTime: departure }
    ]
  };
}

test("long protected layover is comfortable", () => {
  const result = assessConnection(itinerary("BER", "FRA", "PVG", "2026-09-20T10:00:00", "2026-09-20T13:00:00"), { ticketStatus: "protected" });
  assert.equal(result.quality, "comfortable");
  assert.equal(result.layoverMinutes, 180);
  assert.equal(result.structuralBufferMinutes, 125);
  assert.equal(result.ticketStatus, "protected");
  assert.equal(result.protectionAssessment.level, "protected");
});

test("short border-crossing layover is tight", () => {
  const result = assessConnection(itinerary("BER", "FRA", "PVG", "2026-09-20T10:00:00", "2026-09-20T11:05:00"), { ticketStatus: "protected" });
  assert.equal(result.quality, "tight");
  assert.equal(result.structuralBufferMinutes, 10);
  assert.ok(result.processFactors.some((item) => item.code === "SCHENGEN_BORDER_CONTROL"));
  assert.ok(result.processFactors.some((item) => item.code === "STRUCTURAL_MARGIN"));
});

test("ticket protection changes exposure and verdict but not structural feasibility", () => {
  const trip = itinerary("BER", "AMS", "PVG", "2026-09-20T10:00:00", "2026-09-20T11:30:00");
  const protectedResult = assessConnection(trip, { ticketStatus: "protected" });
  const separateResult = assessConnection(trip, { ticketStatus: "separate" });
  assert.equal(protectedResult.structuralBufferMinutes, separateResult.structuralBufferMinutes);
  assert.equal(protectedResult.quality, separateResult.quality);
  assert.equal(protectedResult.protectionAssessment.level, "protected");
  assert.equal(separateResult.protectionAssessment.level, "exposed");
  assert.notEqual(protectedResult.verdict, separateResult.verdict);
});

test("explicit baggage recheck process reduces structural buffer", () => {
  const physicalTrip = itinerary("BER", "AMS", "PVG", "2026-09-20T10:00:00", "2026-09-20T11:30:00");
  const noRecheck = assessConnection(physicalTrip, { ticketStatus: "separate" });
  const withRecheck = assessConnection({ ...physicalTrip, baggageRecheckRequired: true }, { ticketStatus: "separate" });
  assert.equal(noRecheck.structuralBufferMinutes - withRecheck.structuralBufferMinutes, 45);
  assert.ok(withRecheck.processFactors.some((item) => item.code === "BAGGAGE_RECHECK"));
});

test("passport control reduces structural buffer", () => {
  const crossBorder = assessConnection(itinerary("BER", "FRA", "PVG", "2026-09-20T10:00:00", "2026-09-20T12:00:00"), { ticketStatus: "protected" });
  const nonSchengen = assessConnection(itinerary("PVG", "FRA", "JFK", "2026-09-20T10:00:00", "2026-09-20T12:00:00"), { ticketStatus: "protected" });
  assert.equal(nonSchengen.structuralBufferMinutes - crossBorder.structuralBufferMinutes, 20);
});

test("Schengen border control depends on the connection airport and transfer flow", () => {
  const cases = [
    { route: ["BER", "FRA", "PVG"], expected: true },
    { route: ["PVG", "FRA", "BER"], expected: true },
    { route: ["BER", "FRA", "MUC"], expected: false },
    { route: ["JFK", "FRA", "DXB"], expected: false },
    { route: ["BER", "IST", "PVG"], expected: false },
    { route: ["PVG", "IST", "BER"], expected: false },
    { route: ["BER", "LHR", "JFK"], expected: false }
  ];
  for (const { route, expected } of cases) {
    const result = assessConnection(itinerary(route[0], route[1], route[2], "2026-09-20T10:00:00", "2026-09-20T13:00:00"), { ticketStatus: "protected" });
    const present = result.processFactors.some((item) => item.code === "SCHENGEN_BORDER_CONTROL");
    assert.equal(present, expected, route.join(" → "));
  }
});

test("minutesBetween stays plain wall-clock arithmetic (kept for compatibility)", () => {
  assert.equal(minutesBetween("2026-10-25T01:30:00", "2026-10-25T03:30:00"), 120);
  assert.equal(minutesBetween("2026-10-25T23:30:00", "2026-10-26T01:00:00"), 90);
  assert.equal(minutesBetween("2026-09-20T10:00:00", "2026-09-20T11:05:00"), 65);
});

test("layover duration is identical under different process timezones", () => {
  const originalTimezone = process.env.TZ;
  try {
    const values = ["Europe/Berlin", "America/New_York"].map((timezone) => {
      process.env.TZ = timezone;
      return minutesBetween("2026-10-25T01:30:00", "2026-10-25T03:30:00");
    });
    assert.deepEqual(values, [120, 120]);
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});

test("unsupported airport uses the standard structural baseline", () => {
  const result = assessConnection(itinerary("BER", "XXX", "PVG", "2026-09-20T10:00:00", "2026-09-20T12:00:00"), { ticketStatus: "protected" });
  assert.equal(result.airportSpecificData, false);
  assert.ok(result.processFactors.some((item) => item.code === "AIRPORT_TRANSFER"));
  assert.ok(["comfortable", "reasonable", "tight", "risky"].includes(result.quality));
});

test("airport catalog supplies names without pretending to have airport-specific transfer rules", () => {
  const result = assessConnection(itinerary("BER", "BUD", "PVG", "2026-09-20T10:00:00", "2026-09-20T12:00:00"), { ticketStatus: "protected" });
  assert.equal(result.airportName, "Budapest Liszt Ferenc International Airport");
  assert.equal(result.airportSpecificData, false);
});

test("rejects itineraries with more than one connection instead of ignoring later segments", () => {
  const threeSegments = {
    segments: [
      { origin: "BER", destination: "IST", arrivalTime: "2026-09-20T10:00:00" },
      { origin: "IST", destination: "DOH", departureTime: "2026-09-20T13:00:00", arrivalTime: "2026-09-20T17:00:00" },
      { origin: "DOH", destination: "PVG", departureTime: "2026-09-20T17:20:00" }
    ]
  };
  assert.throws(() => assessConnection(threeSegments), /Only one-stop itineraries \(two segments\) are supported; got 3 segments/);
});

test("confidence is separate from quality: missing data is low confidence, never silent", () => {
  const cases = [
    // [origin, connection, destination, expected level, expected reason codes]
    ["BER", "IST", "PVG", "medium", ["HEURISTIC_ALLOWANCES"]],
    ["BER", "VIE", "JFK", "low", ["BASELINE_AIRPORT"]],
    ["ZZZ", "XXX", "YYY", "low", ["BASELINE_AIRPORT", "CONNECTION_ZONE_UNKNOWN"]],
    ["ZZZ", "FRA", "YYY", "low", ["ROUTE_ZONE_UNKNOWN"]]
  ];
  for (const [origin, connection, destination, level, codes] of cases) {
    const result = assessConnection(itinerary(origin, connection, destination, "2026-09-20T10:00:00", "2026-09-20T13:00:00"), { ticketStatus: "protected" });
    assert.equal(result.quality, "comfortable", `${connection}: a long layover still rates comfortable`);
    assert.equal(result.confidence.level, level, connection);
    assert.deepEqual(result.confidence.reasons.map((reason) => reason.code), codes, connection);
    for (const reason of result.confidence.reasons) assert.ok(reason.explanation.length > 20);
  }
});

// --- time zones and daylight saving (0.2.0) ---------------------------------

test("spring forward: FRA 01:30 → 03:30 on 29 Mar 2026 is 60 real minutes, not 120", () => {
  const result = assessConnection(itinerary("BER", "FRA", "PVG", "2026-03-29T01:30", "2026-03-29T03:30"), { ticketStatus: "protected" });
  assert.equal(result.layoverMinutes, 60);
  assert.equal(result.wallClockLayoverMinutes, 120);
  assert.equal(result.layoverBasis, "timezone");
  assert.equal(result.timeZone, "Europe/Berlin");
  assert.equal(result.quality, "tight", "55 min of steps in 60 real minutes");
  const clock = result.processFactors.find((item) => item.code === "CLOCK_CHANGE");
  assert.equal(clock.severity, "high");
  assert.match(clock.explanation, /show 120 min .* 60 min actually pass/);
});

test("fall back: FRA 01:30 → 03:30 on 25 Oct 2026 is 180 real minutes", () => {
  const result = assessConnection(itinerary("BER", "FRA", "PVG", "2026-10-25T01:30", "2026-10-25T03:30"), { ticketStatus: "protected" });
  assert.equal(result.layoverMinutes, 180);
  assert.equal(result.processFactors.find((item) => item.code === "CLOCK_CHANGE").severity, "low");
});

test("a time in the repeated hour uses the shorter layover and lowers confidence to medium", () => {
  const result = assessConnection(itinerary("BER", "MUC", "JFK", "2026-10-25T02:30", "2026-10-25T03:40"), { ticketStatus: "protected" });
  assert.equal(result.layoverMinutes, 70, "02:30 read as the second (CET) occurrence");
  assert.ok(result.confidence.reasons.some((reason) => reason.code === "DST_AMBIGUOUS"));
  assert.equal(result.confidence.level, "medium");
});

test("a time in the skipped hour is rejected with a clear message", () => {
  assert.throws(
    () => assessConnection(itinerary("BER", "FRA", "PVG", "2026-03-29T02:30", "2026-03-29T04:00")),
    /2026-03-29T02:30 does not exist in Europe\/Berlin/
  );
});

test("explicit UTC offsets give exact layovers even without an airport profile", () => {
  const result = assessConnection(itinerary("BER", "VIE", "JFK", "2026-03-29T01:30+01:00", "2026-03-29T03:30+02:00"));
  assert.equal(result.layoverMinutes, 60);
  assert.equal(result.layoverBasis, "offset");
  assert.equal(layoverMinutes("2026-03-29T01:30", "2026-03-29T03:30", "VIE"), 120, "no profile, no offsets: clock arithmetic");
});

test("away from clock changes, every profiled airport gives the plain clock difference", () => {
  for (const profile of listAirportProfiles()) {
    assert.ok(profile.timezone, `${profile.iata} has a time zone`);
    assert.equal(layoverMinutes("2026-09-20T23:10", "2026-09-21T01:05", profile.iata), 115, profile.iata);
  }
});

test("real layover length does not depend on the machine's time zone", () => {
  const originalTimezone = process.env.TZ;
  try {
    const values = ["Europe/Berlin", "America/New_York", "Asia/Tokyo"].map((timezone) => {
      process.env.TZ = timezone;
      return layoverMinutes("2026-03-29T01:30", "2026-03-29T03:30", "FRA");
    });
    assert.deepEqual(values, [60, 60, 60]);
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});

// --- baggage on separate tickets (0.2.0) ------------------------------------

test("separate tickets with unknown bags: flagged only when a re-check would make it tight or risky", () => {
  const at = (minutes, options) => assessConnection(
    itinerary("BER", "IST", "PVG", "2026-09-20T10:00", `2026-09-20T${String(10 + Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`),
    options
  );
  const tightIfRechecked = at(100, { ticketStatus: "separate" });
  assert.equal(tightIfRechecked.baggageRecheck, "unknown");
  assert.deepEqual(tightIfRechecked.ifBaggageRecheck, { bufferMinutes: 10, quality: "tight" });
  assert.equal(tightIfRechecked.confidence.level, "low");
  assert.match(tightIfRechecked.confidence.reasons.find((reason) => reason.code === "BAGGAGE_UNKNOWN").explanation, /margin would be 10 min \(tight\)/);
  assert.equal(tightIfRechecked.decision.value, "insufficient_data");

  const fineEitherWay = at(150, { ticketStatus: "separate" });
  assert.equal(fineEitherWay.confidence.level, "medium");
  assert.equal(fineEitherWay.decision.value, "caution");

  const statedNoBags = at(100, { ticketStatus: "separate", baggageRecheck: false });
  assert.equal(statedNoBags.baggageRecheck, "not_required");
  assert.equal(statedNoBags.ifBaggageRecheck, undefined);
  assert.equal(statedNoBags.confidence.level, "medium");

  const protectedTicket = at(100, { ticketStatus: "protected" });
  assert.equal(protectedTicket.ifBaggageRecheck, undefined, "bags are through-checked on one ticket");
});

// --- decision (0.2.0) ---------------------------------------------------------

test("decision combines rating, confidence and ticket protection", () => {
  const cases = [
    // [via, layover end, ticket, expected decision, expected reason codes]
    ["IST", "13:00", "protected", "recommend", ["CLEAR"]],
    ["IST", "13:00", "unknown", "caution", ["TICKET_UNKNOWN"]],
    ["IST", "13:00", "separate", "caution", ["SELF_TRANSFER"]],
    ["IST", "11:00", "protected", "caution", ["TIGHT_MARGIN"]],
    ["IST", "10:40", "protected", "avoid", ["RISKY_MARGIN"]],
    ["VIE", "13:00", "protected", "insufficient_data", ["LOW_CONFIDENCE"]],
    ["XXX", "10:20", "protected", "avoid", ["RISKY_MARGIN", "LOW_CONFIDENCE"]]
  ];
  for (const [via, end, ticket, value, codes] of cases) {
    const result = assessConnection(itinerary("BER", via, "PVG", "2026-09-20T10:00", `2026-09-20T${end}`), { ticketStatus: ticket });
    assert.equal(result.decision.value, value, `${via} ${end} ${ticket}`);
    assert.deepEqual(result.decision.reasons.map((reason) => reason.code), codes, `${via} ${end} ${ticket}`);
  }
});

test("missing data never yields recommend", () => {
  for (const via of ["VIE", "XXX", "BKK"]) {
    const result = assessConnection(itinerary("BER", via, "PVG", "2026-09-20T08:00", "2026-09-20T14:00"), { ticketStatus: "protected" });
    assert.equal(result.quality, "comfortable");
    assert.equal(result.decision.value, "insufficient_data", via);
  }
});
