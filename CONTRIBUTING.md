# Contributing

The most valuable contribution to this project is **airport data**: verified,
sourced facts about how transfers work at a specific airport. You do not need
to touch any code to add or improve an airport.

See [`airports/COVERAGE.md`](airports/COVERAGE.md) for which airports exist and
how well each one is sourced. Airports marked `heuristic` are good first issues.

## Ground rules for data

1. **Every fact needs a source.** Prefer, in this order: the airport operator's
   own website, an airline's official page, a government or regulator page.
   Travel blogs, forums, aggregator sites and AI-generated text are not sources.
2. **State only what the source says.** Write the claim in your own words, but
   do not extend it. If the page says "transfer passengers are screened again",
   do not add "this takes 15 minutes".
3. **Keep durations honest.** A minute value is `basis: sourced` only when a
   cited fact gives that duration (or a minimum connection time it is derived
   from). Otherwise it stays `basis: heuristic`, even if the step itself is
   confirmed.
4. **Airline-specific facts need a scope.** A minimum connection time published
   by one airline applies to that airline's connections; say so in `scope`.
5. **Record when you checked.** Set `retrieved` on each source and update
   `last_reviewed` on the airport.

This dataset is not an official minimum connection time (MCT) table. Official
MCTs are commercial data published by IATA and schedule providers; this project
collects publicly available information and conservative estimates.

## Airport file format

One file per airport in `airports/`, named by IATA code (`airports/FRA.yaml`).
Airports without a file use [`airports/_baseline.yaml`](airports/_baseline.yaml).

```yaml
iata: LHR                      # must match the file name
name: London Heathrow
country: GB                    # ISO 3166-1 alpha-2
last_reviewed: 2026-10-29      # when someone last checked this file

allowances:                    # minutes the engine deducts from the layover
  base_transfer:        { minutes: 40, basis: heuristic }
  passport_control:     { minutes: 0,  basis: heuristic }
  terminal_change:      { minutes: 25, basis: heuristic, facts: [inter-terminal-bus] }
  security_rescreening: { minutes: 15, basis: heuristic, facts: [transfer-security] }

facts:
  - id: transfer-security      # lowercase-kebab-case, unique in the file
    claim: All connecting passengers go through security screening again at Heathrow.
    source: heathrow-connecting
    # scope: Lufthansa-operated connections only   (optional)

sources:
  heathrow-connecting:
    title: Connecting flights
    publisher: Heathrow Airport
    url: https://www.heathrow.com/connecting-flights   # https only
    retrieved: 2026-10-29
    # published: 2024-09-10    (optional, if the page is dated)
```

### Allowances

| Field | Applied when |
| --- | --- |
| `base_transfer` | Always: deplaning, walking, normal transfer steps. |
| `passport_control` | The transfer crosses the Schengen border at a Schengen airport. |
| `terminal_change` | Arrival and departure terminals differ. |
| `security_rescreening` | Always, if greater than 0: transfer passengers are screened again. |

Each allowance has a `basis` (`heuristic` or `sourced`) and an optional list of
`facts` that support it. Listing a fact on a heuristic allowance means "this
step is confirmed to exist, but its duration is still an estimate".

### Schengen membership

[`regions/schengen.yaml`](regions/schengen.yaml) lists Schengen member
countries (with a source) and which airports the engine classifies as Schengen
or non-Schengen. An airport with its own profile must also appear in that list
with a matching country; the build checks this.

## Workflow

```bash
npm install
# edit airports/XYZ.yaml
npm run airports:build   # validates the data and regenerates derived files
npm run check            # full test suite + extension build
```

`airports:build` regenerates two files that you should commit together with
your YAML change:

- `packages/core/src/data/airport-data.generated.js` — runtime data for the engine
- `airports/COVERAGE.md` — the coverage table

CI (`npm run check`) fails if either is out of date, if any field is missing or
malformed, if a fact cites an undefined source, or if a source is unused.

### Pull request checklist

- [ ] Every new fact cites an official source that I opened myself.
- [ ] Claims say no more than the source does.
- [ ] Minute values I changed are either still `heuristic`, or backed by a cited fact.
- [ ] `last_reviewed` and `retrieved` dates are updated.
- [ ] `npm run check` passes and the regenerated files are committed.

## Code contributions

The engine lives in [`packages/core`](packages/core) and has no runtime
dependencies. Behaviour changes need tests in `packages/core/test/`. The Chrome
extension in `extension/` consumes the same files; `npm run build` copies them
into `dist/core/`.
