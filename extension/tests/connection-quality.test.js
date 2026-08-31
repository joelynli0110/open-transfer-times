const test = require("node:test");
const assert = require("node:assert/strict");
const { assessConnection, minutesBetween } = require("../src/engine/connection-quality.js");

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

test("wall-clock layover arithmetic handles DST dates, overnight, and normal intervals", () => {
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
