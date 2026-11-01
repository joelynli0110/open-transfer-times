# open-transfer-times

Deterministic, explainable assessment of a flight connection, backed by an open
and sourced airport transfer dataset.

Given a two-segment itinerary, it estimates the structural transfer time at the
connection airport — base transfer, Schengen passport control, terminal change,
security re-screening, baggage re-check — and returns a quality band
(`comfortable`, `reasonable`, `tight`, `risky`), the factors behind it, and the
disruption exposure of the ticket type.

It does **not** predict delays or output a probability of missing the flight.
No network calls, no runtime dependencies.

## Usage

```js
const { assessConnection, getAirportProfile } = require("open-transfer-times");

const result = assessConnection(
  {
    segments: [
      { origin: "BER", destination: "LHR", arrivalTime: "2026-09-20T10:00:00" },
      { origin: "LHR", destination: "PVG", departureTime: "2026-09-20T11:30:00" }
    ]
  },
  { ticketStatus: "protected" } // "protected" | "separate" | "unknown"
);

result.quality;                  // "reasonable"
result.structuralBufferMinutes;  // 35
result.processFactors;           // why: border control, security, margin, ...
result.verdict;                  // one-line recommendation
result.confidence;               // { level: "medium", reasons: [{ code, explanation }] }
result.decision;                 // { value: "recommend", reasons: [{ code, explanation }] }

getAirportProfile("LHR").facts;  // sourced statements behind the LHR rules
```

Times are local times at the connection airport (`YYYY-MM-DDTHH:mm`), optionally
with a UTC offset (`2026-03-29T01:30+01:00`). Exactly two segments are accepted;
itineraries with more connections throw an error, so assess each connection
separately.

### Layover length and clock changes

The layover is the real time between the flights, not the difference between
the clocks:

- **Profiled airports** have an IANA time zone, so a layover across a
  daylight-saving change is correct. At FRA on 29 March 2026, 01:30 → 03:30 is
  60 minutes. The result then carries a `CLOCK_CHANGE` factor and
  `wallClockLayoverMinutes`.
- A time in the hour that **repeats** when clocks go back gives the shorter
  possible layover and the confidence reason `DST_AMBIGUOUS`. A time in the hour
  that is **skipped** is rejected.
- **Explicit offsets** are always exact, also at airports without a profile.
- Otherwise (no profile, no offsets) the clocks are subtracted.
  `layoverBasis` says which applied: `timezone`, `offset` or `wall_clock`.

`layoverMinutes(arrival, departure, iata)` returns just the length.
`minutesBetween(arrival, departure)` is kept for compatibility and always
subtracts the clocks.

### Confidence

`quality` says how the connection looks; `confidence` says how far that can be
trusted. They are independent: a long layover at an airport without a profile
is still `comfortable`, but with `low` confidence.

| Level | When |
| --- | --- |
| `high` | Every counted step has a sourced duration. (No airport reaches this yet.) |
| `medium` | The airport has a profile, but durations are heuristic. |
| `medium` | …or a time fell in a repeated hour (`DST_AMBIGUOUS`). |
| `low` | No airport profile (`BASELINE_AIRPORT`), the airport's border situation is not modelled (`CONNECTION_ZONE_UNKNOWN`), the route could not be placed inside or outside Schengen (`ROUTE_ZONE_UNKNOWN`), or separate tickets with bags not stated where a re-check would make the connection tight or risky (`BAGGAGE_UNKNOWN`). |

### Decision

`decision.value` turns rating, confidence and ticket protection into one
answer. Missing data never yields `recommend`.

| Value | When |
| --- | --- |
| `avoid` | The rating is `risky`. |
| `insufficient_data` | Confidence is `low` (and the rating is not `risky`). |
| `caution` | The rating is `tight`, the tickets are separate, or ticket protection is unknown. |
| `recommend` | `comfortable` or `reasonable`, on a protected ticket, with medium or high confidence. |

`decision.reasons` explains which rule applied.

### Options

| Option | Meaning |
| --- | --- |
| `ticketStatus` | `protected` (one ticket), `separate` (self-transfer), or `unknown`. |
| `terminalChange` | `true` to force a terminal change when terminals are not in the itinerary. |
| `baggageRecheck` | `true` when bags must be collected and checked in again, `false` when not, omitted when unknown. On separate tickets with unknown bags, `ifBaggageRecheck` gives the margin and rating with a re-check. |

### Other exports

- `createNormalizedItinerary(input)` — validate and normalize raw segments.
- `layoverMinutes(arrival, departure, iata)` — real layover length (see above).
- `DECISIONS` — the decision values, best first.
- `getAirportProfile(iata)` / `listAirportProfiles()` — the dataset, including
  each allowance's `basis` (`heuristic` / `sourced`), facts and sources.
- `travelZone(iata)` — `schengen`, `non-schengen`, or `unknown`.
- `nameForAirport(iata)` — airport name from the OurAirports catalog.

## Browser use without a bundler

Load the UMD files in this order; they register `ConnectionQuality*` globals:
`itinerary.js`, `airport-catalog.js`, `data/airport-data.generated.js`,
`airport-rules.js`, `time.js`, `engine.js`.

## Data

The airport data is edited as YAML in the repository's
[`airports/`](../../airports) directory, not in this package. See
[CONTRIBUTING.md](../../CONTRIBUTING.md).
