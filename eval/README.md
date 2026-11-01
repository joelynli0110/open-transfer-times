# Agent evaluation

How reliably does an AI agent use the open-transfer-times MCP server? This
folder runs natural-language questions through a model with the real MCP server
attached and grades every answer. It works with Anthropic, OpenAI, OpenRouter,
a local Ollama, or any OpenAI-compatible endpoint, so models can be compared.

It exists because the failures that matter are not in the engine's numbers but
in how a model uses them. Manual testing in Claude Desktop found three:
explaining steps the engine did not count, inventing dates when only a layover
length was given, and applying an airline-specific fact to the wrong trip. Each
of those is now a check here, so a change to the tool's output or descriptions
can be measured instead of judged by eye.

## Run it

Each case makes a few model calls (the agent loop plus one judge call), so
start with a subset.

```bash
# Anthropic (default provider)
export ANTHROPIC_API_KEY=...                      # PowerShell: $env:ANTHROPIC_API_KEY="..."
npm run eval -- --limit 5

# A local model through Ollama: no API key, no cost
npm run eval -- --provider ollama --model <model> --judge-provider anthropic

# Any model on OpenRouter, or OpenAI directly
export OPENROUTER_API_KEY=...
npm run eval -- --provider openrouter --model <vendor/model> --judge-provider anthropic
npm run eval -- --provider openai --model <model> --judge-provider anthropic

# Any other OpenAI-compatible endpoint
npm run eval -- --provider compatible --base-url https://host/v1 --api-key-env MY_KEY --model <model>
```

Selecting cases: `--limit 5`, `--category compare`, `--only low-vie-zh`,
`--repeat 3` (every case three times, to see variance). `npm run eval -- --help`
lists all options.

| Provider | Key variable | Notes |
| --- | --- | --- |
| `anthropic` | `ANTHROPIC_API_KEY` | Default; model defaults to `claude-sonnet-5-5`. |
| `openai` | `OPENAI_API_KEY` | `--model` required. |
| `openrouter` | `OPENROUTER_API_KEY` | One key for many vendors' models; `--model` required. |
| `ollama` | none | Local, `http://localhost:11434/v1`. Use a model that supports tool calling. |
| `compatible` | `--api-key-env` (default `OPENAI_API_KEY`) | Any Chat Completions endpoint; `--base-url` required. |

Results are written to `eval/results/` (git-ignored) as a markdown report and
the full JSON transcripts.

### Comparing models

```bash
npm run eval:compare -- eval/results/<run-a>.json eval/results/<run-b>.json --out comparison.md
```

prints one column per run: runs passing every check, each check's pass rate,
each category, and token use. Only cases present in every run are compared.

**Keep the judge fixed.** The judge grades the answers, so a comparison is only
fair when every run uses the same judge. Pass `--judge-provider` (and
`--judge-model`) explicitly when the agent is not Anthropic; by default the
judge is the agent's own model, which is fine for a single run but not for
comparisons, and a small local model is a weak judge. The comparison warns when
runs used different judges.

### Server instructions

MCP clients differ in whether they pass a server's instructions to the model.
By default the agent gets them (like clients that support it);
`--no-server-instructions` leaves them out. Running both on the same model
measures what the instructions are worth.

## What is checked

[`cases.json`](cases.json) holds 36 questions in Chinese and English across
nine categories: clock times, layover duration only, separate tickets, airports
without a profile (low confidence), scoped facts, comparisons, multi-stop trips,
questions missing information, and airport-data questions.

**Tool calls (deterministic):**

| Check | Fails when |
| --- | --- |
| `tool_called` | The agent answers without using a tool. |
| `expected_call` | No call has the expected airport, ticket, layover, etc. |
| `compare_used` | A comparison question is not sent to `compare_connections` with every option. |
| `no_arrival_time`, `no_departure_time` | The user gave only a duration and the agent invented clock times. |
| `no_tool_call` | The question lacks key information and the agent called a tool anyway. |
| `tool_calls_succeeded` | A call was rejected (wrong arguments). |

**Answers (model judge, against the tool results only):**

| Check | Fails when the answer… |
| --- | --- |
| `numbers_match` | states a layover, step time or margin that differs from the tool. |
| `no_invented_steps` | presents a transfer step as counted that is not in `steps`. |
| `no_invented_details` | adds dates, times, terminals or airlines nobody gave. |
| `fact_scope` | applies a scoped fact (e.g. one airline's MCT) to a trip outside its scope. |
| `confidence_reported` | does not flag a low-confidence result as less reliable. |
| `self_transfer_risk` | does not warn that separate tickets are unprotected. |
| `asks_for_missing_info` | guesses instead of asking when the question is incomplete. |

The judge must quote the failing words, and the report lists every failure with
the answer attached. Treat judge results as a strong signal, not ground truth:
read the failures before acting on them.

## Tests

`npm test` covers this folder without an API key: the checks, the judge-reply
parser, a full run with a scripted stand-in for Claude, and a test that every
expected call in `cases.json` is accepted by the real MCP server.
