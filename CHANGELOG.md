# Changelog

## 0.2.0

Addresses the second external review: correct layovers across clock changes,
and missing data never turns into a recommendation. Both packages go to 0.2.0.

### Changed (results can differ from 0.1.x)
- **Real layover length.** The 13 profiled airports now have an IANA time zone,
  so a layover across a daylight-saving change is the real elapsed time. At FRA
  on 29 March 2026, 01:30 → 03:30 is 60 minutes (was 120, rated comfortable;
  now tight). A time in the repeated autumn hour uses the shorter layover; a
  time in the skipped spring hour is rejected. Away from clock changes nothing
  changes.
- **Bags on separate tickets are required / not required / unknown.** Not
  stating them no longer means "no re-check". When a re-check would make the
  connection tight or risky, confidence is low (`BAGGAGE_UNKNOWN`) and the
  result shows the margin with a re-check (`ifBaggageRecheck`).
- `compare_connections` ranks by decision first: a connection with missing data
  no longer outranks a usable one.
- MCP: a `baggage_recheck` that is omitted is passed on as unknown (0.1.x
  treated it as false).
- MCP: scoped airport facts are shown as `(Only for: …) claim` in the text
  result, and the FRA and CDG scopes name the trips they cover. In the agent
  evaluation, agents applied scoped facts to every trip when the scope trailed
  the claim.
- MCP: instructions tell agents to call a tool first with what the user gave
  (ticket and bags may be unknown) and to ask about bags after the result;
  `check_connection` points comparisons to `compare_connections`.

### Added
- `decision` on every assessment: `recommend`, `caution`, `insufficient_data`
  or `avoid`, with reasons. Missing data never yields `recommend`.
- Times may carry UTC offsets (`2026-03-29T01:30+01:00`), exact at any airport.
- `CLOCK_CHANGE` factor, `layoverBasis`, `wallClockLayoverMinutes`; confidence
  reason `DST_AMBIGUOUS`; `layoverMinutes(arrival, departure, iata)` export.
- MCP: server instructions sent on connect (use `layover_minutes`, explain
  only counted steps, report the decision, ask about bags, respect fact scopes).
- `timezone` field in airport files, validated by the build.
- Eval: two cases (spring clock change, bags not stated) and judge checks
  `decision_respected` and `asks_about_baggage`.
- Eval runs on any provider: Anthropic, OpenAI, OpenRouter, a local Ollama or
  any OpenAI-compatible endpoint, with a separate judge provider;
  `npm run eval:compare` puts runs side by side; `--no-server-instructions`
  measures what the MCP instructions are worth.
- Eval progress is saved after every case; `--resume <results.json>` continues
  an interrupted run with the same settings. A run stops after three
  connection errors in a row instead of failing every remaining case.
- `--no-think` for reasoning models (Qwen3 `/no_think`); `<think>` blocks are
  removed from answers and judge replies.
- Ollama defaults to `http://127.0.0.1:11434/v1` (Node can resolve `localhost`
  to IPv6, which Ollama does not listen on); connection failures name the
  endpoint and the cause.
- Fairer eval checks: a comparison checked option by option now fails only
  `compare_used`, not every `expected_call` as well; expected values may list
  alternatives (Shanghai is PVG or SHA); the `fact_scope` judge accepts an answer
  that explains why a scoped fact does not apply to the trip.

Ratings, minutes and factors are unchanged from 0.1.x on all 32,580 generated
non-DST cases; confidence differs only where the new baggage rule applies.

## 0.1.2 (open-transfer-times-mcp only)

- Added `mcpName` and `server.json` so the server can be listed in the
  official MCP Registry as `io.github.joelynli0110/open-transfer-times`.
- Issue forms for airport data and bug reports.
- No behaviour changes. The `open-transfer-times` library stays at 0.1.1.

## 0.1.1

Addresses the first external review: results now say how far they can be
trusted, and ranking accounts for ticket protection.

### Added
- `confidence` on every assessment (`high` / `medium` / `low` with reasons),
  reported separately from the quality rating. Airports without a profile and
  routes whose border situation cannot be determined are always `low`, so
  missing data is never presented as "no risk". Shown in the MCP summary and,
  when low, in the Chrome extension panel.
- GitHub Actions CI on Ubuntu and Windows, Node 20 and 22.
- `npm run smoke`: packs both npm packages, installs the tarballs and calls the
  MCP server over stdio.
- README quick start for the MCP server and the library.

### Changed
- `compare_connections` ranks by quality, then ticket protection (one ticket →
  unknown → self-transfer), then confidence, then margin. Previously a longer
  self-transfer could outrank a protected connection.
- The engine rejects itineraries with more than two segments instead of
  silently ignoring later connections.

Quality ratings and transfer-step minutes are unchanged from 0.1.0.

## 0.1.0

First public release: open airport dataset (13 hubs with cited facts),
`open-transfer-times` engine, `open-transfer-times-mcp` server, Chrome
extension beta.
