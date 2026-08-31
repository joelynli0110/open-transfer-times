# First real ADRR benchmark run

This workflow is intentionally frozen for the first real-data evaluation. It
does not tune or change the delay model.

## Frozen protocol

| Setting | Value |
| --- | --- |
| Airports | BER, FRA, AMS, BUD |
| Lookback | 365 days |
| Minimum model history | 30 observations |
| Delay events | >15, >30, >60 minutes |
| Route eligibility | at least 200 total observations |
| Test observations | at least 50, or 20% when larger |

Changing these values requires a later, separately documented benchmark. The
`first-adrr-run` command exposes no options for changing them.

## Prerequisites

Install the plotting and Parquet dependencies:

```bash
python -m pip install -e ".[dev,benchmark]"
```

Place the licensed ADRR Flights file and a separately obtained airport mapping
under `data/raw/`. The mapping must contain `icao_code,iata_code` and cover the
airports present in the raw file. Neither raw nor processed data is committed.

Review the filed-arrival limitation in [data_sources.md](data_sources.md). ADRR
does not provide a passenger timetable arrival; the run measures deviation from
the last filed arrival time.

## One command

```bash
connection-risk first-adrr-run \
  --raw-dataset data/raw/eurocontrol/flights.csv \
  --airport-mapping data/raw/airport_codes.csv \
  --normalized-dataset data/processed/adrr_flights.parquet \
  --output benchmark/output \
  --accept-filed-arrival-proxy
```

The stages are executed in this order:

1. Detect the real file's encoding and delimiter.
2. Require exact official metadata labels and reject duplicate, empty, or
   whitespace-altered headers.
3. Hash the raw file and write the schema inspection.
4. Normalize in chunks, categorize rejected rows, and remove duplicates.
5. Select a deterministic SHA-256-ranked sample of 50 accepted rows and place
   raw source fields beside all normalized fields.
6. Reload and validate the processed dataset.
7. Run the pre-benchmark sanity gate.
8. Only when the gate passes, run the frozen rolling benchmark and experiments.
9. Write a manifest containing input and processed hashes, frozen parameters,
   and every artifact path.

## Inspection without ingestion

Use this before a first run if the downloaded file is unfamiliar:

```bash
connection-risk inspect-adrr \
  --raw-dataset data/raw/eurocontrol/flights.csv \
  --report data/processed/adrr_flights.schema.json
```

Unknown additional columns are reported but retained as source-only fields.
Missing required columns, duplicate headers, empty headers, and leading or
trailing header whitespace fail inspection. The JSON report is still written so
the mismatch can be reviewed without guessing field mappings.

## Generated pre-benchmark artifacts

Beside `data/processed/adrr_flights.parquet`:

- `adrr_flights.schema.json`: raw filename, size, SHA-256, encoding, delimiter,
  exact columns, additional fields, and sampled timestamp parse failures.
- `adrr_flights.quality.json`: accepted/rejected/duplicate counts and categorized
  rejection reasons.
- `adrr_flights.audit.csv`: deterministic raw-versus-normalized audit sample.
- `adrr_flights.sanity.json`: machine-readable sanity and eligibility report.
- `adrr_flights.sanity.md`: readable sanity report and route inventory.

The audit CSV contains at most 50 rows. A valid dataset with at least 50 accepted
observations must have exactly 50 audit rows. Review at minimum:

- `raw_ADEP`/`raw_ADES` against `normalized_origin`/`normalized_destination`;
- raw filed and actual arrival strings against normalized UTC timestamps;
- recalculated `normalized_arrival_delay_minutes`;
- raw operator/type against normalized carrier/aircraft type.

## Sanity gate

The benchmark does not start when:

- the processed dataset is empty;
- normalized duplicate keys remain;
- there are no selected-airport observations;
- no route satisfies the frozen 200-total/50-test eligibility rule; or
- the audit sample row count is incomplete.

Warnings are recorded for short temporal coverage, high raw rejection rates,
mixed sources, missing carriers, and the expected absence of ADRR flight numbers.
Warnings do not silently change the frozen benchmark.

## Benchmark artifacts

`benchmark/output/` contains the existing predictions, inventory, metrics,
calibration tables, reliability diagrams, and `benchmark_report.md`, plus:

- `run_manifest.json`: raw and mapping hashes, processed hash, frozen benchmark
  configuration, sanity/quality/audit locations, and generated artifact paths.

The manifest makes two runs comparable without committing restricted data. A
matching manifest does not license or redistribute the underlying ADRR records.
