# Flight search + Open Transfer Times

This walkthrough connects a flight-search MCP server and Open Transfer Times in
one MCP client, so a single request goes from real flight results to
recommendations ranked by connection risk:

> *"Find flights from Berlin to Shanghai on 21 December 2026. I prefer cheaper
> options, but I don't want risky connections."*

1. **Search.** The agent calls the flight-search server and gets real
   itineraries: legs, airlines, local times, prices.
2. **Assess.** It sends the itineraries to `compare_connections`, which checks
   every connection: transfer steps at that airport, Schengen border, published
   minimum connection times, ticket protection, missing information.
3. **Recommend.** It answers with price and risk side by side, and says why a
   cheap itinerary is not recommended or what is missing to judge it.

This is the quick version: the agent itself maps search results to the tool's
inputs. A version where code does the mapping, for reliable and repeatable
results, is planned as `examples/flight-search-agent/`.

## Setup (Claude Desktop)

The example uses [fli](https://github.com/punitarani/fli), an open-source MCP
server for Google Flights data.

1. Install fli (Python 3.10+):

   ```bash
   pipx install flights
   ```

   Find the path of its MCP server: `which fli-mcp` (macOS/Linux) or
   `where fli-mcp` (Windows, usually
   `C:\Users\<you>\.local\bin\fli-mcp.exe`).

2. Add both servers to `claude_desktop_config.json`, then fully restart Claude:

   ```json
   {
     "mcpServers": {
       "fli": { "command": "/Users/<you>/.local/bin/fli-mcp" },
       "open-transfer-times": { "command": "npx", "args": ["-y", "open-transfer-times-mcp"] }
     }
   }
   ```

   On Windows, use the full `fli-mcp.exe` path with doubled backslashes, e.g.
   `"C:\\Users\\<you>\\.local\\bin\\fli-mcp.exe"`.

3. In a new chat, check that both appear under the tools icon:
   `search_flights` (fli) and `compare_connections` (Open Transfer Times).

## Prompts to try

| Prompt | What it shows |
| --- | --- |
| *Find flights from Berlin to Shanghai on 21 December 2026. I prefer cheaper options, but I don't want risky connections.* | The full loop: search, assess, rank by price and risk. |
| *Same search, one stop only. Which of the cheapest five has the riskiest connection, and why?* | Explanations per connection: steps counted, missing information. |
| *Find Frankfurt to Bangkok on 10 January 2027 and only show itineraries whose connections you would recommend.* | Filtering by `decision`, without hiding why others were dropped. |
| *Berlin to Tokyo on 5 February 2027, two stops allowed. Check every connection.* | Multi-stop itineraries: each connection checked, the itinerary as risky as its worst one. |

## What a good answer looks like

- Every connection of every itinerary shown has a **decision**
  (`recommend` / `caution` / `insufficient_data` / `avoid`) from the tool.
- **`insufficient_data` is shown as such**, never as a low-risk recommendation.
- Unknowns stay unknown: no invented terminals, and no "bags checked through"
  unless the search says so.
- Ticket protection follows the search result: `separate` only where it marks a
  self-transfer; otherwise the tool's answer covers both cases.
- A cheaper itinerary that is not recommended comes with the reason (e.g. the
  margin after passport control, or a minimum connection time not met).

## Recording a demo

For a 2–3 minute video:

1. Show both servers in the tools list.
2. Run the first prompt; expand the tool calls once to show the itineraries
   going into `compare_connections`.
3. Point at the cheapest itinerary that is *not* recommended, and at any
   `insufficient_data` result.
4. Note the search date and time on screen: prices and schedules change, so a
   recording is only valid for that moment.

## Limits

- **Search data.** fli reads Google Flights through an unofficial,
  reverse-engineered interface. It suits demos and evaluation; it is not a
  dependency of Open Transfer Times and may stop working.
- **Ticket protection.** Google Flights marks self-transfers. When a result does
  not say either way, the ticket is passed as unknown and the answer covers both
  cases.
- **Airport changes** within a city (e.g. arriving LHR, leaving LGW) are not
  assessed; the agent should say so.
- **Terminals** are rarely in search results, so connections at airports where
  changing terminals takes time often come back as `caution` with a margin
  range. That is by design: the engine does not assume the best case.
- The agent maps search results to the tool's inputs itself, which can go
  wrong (a missed leg, a misread time). The planned code-based example removes
  that step; the [agent evaluation](../eval) will compare both.
