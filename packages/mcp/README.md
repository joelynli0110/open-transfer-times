# open-transfer-times-mcp

An [MCP](https://modelcontextprotocol.io) server that lets AI agents check
whether a flight connection is realistic before recommending or booking it.

Flight-search tools return itineraries; they do not say whether a 50-minute
layover in Frankfurt is enough. This server answers that with a deterministic,
explainable assessment from the [open-transfer-times](../core) engine, and it
returns the cited airport facts behind every estimate so the agent can show its
sources.

Runs locally over stdio. No API keys, no network calls.

## Tools

All tools are read-only.

| Tool | What it does |
| --- | --- |
| `check_connection` | Assess one connection: `comfortable` / `reasonable` / `tight` / `risky`, the layover, each transfer step that was counted with its minutes, remaining margin, reasons, ticket-protection exposure, and the connection airport's cited facts. |
| `compare_connections` | Assess 2–20 itineraries (e.g. flight-search results) and rank them from safest to riskiest. Pass your own `id` per option to map results back. |
| `get_airport_profile` | An airport's transfer allowances, whether each is `heuristic` or `sourced`, and its cited facts with official links. |
| `list_airports` | Airports with their own profile and how well each is sourced. |

### `check_connection` input

| Field | Required | Example | Notes |
| --- | --- | --- | --- |
| `from`, `via`, `to` | yes | `BER`, `LHR`, `PVG` | IATA codes; case-insensitive. |
| `arrival_time` | one of | `2026-09-20T10:00` | First flight's arrival, local time at `via`. |
| `departure_time` | one of | `2026-09-20T11:30` | Second flight's departure, local time at `via`. |
| `layover_minutes` | one of | `90` | Use instead of the two times when only the layover length is known. |
| `ticket` | no | `protected` | `protected` (one booking), `separate` (self-transfer), `unknown` (default). |
| `arrival_terminal`, `departure_terminal` | no | `2`, `5` | A terminal change is detected when both are given and differ. |
| `terminal_change` | no | `true` | Use when a change is known but terminals are not. |
| `baggage_recheck` | no | `true` | Bags must be collected and checked in again. |

Give either both times or `layover_minutes`. If both are given they must agree.

Example result text:

```text
BER–LHR–PVG: REASONABLE — A practical connection on one ticket.
Layover 90 min, transfer steps 55 min, margin 35 min.
Steps counted: Move through airport 40 min (heuristic); Allow for another security check 15 min (heuristic). No other steps were counted.
Factors: Transfer through London Heathrow; Additional security screening may apply; Moderate transfer margin.
Ticket: Protected itinerary.
Data: London Heathrow profile (partial, 3 cited facts).
Airport facts are context, not extra steps. Apply a fact only where its scope matches this trip:
- All connecting passengers go through security screening again at Heathrow.
- Connections between different terminals use a free transfer bus that runs about every 10 minutes.
- Heathrow does not publish a minimum connection time; travellers are told to check their airline's figure, which does not apply to separately booked flights.
```

`steps` always adds up to `transfer_process_minutes`. Facts are listed with
their `scope` (for example "Lufthansa-operated connections only") so the agent
does not apply them to the wrong trip.

The same data is returned as `structuredContent` matching the tool's output schema.

## Setup

Requires Node.js 20+.

**Claude Desktop** — add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "open-transfer-times": {
      "command": "npx",
      "args": ["-y", "open-transfer-times-mcp"]
    }
  }
}
```

**Claude Code**:

```bash
claude mcp add open-transfer-times -- npx -y open-transfer-times-mcp
```

**From a clone of this repository** (before the package is published):

```json
{
  "mcpServers": {
    "open-transfer-times": {
      "command": "node",
      "args": ["/absolute/path/to/open-transfer-times/packages/mcp/src/cli.js"]
    }
  }
}
```

Run `npm install` at the repository root first.

## Using it with a flight-search server

Pair it with any MCP server that searches flights. Ask the agent something like
"Find flights from Berlin to Shanghai on 20 September and rank the one-stop
options by how safe the connection is" — the agent searches with one server and
passes the results to `compare_connections`.

## Limits

- One-stop itineraries (two segments) only.
- A structural estimate from scheduled times and published airport information:
  not an official minimum connection time, and not a delay prediction.
- 13 airports have their own profile; all others use a standard baseline, which
  the result reports as `coverage: "baseline"`.

## Development

```bash
npm install                          # at the repository root
node packages/mcp/test/server.test.js
npx @modelcontextprotocol/inspector node packages/mcp/src/cli.js   # interactive testing
```
