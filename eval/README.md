# Agent evaluation

How reliably does an AI agent use the open-transfer-times MCP server? This
folder runs natural-language questions through Claude with the real MCP server
attached and grades every answer.

It exists because the failures that matter are not in the engine's numbers but
in how a model uses them. Manual testing in Claude Desktop found three:
explaining steps the engine did not count, inventing dates when only a layover
length was given, and applying an airline-specific fact to the wrong trip. Each
of those is now a check here, so a change to the tool's output or descriptions
can be measured instead of judged by eye.

## Run it

Requires an Anthropic API key. Each case makes a few Claude API calls (the agent
loop plus one judge call), so start with a subset.

```bash
export ANTHROPIC_API_KEY=...            # PowerShell: $env:ANTHROPIC_API_KEY="..."
npm run eval -- --limit 5               # first five cases
npm run eval -- --category compare      # one category
npm run eval -- --only low-vie-zh       # one case
npm run eval -- --repeat 3              # every case three times, to see variance
npm run eval -- --model <model-id> --judge-model <model-id>
```

The default model is `claude-sonnet-5-5`; set `EVAL_MODEL` / `EVAL_JUDGE_MODEL`
or pass the flags to change it. Results are written to `eval/results/`
(git-ignored) as a markdown report and the full JSON transcripts.

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
