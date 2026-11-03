# Changelog

## Unreleased

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
