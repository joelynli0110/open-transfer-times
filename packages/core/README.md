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

getAirportProfile("LHR").facts;  // sourced statements behind the LHR rules
```

Times are local wall-clock times at the connection airport (`YYYY-MM-DDTHH:mm`).

### Options

| Option | Meaning |
| --- | --- |
| `ticketStatus` | `protected` (one ticket), `separate` (self-transfer), or `unknown`. |
| `terminalChange` | `true` to force a terminal change when terminals are not in the itinerary. |
| `baggageRecheck` | `true` when bags must be collected and checked in again. |

### Other exports

- `createNormalizedItinerary(input)` — validate and normalize raw segments.
- `getAirportProfile(iata)` / `listAirportProfiles()` — the dataset, including
  each allowance's `basis` (`heuristic` / `sourced`), facts and sources.
- `travelZone(iata)` — `schengen`, `non-schengen`, or `unknown`.
- `nameForAirport(iata)` — airport name from the OurAirports catalog.

## Browser use without a bundler

Load the UMD files in this order; they register `ConnectionQuality*` globals:
`itinerary.js`, `airport-catalog.js`, `data/airport-data.generated.js`,
`airport-rules.js`, `engine.js`.

## Data

The airport data is edited as YAML in the repository's
[`airports/`](../../airports) directory, not in this package. See
[CONTRIBUTING.md](../../CONTRIBUTING.md).
