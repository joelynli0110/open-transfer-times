# Open Transfer Times

[![CI](https://github.com/joelynli0110/open-transfer-times/actions/workflows/ci.yml/badge.svg)](https://github.com/joelynli0110/open-transfer-times/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/open-transfer-times-mcp?label=open-transfer-times-mcp)](https://www.npmjs.com/package/open-transfer-times-mcp)
[![open-transfer-times MCP server](https://glama.ai/mcp/servers/joelynli0110/open-transfer-times/badges/score.svg)](https://glama.ai/mcp/servers/joelynli0110/open-transfer-times)

**Is this flight connection comfortable, tight, or risky?** Open, cited airport
transfer data, an engine that explains its verdict, and an MCP server so AI
agents can check connections before recommending a flight.

## Try it

Ask an AI agent to compare layovers. With the MCP server connected, it gets:

```text
1. IST 3 h BER–IST–PVG: RECOMMEND — rated comfortable, margin 135 min, protected itinerary, medium confidence
2. VIE 2 h BER–VIE–PVG: INSUFFICIENT DATA — rated comfortable, margin 65 min, protected itinerary, low confidence
   Why: Key information is missing, so the rating cannot be relied on. No transfer profile for this airport; generic baseline allowances were used.
3. FRA 50 min BER–FRA–PVG: AVOID — rated risky, margin -5 min, protected itinerary, medium confidence
   Why: The transfer steps take about as long as the layover or longer.
Only RECOMMEND and CAUTION options may be presented as workable; for the others, say why.
```

Vienna has plenty of time but no airport data, so it is not recommended. Each
result gives a decision, the transfer steps it counted, a confidence level, and
the official sources behind the airport data:

```text
BER–LHR–PVG: RECOMMEND — Enough time after the transfer steps, on a protected ticket, with usable data.
Rating: REASONABLE — A practical connection on one ticket.
Confidence: MEDIUM — The transfer-step durations are rule-of-thumb estimates, not sourced figures.
Layover 90 min, transfer steps 55 min, margin 35 min.
Steps counted: Move through airport 40 min (heuristic); Allow for another security check 15 min (heuristic). No other steps were counted.
```

### With Claude Desktop or any MCP client

Add to `claude_desktop_config.json`, then fully restart Claude:

```json
{
  "mcpServers": {
    "open-transfer-times": { "command": "npx", "args": ["-y", "open-transfer-times-mcp"] }
  }
}
```

Then ask, in a new chat: *"From Berlin to Shanghai, which is safest: 50 minutes
in Frankfurt, 3 hours in Istanbul or 2 hours in Vienna?"*

The server is also listed in the [official MCP Registry](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.joelynli0110/open-transfer-times)
and on [Glama](https://glama.ai/mcp/servers/joelynli0110/open-transfer-times).
Tools and options: [packages/mcp](packages/mcp).

### From code

```bash
npm install open-transfer-times
```

```js
const { assessConnection } = require("open-transfer-times");

const result = assessConnection(
  { segments: [
    { origin: "BER", destination: "LHR", arrivalTime: "2026-09-20T10:00" },
    { origin: "LHR", destination: "PVG", departureTime: "2026-09-20T11:30" }
  ] },
  { ticketStatus: "protected" }
);
result.quality;          // "reasonable"
result.confidence.level; // "medium"
```

API reference: [packages/core](packages/core).

## Why this exists

Airlines and booking systems decide whether a connection is feasible using
*minimum connection times* (MCT): commercial data sold by IATA and schedule
providers. Open flight-search tools can find itineraries but cannot say whether
a layover is realistic. This project collects what airports and airlines
publish openly, cites every fact, and marks every estimate as an estimate.

## How it works

The engine is deterministic: the model that calls it explains the result but
never does the arithmetic.

1. Start from the real layover: at profiled airports, in the airport's time
   zone, so a daylight-saving change is accounted for.
2. Deduct the transfer steps that apply at the connection airport: a base
   transfer allowance, Schengen passport control when the transfer crosses the
   Schengen border, a terminal change when known, security re-screening, and
   bag re-check when stated.
3. Rate the remaining margin: `comfortable` (≥ 45 min), `reasonable` (≥ 25),
   `tight` (≥ 5) or `risky`.

Alongside the rating:

- **Confidence** (`high` / `medium` / `low`). An airport without a profile, or
  a route whose border situation is unknown, is always low confidence, so
  missing data is never presented as "no risk".
- **Ticket protection.** Separate tickets change the warning and verdict, but
  do not add transfer time by themselves. When bags on separate tickets are not
  stated, the result shows what a re-check would do.
- **Decision** (`recommend` / `caution` / `insufficient_data` / `avoid`)
  combines the three. Missing data never yields `recommend`, and comparisons
  rank by decision first.

## Airport data

13 hub airports have their own profile in [`airports/`](airports), one YAML
file each; every other airport uses a [standard baseline](airports/_baseline.yaml).
All 13 cite official airport or airline pages. Facts confirm transfer steps,
for example that Heathrow, Hong Kong, Changi, Incheon, Narita and Doha screen
transfer passengers again, while most durations are still estimates
(`basis: heuristic`). [COVERAGE.md](airports/COVERAGE.md) shows how well each
airport is sourced.

**Contributions welcome, no code needed.** Add an airport, replace an estimate
with a sourced figure, or report a rule the format can't express: see
[CONTRIBUTING.md](CONTRIBUTING.md) or open an issue with the *Airport data* form.

## Limitations

- **Not an official MCT table, and no delay prediction.** It is a structural
  estimate with its sources attached.
- **Durations are mostly rule-of-thumb.** No minute value is sourced yet, so no
  result reaches `high` confidence.
- **One stop at a time.** Itineraries with more connections are rejected; check
  each connection separately.
- **Schengen status is known for about 56 airports.** A connection at any
  other airport, or at a Schengen airport to or from one, is reported as low
  confidence.
- **One rule set per airport.** Rules that depend on where you arrive from
  (security at AMS), on terminal pairs (NRT) or on "some cases" (MUC) are not
  modelled yet.
- **Self-transfers.** Re-checking bags adds a fixed allowance, but entering and
  leaving the country is not counted outside Schengen.
- **Clock changes at other airports.** Only the 13 profiled airports have time
  zones. Elsewhere a layover across a daylight-saving change is off by an hour
  unless the times carry UTC offsets.
- Visa and transit-visa requirements are not covered.

## Roadmap

[RFC 0001](docs/rfcs/0001-context-dependent-rules.md) proposes the next steps: a
country for every airport, rules with conditions, self-transfer border steps,
time zones beyond the profiled airports, and sourced durations for MUC, NRT and
LHR. It addresses most of the limitations above. Feedback is welcome on its
discussion issue.

The [agent evaluation](eval) measures how reliably an AI agent uses the server:
38 questions in Chinese and English, graded on tool calls and answer accuracy,
for any model behind Anthropic, OpenAI, OpenRouter or a local Ollama.

## Repository layout

| Path | What it is |
| --- | --- |
| [`airports/`](airports), [`regions/`](regions) | The transfer dataset (YAML) and Schengen membership. |
| [`packages/core`](packages/core) | `open-transfer-times` on npm: the dependency-free engine. |
| [`packages/mcp`](packages/mcp) | `open-transfer-times-mcp` on npm: the MCP server. |
| [`eval/`](eval) | Agent evaluation against the Claude API. |
| [`extension/`](extension) | Chrome extension for Google Flights (beta, not in the Chrome Web Store). |
| [`docs/`](docs) | RFCs, data sources, extension store materials. |
| [`src/`](src), `pyproject.toml` | **Legacy** Python research code (delay simulation, EUROCONTROL benchmarks). Not published, not maintained, not used by the packages above. |

## Development

Requires Node.js 20+.

```bash
npm install
npm run check   # airport data validation, lint, all tests, extension build
npm run smoke   # pack both npm packages, install them, call the MCP server
npm run eval    # agent evaluation: Anthropic, OpenAI, OpenRouter or local Ollama (eval/README.md)
```

`npm run airports:build` regenerates the engine's data after editing
`airports/*.yaml`. CI runs `check` and `smoke` on Ubuntu and Windows with
Node 20 and 22. Working on the extension: [extension/README.md](extension/README.md).
Changes by release: [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE). Airport names come from the public-domain
[OurAirports](https://ourairports.com/data/) dataset.
