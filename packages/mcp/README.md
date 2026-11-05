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
| `check_connection` | Assess one connection: a **decision** (`recommend` / `caution` / `insufficient_data` / `avoid`), the rating (`comfortable` → `risky`), a confidence level with reasons, the real layover, each transfer step counted with its minutes, the margin, ticket-protection exposure, and the connection airport's cited facts. |
| `compare_connections` | Assess 2–20 itineraries (e.g. flight-search results) and rank them: by decision, then rating, then ticket protection (one ticket → unknown → self-transfer), then confidence, then margin. A connection with missing data never outranks a usable one. Pass your own `id` per option to map results back. |
| `get_airport_profile` | An airport's transfer allowances, whether each is `heuristic` or `sourced`, and its cited facts with official links. |
| `list_airports` | Airports with their own profile and how well each is sourced. |

### `check_connection` input

| Field | Required | Example | Notes |
| --- | --- | --- | --- |
| `from`, `via`, `to` | yes | `BER`, `LHR`, `PVG` | IATA codes; case-insensitive. |
| `arrival_time` | one of | `2026-09-20T10:00` | First flight's arrival, local time at `via`; a UTC offset (`+02:00`) is optional. |
| `departure_time` | one of | `2026-09-20T11:30` | Second flight's departure, local time at `via`. |
| `layover_minutes` | one of | `90` | Use instead of the two times when only the layover length is known. |
| `ticket` | no | `protected` | `protected` (one booking), `separate` (self-transfer), `unknown` (default). |
| `arrival_terminal`, `departure_terminal` | no | `2`, `5` | A terminal change is detected when both are given and differ. |
| `terminal_change` | no | `true` | Use when a change is known but terminals are not. |
| `baggage_recheck` | no | `false` | `true`: bags must be collected and checked in again. `false`: hand luggage only, or checked through. Omit only if unknown; on separate tickets the result then shows whether it matters. |

Give either both times or `layover_minutes`. If both are given they must agree.

Example result text:

```text
BER–LHR–PVG: RECOMMEND — Enough time after the transfer steps, on a protected ticket, with usable data.
Rating: REASONABLE — A practical connection on one ticket.
Confidence: MEDIUM — The transfer-step durations are rule-of-thumb estimates, not sourced figures.
Layover 90 min, transfer steps 55 min, margin 35 min.
Steps counted: Move through airport 40 min (heuristic); Allow for another security check 15 min (heuristic). No other steps were counted.
Factors: Transfer through London Heathrow; Additional security screening may apply; Moderate transfer margin.
Ticket: Protected itinerary.
Data: London Heathrow profile (partial, 3 cited facts).
Comparing several options? Send them together to compare_connections, which ranks them.
Airport facts are context, not extra steps. Apply a fact only where its scope matches this trip:
- All connecting passengers go through security screening again at Heathrow.
- ...
```

On separate tickets with bags not stated, where a re-check would matter:

```text
BER–IST–PVG: INSUFFICIENT DATA — Separate tickets, and it is not known whether bags must be collected and checked in again; a re-check would make this connection tight or risky. With a bag re-check the margin would be -15 min (risky). The result cannot be relied on.
Do not call this connection safe, fine or comfortable. Tell the user the estimate is unreliable, why, and what would settle it.
Confidence: LOW, for the reasons above.
Rough estimate only: layover 75 min, transfer steps 45 min, margin 30 min.
...
Bags: not stated. If they must be collected and checked in again, the margin is -15 min (risky). Ask the user.
```

- The text leads with the decision, and `compare_connections` explains each
  option that is not recommended ("Why: …"). With `insufficient_data` the text
  leaves out the rating entirely: in the agent evaluation, agents repeated
  "comfortable" and "healthy margin" as reassurance even when the decision said
  the rating could not be relied on. The rating stays in `structuredContent`.
- `decision` is the field to act on. `insufficient_data` means key information
  is missing (the confidence reasons say what): ask the user rather than
  recommending the connection.
- `steps` always adds up to `transfer_process_minutes`. Facts are listed with
  their `scope` (for example "Air France connections at Paris airports") so the
  agent does not apply them to the wrong trip.
- Layovers are real elapsed time: at the 13 profiled airports a layover across a
  daylight-saving change is computed in the airport's time zone, and
  `wall_clock_layover_minutes` shows what the clocks say.

### Instructions for agents

The server sends usage instructions when a client connects (MCP `instructions`):
call a tool first with what the user gave, pass `layover_minutes` instead of
inventing times, ask only when the airport or the duration is missing, use
`compare_connections` for comparisons, explain only the counted steps, report
the decision, ask about bags on separate tickets after giving the result, and
respect fact scopes (scoped facts are shown as "(Only for: …)"). Each rule addresses a
failure seen when testing agents; see [eval](../../eval).

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
- Clock changes are handled at the 13 profiled airports; elsewhere pass times
  with UTC offsets for exact layovers.

## Development

```bash
npm install                          # at the repository root
node packages/mcp/test/server.test.js
npx @modelcontextprotocol/inspector node packages/mcp/src/cli.js   # interactive testing
```
