# Historical aviation data sources

The project keeps three data categories separate:

| Category | Current source | Runtime role |
| --- | --- | --- |
| Open airport metadata | OurAirports | Airport identity and ADRR ICAO→IATA mapping |
| Access-controlled historical research data | EUROCONTROL ADRR | Historical arrival-behavior observations |
| Live operational data | None in the v0.4 playground | Out of scope |

## OurAirports — open airport metadata

**Name:** OurAirports `airports.csv`  
**Official source:** [OurAirports open-data downloads](https://ourairports.com/data/)  
**Format documentation:** [OurAirports data dictionary](https://ourairports.com/help/data-dictionary.html)  
**License / terms:** Public Domain; attribution is appreciated but not required.
The publisher provides no accuracy or fitness guarantee.  
**Purpose:** Normalize airport identity and generate the ICAO-to-IATA mapping
required by ADRR ingestion. It is not a source of connection or terminal-transfer
times.  
**Fields used:** `icao_code`, `iata_code`, `name`, `iso_country`, `iso_region`,
`latitude_deg`, `longitude_deg`, and optional `elevation_ft`.  
**Redistribution status:** Public-domain redistribution is permitted. This project
does not bundle the full frequently changing dump; developers download it locally.  
**Update process:** Download a fresh `airports.csv` from the official page, place it
at `data/public/airports.csv`, and regenerate the mapping:

```bash
connection-risk build-airport-mapping \
  --airports data/public/airports.csv \
  --output data/generated/airport_codes.csv
```

**Known limitations:** Some facilities lack IATA or ICAO codes; `ident` is not
always an ICAO code; community-maintained records can be stale or incorrect; and
the dataset does not provide defensible airport timezones or passenger-transfer
durations for this product. Missing IATA codes remain valid metadata records but
are omitted from the generated mapping. Conflicting duplicate ICAO codes fail
explicitly.

This is **OPEN DATA** and is architecturally isolated in
`connection_risk.airport_metadata` rather than coupled to raw CSV columns in the
risk engine.

## EUROCONTROL Aviation Data Repository for Research (ADRR)

This is **ACCESS-CONTROLLED RESEARCH DATA**, not open or live operational data.

**Name:** EUROCONTROL Aviation Data Repository for Research (ADRR), Flights file  
**Official source:** EUROCONTROL OneSky Online / ADRR  
**License / terms:** Separate ADRR Terms of Use; access-controlled and not covered
by this repository's MIT license.  
**Purpose:** Locally normalized historical arrival-behavior observations for the
delay-provider and reproducible benchmark.  
**Fields used:** `ADEP`, `ADES`, `FILED ARRIVAL TIME`, `ACTUAL ARRIVAL TIME`,
`AC Operator`, and `AC Type`; mappings are detailed below.  
**Redistribution status:** Raw and normalized flight records must remain local and
must not be committed or redistributed by this project.  
**Update process:** Developer-controlled download through OneSky, followed by the
strict `first-adrr-run` workflow. No runtime credential use or silent download.  
**Known limitations:** Flight-plan arrival is only a proxy for passenger schedule,
passenger flight number is absent, diversions can affect destination, coverage is
selected months, and ICAO airport codes require a separate mapping.

Source: [EUROCONTROL ADRR metadata](https://www.eurocontrol.int/sites/default/files/2025-04/eurocontrol-aviation-data-repository-research-metadata.pdf)  
Metadata version inspected: FNI Doc25 Data Description v7, April 2026  
Access terms: [ADRR Terms of Use, edition 11](https://www.eurocontrol.int/publication/eurocontrol-aviation-data-repository-research-terms-use)

ADRR is the first supported source adapter. The repository does not redistribute
ADRR records. Developers must obtain access directly from EUROCONTROL and comply
with its separate terms, including restrictions on sharing or redistributing the
data. The MIT license for `connection-risk` code does not license third-party data.

No licensed ADRR file was present while V0.2-B was implemented. The adapter uses
the field labels in the official metadata and validates the downloaded header
before processing. A mismatch fails explicitly; compare the first real file with
this document and update the adapter plus fixture rather than guessing or silently
renaming unfamiliar columns.

### Inspected Flights-file fields

The official metadata documents these relevant original fields:

| ADRR field | Meaning | Normalized field |
| --- | --- | --- |
| `ADEP` | Four-character ICAO departure airport | `origin`, after supplied ICAO→IATA mapping |
| `ADES` | Four-character ICAO actual destination; may reflect a diversion | `destination`, after supplied mapping |
| `FILED ARRIVAL TIME` | UTC arrival from the last filed flight plan | `scheduled_arrival` proxy |
| `ACTUAL ARRIVAL TIME` | Best available UTC landing time | `actual_arrival` |
| `AC Operator` | Three-character ICAO operator, or `ZZZ` | `carrier`; `ZZZ` becomes null |
| `AC Type` | ICAO aircraft type designator | `aircraft_type` |
| `ACTUAL OFF BLOCK TIME` | Actual or estimated UTC off-block time | not mapped |
| `ECTRL_ID` | Internal unique flight identifier | not mapped |

The adapter calculates `arrival_delay_minutes` as actual arrival minus filed
arrival, sets `observation_date` from the UTC filed arrival, and sets `source` to
`eurocontrol_adrr`.

### Missing fields and assumptions

- ADRR does not provide the passenger timetable flight number, so
  `flight_number` is null. Exact-flight matching is therefore unavailable.
- ADRR does not provide scheduled departure in the inspected Flights schema, so
  `scheduled_departure` is null. `ACTUAL OFF BLOCK TIME` is not substituted.
- `FILED ARRIVAL TIME` is not an airline scheduled arrival. Using it measures
  deviation from the last filed flight plan, not passenger timetable delay. The
  ingestion command requires `--accept-filed-arrival-proxy` so this assumption
  cannot be made silently.
- ADRR uses ICAO airport codes while the current engine uses IATA codes. Supply a
  separately licensed CSV with columns `icao_code,iata_code`. Unknown mappings
  are rejected and counted.
- Because `ADES` may be the actual diversion airport, diverted flights can differ
  from the originally planned route. The adapter does not invent the missing
  planned destination.
- ADRR covers four sample months—March, June, September and December—rather than
  continuous all-year traffic. A 365-day lookback may therefore contain sparse
  seasonal samples.

### Local normalization workflow

Install benchmark dependencies:

```bash
python -m pip install -e ".[dev,benchmark]"
```

Place the downloaded file and airport mapping locally, for example:

```text
data/raw/eurocontrol/flights.csv
data/raw/airport_codes.csv
```

For the first real benchmark, use the frozen one-command workflow documented in
[`first_adrr_run.md`](first_adrr_run.md):

```bash
connection-risk first-adrr-run \
  --raw-dataset data/raw/eurocontrol/flights.csv \
  --airport-mapping data/raw/airport_codes.csv \
  --normalized-dataset data/processed/adrr_flights.parquet \
  --output benchmark/output \
  --accept-filed-arrival-proxy
```

For ingestion without benchmarking, run:

```bash
connection-risk ingest-eurocontrol \
  --raw-dataset data/raw/eurocontrol/flights.csv \
  --airport-mapping data/raw/airport_codes.csv \
  --output data/processed/flights.parquet \
  --quality-report data/processed/flights.quality.json \
  --accept-filed-arrival-proxy
```

The command prints readable counts and writes machine-readable quality JSON.
Rows are rejected explicitly for missing/invalid times, invalid or unmapped
airports, invalid operators, schema failures, and delays outside -12 to +48
hours. Duplicate normalized observations are counted separately.

`data/raw/` and `data/processed/` are ignored by Git. Do not force-add ADRR or
other third-party datasets.

## OpenSky scientific datasets

Source inspected: [OpenSky Scientific Datasets](https://dev.opensky-network.org/data/scientific)

The public state-vector and derived flight datasets provide observed positions,
callsigns and inferred flight timing, but not airline scheduled arrival times.
They therefore cannot independently create the arrival-delay labels required by
this benchmark. No OpenSky adapter is implemented until a specific, documented
dataset with a defensible schedule join is selected.
