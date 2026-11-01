# RFC 0001: Context-dependent transfer rules (v0.2)

- Status: **Draft — feedback wanted**
- Target release: 0.2.0
- Discussion: GitHub issue linked from this file's PR

## Summary

Today every airport has four fixed numbers: base transfer, passport control,
terminal change, security re-screening. Real transfer rules depend on the trip:
where you arrive from, which terminals, whether you hold one ticket or two.
This RFC proposes:

1. **A country for every airport**, so Schengen status is known for all 9,054
   catalog airports instead of a hand-kept list of 56.
2. **Steps with conditions** (`applies_when`) in the airport files, replacing the
   four fixed allowances.
3. **Self-transfer as a set of steps**: entering and leaving the country when
   bags must be re-checked on separate tickets.
4. **Time zones** for profiled airports, so layovers across a daylight-saving
   change are computed correctly.
5. **Deep sourcing of LHR, FRA and MUC**, so `high` confidence is reachable.

Each part ships separately and is measured with the agent evaluation in
[`eval/`](../../eval).

## Problems this solves

All are open issues or open-question comments in the airport files today.

| # | Problem | Today's behaviour | Where it is recorded |
| --- | --- | --- | --- |
| P1 | Schengen status known for 56 airports only | Other routes get `CONNECTION_ZONE_UNKNOWN` or `ROUTE_ZONE_UNKNOWN`; passport control is not counted or is a generic 10 min | v0.1.1 confidence reasons |
| P2 | Security re-screening at AMS depends on where you arrive from | Fixed 0 min | `airports/AMS.yaml` open question |
| P3 | MUC screens transfer passengers "in some cases" | Fixed 0 min | external review; `airports/MUC.yaml` fact `conditional-security` |
| P4 | NRT terminal pairs differ: T2→T3 about 4 min, T3→T1 24–28 min by bus | One 20-minute value for any change | `airports/NRT.yaml` open question |
| P5 | Self-transfer with bag re-check means entering and leaving the country | Only a flat 45 min; passport control counted as 0 outside Schengen | Claude flagged this in manual testing (IST) |
| P6 | Layovers across a daylight-saving change are wrong | FRA 25 Oct 2026, 01:30→03:30 computed as 120 min; real elapsed time is 180 min | external review |
| P7 | No minute value is sourced | `high` confidence is unreachable | `airports/COVERAGE.md`: 0 of 52 |

## Design

### 1. Trip context

The engine builds one context object per assessment. Conditions can only refer
to these fields, so the vocabulary stays small and every value is validated.

| Field | Values | Source |
| --- | --- | --- |
| `from_country`, `to_country` | ISO 3166-1 alpha-2 | airport catalog (new, see §2) |
| `from_region`, `to_region` | `schengen`, `non_schengen` | derived from country |
| `crosses_schengen_border` | `true` / `false` | derived |
| `ticket` | `protected`, `separate`, `unknown` | input |
| `baggage_recheck` | `true`, `false`, `unknown` | input |
| `arrival_terminal`, `departure_terminal` | string or unknown | input |
| `terminal_change` | `true`, `false`, `unknown` | input or derived from terminals |
| `operating_airline` | IATA airline code or unknown | input (new, optional) |

### 2. A country for every airport (P1)

`scripts/generate-airport-catalog.js` already reads OurAirports, which has
`iso_country` for every airport. Store it beside the name:

```js
AIRPORTS = { "VIE": { name: "Vienna International Airport", country: "AT" }, ... }
```

`travelZone(iata)` then answers from the country and `regions/schengen.yaml`'s
country list. The hand-kept `airports.schengen` / `airports.non_schengen` lists
are removed.

Territories are mostly handled by ISO codes already: the Faroe Islands (FO),
Greenland (GL), Svalbard (SJ), French overseas departments (GF, GP, MQ, RE, YT)
and Gibraltar (GI) have their own codes and are outside Schengen. Cases a
country code cannot express (e.g. Ceuta and Melilla) go in an `exceptions` list
in `regions/schengen.yaml`, each with a source.

**Effect:** most `ROUTE_ZONE_UNKNOWN` and `CONNECTION_ZONE_UNKNOWN` results
disappear, and passport control is counted where it was silently skipped.
Ratings for those routes will change; that is the point, and the changelog says
so.

### 3. Steps with conditions (P2, P3, P4)

An airport file lists **steps**. Each step has minutes, a basis, supporting
facts, and optionally a condition. Conditions in one `applies_when` are ANDed;
`applies_when_any` takes a list of condition sets that are ORed.

```yaml
# airports/AMS.yaml (format v2, abridged)
format: 2
iata: AMS
timezone: Europe/Amsterdam

steps:
  - id: base-transfer
    minutes: 30
    basis: heuristic

  - id: passport-control
    minutes: 20
    basis: heuristic
    applies_when: { crosses_schengen_border: true }
    facts: [schengen-passport-control]

  - id: security-rescreening
    minutes: 15
    basis: heuristic
    applies_when:
      from_region: non_schengen
      from_country_not_in: [US, CA, GB, IE, SG, CY]
      from_airport_not_in: [BEG]
    facts: [conditional-security]
```

```yaml
# airports/NRT.yaml (format v2, abridged)
steps:
  - id: terminal-change-t3-t1
    minutes: 28
    basis: sourced          # upper end of the published 24–28 min bus ride
    applies_when: { arrival_terminal: "3", departure_terminal: "1" }
    facts: [inter-terminal-bus]
  - id: terminal-change
    minutes: 20
    basis: heuristic        # any other terminal pair
    applies_when: { terminal_change: true }
```

**Closed condition vocabulary**, checked by the build script:

| Condition | Meaning |
| --- | --- |
| `crosses_schengen_border: true\|false` | |
| `from_region` / `to_region: schengen\|non_schengen` | |
| `from_country_in` / `from_country_not_in: [codes]` | also `to_country_*` |
| `from_airport_in` / `from_airport_not_in: [IATA]` | also `to_airport_*` |
| `ticket: protected\|separate` | |
| `baggage_recheck: true` | |
| `terminal_change: true` | |
| `arrival_terminal`, `departure_terminal: "<t>"` | exact terminal |
| `operating_airline_in: [codes]` | e.g. Lufthansa-only rules |

**Specificity.** When several steps share a prefix (`terminal-change-t3-t1` and
`terminal-change`), the most specific matching step wins and the others are
skipped. "Most specific" = most conditions; a tie is a build error.

**Unknown context.** A step whose condition depends on something unknown (no
terminals given, ticket unknown) is **not counted**, matching today's
behaviour, but it is returned as a `possible_step` with its minutes, and
confidence drops to at most `medium` with reason `STEP_CONDITION_UNKNOWN`. The
agent can then ask the user for the missing detail. See open question Q1.

### 4. Self-transfer steps (P5)

`airports/_baseline.yaml` gains a default **landside transfer** used at every
airport unless the airport overrides it:

```yaml
  - id: landside-entry        # immigration into the connection country
    minutes: 20
    basis: heuristic
    applies_when: { ticket: separate, baggage_recheck: true, from_region: non_schengen }
  - id: bag-reclaim-and-checkin
    minutes: 45                # today's BAGGAGE_RECHECK value
    basis: heuristic
    applies_when: { baggage_recheck: true }
  - id: landside-exit         # departure passport control
    minutes: 15
    basis: heuristic
    applies_when: { ticket: separate, baggage_recheck: true, to_region: non_schengen }
  - id: departure-security
    minutes: 15
    basis: heuristic
    applies_when: { ticket: separate, baggage_recheck: true }
```

Inside Schengen, entry and exit steps do not apply. Visa requirements are out
of scope: the result says entry may require a visa and links no rule.

### 5. Time zones (P6)

Each profiled airport file gets `timezone` (IANA, e.g. `Europe/Berlin`).
The engine converts both local wall-clock times to instants with `Intl`
(built into Node and Chrome, so still no dependencies) and computes the real
elapsed time.

- A time that occurs twice (the repeated hour when clocks go back) is
  ambiguous: the engine uses the reading that gives the **shorter** layover
  and adds confidence reason `DST_AMBIGUOUS`.
- A time that does not exist (the skipped hour) is an input error.
- Inputs may also carry an explicit offset (`2026-10-25T01:30+02:00`), which
  removes the ambiguity.
- Airports without a profile keep wall-clock arithmetic for now; see Q3.

### 6. Output

Additive, so 0.1.x consumers keep working:

- each step in `steps` gains `id` and `condition` (a readable sentence, e.g.
  "arriving from outside Schengen, not from US, CA, GB, IE, SG, CY or BEG");
- new `possible_steps` (same shape) for steps whose condition was unknown;
- new confidence reasons `STEP_CONDITION_UNKNOWN`, `DST_AMBIGUOUS`;
- `modelVersion: "structural-v3"`.

The MCP summary lists possible steps after counted steps: "Not counted, may
apply: change terminals 28 min (if T3 → T1)."

### 7. Deep sourcing (P7)

Before adding airports, take three to `sourced` minutes where an official
figure exists. Known candidates:

| Airport | Step | Source today |
| --- | --- | --- |
| MUC | T1 ↔ T2 bus: 5–7 min ride, every 10–20 min | `muc-connecting` (already cited) |
| NRT | per terminal-pair bus times | `nrt-inter-inter` (already cited) |
| LHR | inter-terminal bus every 10 min | `heathrow-connecting` (already cited) |
| FRA | Fraport transfer information | to find (issue: reconcile 55 vs 60 min) |

A bus ride is only part of a terminal change (walking, waiting, re-screening),
so a sourced step may be split: `terminal-bus` (sourced) +
`terminal-change-walk` (heuristic). Confidence is `high` only when every counted
step is sourced, so this split is what makes `high` reachable.

## Migration and compatibility

1. **Converter.** `scripts/migrate-airports-v2.js` rewrites v1 files into v2
   steps with conditions that reproduce v1 exactly (e.g. passport control →
   `applies_when: { crosses_schengen_border: true }`).
2. **Parity gate.** Before any rule changes, the engine on migrated data must
   return the same ratings and minutes as 0.1.1 on the existing 32,580
   generated cases. Only then do P1–P6 change behaviour, each in its own PR
   with its own changelog entry.
3. The build script accepts v1 and v2 files during the transition, so
   contributors' open PRs keep working.
4. Version 0.2.0 for both packages; the MCP tool inputs gain one optional
   field, `operating_airline`.

## How we will know it worked

- **Engine tests** for each problem: AMS from JFK (no re-screening) vs from
  BKK (re-screening); NRT T3→T1; IST self-transfer with bags; FRA across
  25 Oct 2026 01:30→03:30 = 180 min.
- **Agent evaluation** ([`eval/`](../../eval)): run before and after each
  step. New cases for possible steps ("Do I need to change terminals?") and
  self-transfer at a non-Schengen airport. The goal is no regression on
  existing checks and agents asking for terminals when a possible step exists.
- **Coverage**: `airports/COVERAGE.md` shows at least one sourced minute value
  for MUC, NRT and LHR.

## Rollout

| PR | Change | Changes ratings? |
| --- | --- | --- |
| 1 | Country in airport catalog; zones by country (§2) | Yes, for previously unknown routes |
| 2 | Format v2 + converter + parity gate (§3, §6) | No |
| 3 | Conditional rules: AMS, MUC, NRT (§3) | Yes, for those airports |
| 4 | Self-transfer steps (§4) | Yes, for separate tickets with bags |
| 5 | Time zones for profiled airports (§5) | Only across DST changes |
| 6 | Deep sourcing MUC, NRT, LHR (§7) | Minutes may change; confidence may rise |

PR 1 is independent and could ship as 0.1.2 of the library.

## Open questions

- **Q1. Unknown context: skip or assume the worst?** Proposal: do not count,
  report as possible step, lower confidence. Alternative: count conservative
  steps when unknown, which is safer for travellers but makes many short
  connections look risky on incomplete data. Which serves agents better?
- **Q2. Specificity rule.** "Most conditions wins" is simple. Is an explicit
  `overrides: <step id>` clearer for contributors?
- **Q3. Time zones for airports without a profile.** OurAirports has no time
  zones. Options: a separate public-domain time-zone source (licence to check),
  explicit offsets only, or leave as is with a confidence note.
- **Q4. Airline-scoped rules.** `operating_airline_in` lets the Lufthansa FRA
  rule become a real step. Do we want airline MCTs in the engine at all, or
  keep them as context facts?
- **Q5. Format churn.** Is v2 worth breaking contributors' mental model now,
  with few external contributors, rather than later?

Feedback on these is the most useful thing at this stage. Comment on the
linked issue.
