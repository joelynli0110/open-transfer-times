"""EUROCONTROL ADRR flight-file normalization.

The ADRR flight file contains ICAO airport codes and *filed* rather than
passenger-timetable arrival times.  Callers must supply an ICAO-to-IATA mapping
and explicitly accept that proxy; the adapter never silently invents either.
"""

from collections import Counter
import csv
from datetime import UTC, datetime
import hashlib
import heapq
import json
from pathlib import Path
import re
from typing import Mapping

import pandas as pd
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from ..models import HistoricalFlightObservation
from .normalization import normalize_airport_code, normalize_carrier
from .schema import IngestionStatistics

ADRR_REQUIRED_COLUMNS = {
    "ADEP",
    "ADES",
    "FILED ARRIVAL TIME",
    "ACTUAL ARRIVAL TIME",
}
ADRR_OPTIONAL_COLUMNS = {
    "ECTRL_ID",
    "ACTUAL OFF BLOCK TIME",
    "AC Operator",
    "AC Type",
    "AC Registration",
    "ICAO Flight Type",
}
CANONICAL_COLUMNS = [
    "flight_number",
    "carrier",
    "origin",
    "destination",
    "scheduled_departure",
    "scheduled_arrival",
    "actual_arrival",
    "arrival_delay_minutes",
    "observation_date",
    "source",
    "aircraft_type",
    "terminal",
]


class AdrrSchemaInspection(BaseModel):
    """Machine-readable result of inspecting an actual ADRR file."""

    model_config = ConfigDict(frozen=True)

    file_name: str
    file_size_bytes: int = Field(ge=0)
    sha256: str
    encoding: str
    delimiter: str
    columns: list[str]
    required_columns: list[str]
    missing_required_columns: list[str]
    recognized_optional_columns: list[str]
    additional_columns: list[str]
    duplicate_columns: list[str]
    empty_columns: list[int]
    sampled_rows: int = Field(ge=0)
    sampled_time_parse_failures: dict[str, int]
    compatible: bool


class AdrrSchemaError(ValueError):
    """Raised before ingestion when a real file does not match the contract."""


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _detect_text_format(path: Path) -> tuple[str, str, list[str]]:
    sample_bytes = path.read_bytes()[:256_000]
    if not sample_bytes:
        raise AdrrSchemaError("ADRR file is empty")
    decoded = None
    encoding = ""
    for candidate in ("utf-8-sig", "utf-8", "cp1252"):
        try:
            decoded = sample_bytes.decode(candidate)
            encoding = candidate
            break
        except UnicodeDecodeError:
            continue
    if decoded is None:
        raise AdrrSchemaError("ADRR header is not valid UTF-8 or Windows-1252 text")
    first_lines = "\n".join(decoded.splitlines()[:20])
    try:
        dialect = csv.Sniffer().sniff(first_lines, delimiters=",;\t|")
    except csv.Error as exc:
        raise AdrrSchemaError("could not determine ADRR field delimiter") from exc
    reader = csv.reader(decoded.splitlines(), delimiter=dialect.delimiter)
    try:
        columns = next(reader)
    except StopIteration as exc:
        raise AdrrSchemaError("ADRR file has no header") from exc
    return encoding, dialect.delimiter, columns


def inspect_adrr_schema(
    raw_csv: str | Path,
    *,
    report_path: str | Path | None = None,
    sample_rows: int = 500,
    raise_on_incompatible: bool = True,
) -> AdrrSchemaInspection:
    """Inspect delimiter, encoding and exact metadata field names before reading."""
    if sample_rows < 1:
        raise ValueError("sample_rows must be positive")
    path = Path(raw_csv)
    if not path.is_file():
        raise FileNotFoundError(f"ADRR flight file not found: {path}")
    encoding, delimiter, columns = _detect_text_format(path)
    counts = Counter(columns)
    duplicates = sorted(column for column, count in counts.items() if count > 1)
    empty_columns = [index for index, column in enumerate(columns) if not column]
    missing = sorted(ADRR_REQUIRED_COLUMNS.difference(columns))
    whitespace_changed = [column for column in columns if column != column.strip()]

    sampled = pd.read_csv(
        path,
        dtype=object,
        sep=delimiter,
        encoding=encoding,
        nrows=sample_rows,
    )
    parse_failures: dict[str, int] = {}
    for field in ("FILED ARRIVAL TIME", "ACTUAL ARRIVAL TIME"):
        if field not in sampled.columns:
            continue
        present = sampled[field].notna() & sampled[field].astype(str).str.strip().ne("")
        parsed = pd.to_datetime(
            sampled.loc[present, field], utc=True, errors="coerce", dayfirst=True
        )
        parse_failures[field] = int(parsed.isna().sum())
    compatible = not (missing or duplicates or empty_columns or whitespace_changed)
    inspection = AdrrSchemaInspection(
        file_name=path.name,
        file_size_bytes=path.stat().st_size,
        sha256=_sha256_file(path),
        encoding=encoding,
        delimiter=delimiter,
        columns=columns,
        required_columns=sorted(ADRR_REQUIRED_COLUMNS),
        missing_required_columns=missing,
        recognized_optional_columns=sorted(ADRR_OPTIONAL_COLUMNS.intersection(columns)),
        additional_columns=sorted(
            set(columns).difference(ADRR_REQUIRED_COLUMNS, ADRR_OPTIONAL_COLUMNS)
        ),
        duplicate_columns=duplicates,
        empty_columns=empty_columns,
        sampled_rows=len(sampled),
        sampled_time_parse_failures=parse_failures,
        compatible=compatible,
    )
    if report_path:
        destination = Path(report_path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(
            json.dumps(inspection.model_dump(mode="json"), indent=2),
            encoding="utf-8",
        )
    if raise_on_incompatible and not compatible:
        details = []
        if missing:
            details.append(f"missing required columns: {', '.join(missing)}")
        if duplicates:
            details.append(f"duplicate columns: {', '.join(duplicates)}")
        if empty_columns:
            details.append(f"empty header positions: {empty_columns}")
        if whitespace_changed:
            details.append("header fields contain leading/trailing whitespace")
        raise AdrrSchemaError("ADRR schema is incompatible (" + "; ".join(details) + ")")
    return inspection


def format_schema_inspection(inspection: AdrrSchemaInspection) -> str:
    delimiter = "\\t" if inspection.delimiter == "\t" else inspection.delimiter
    return "\n".join(
        [
            f"File:                {inspection.file_name}",
            f"Size:                {inspection.file_size_bytes:,} bytes",
            f"SHA-256:             {inspection.sha256}",
            f"Encoding:            {inspection.encoding}",
            f"Delimiter:           {delimiter!r}",
            f"Columns:             {len(inspection.columns)}",
            f"Sampled rows:        {inspection.sampled_rows:,}",
            f"Schema compatible:   {inspection.compatible}",
        ]
    )


def load_airport_mapping(path: str | Path) -> dict[str, str]:
    """Load a two-column ``icao_code,iata_code`` airport mapping."""
    frame = pd.read_csv(path, dtype=object)
    required = {"icao_code", "iata_code"}
    missing = required.difference(frame.columns)
    if missing:
        raise ValueError(
            f"airport mapping is missing columns: {', '.join(sorted(missing))}"
        )
    mapping: dict[str, str] = {}
    for row in frame.to_dict(orient="records"):
        icao = str(row["icao_code"]).strip().upper()
        if not re.fullmatch(r"[A-Z0-9]{4}", icao) or icao == "ZZZZ":
            raise ValueError(f"invalid ICAO airport code in mapping: {icao!r}")
        iata = normalize_airport_code(row["iata_code"])
        if icao in mapping and mapping[icao] != iata:
            raise ValueError(f"conflicting IATA mappings for {icao}")
        mapping[icao] = iata
    return mapping


def _parse_utc(value: object, missing_reason: str, invalid_reason: str) -> datetime:
    if pd.isna(value) or str(value).strip() == "":
        raise _RowRejected(missing_reason)
    try:
        text = str(value).strip()
        # Official ADRR extracts use day-month-year wall-clock strings such as
        # 01-03-2015 08:18:23. Parsing them with pandas' month-first default
        # silently turns 1 March into 3 January, so recognize that format first.
        if re.fullmatch(r"\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}(?:\.\d+)?", text):
            format_string = "%d-%m-%Y %H:%M:%S.%f" if "." in text else "%d-%m-%Y %H:%M:%S"
            return datetime.strptime(text, format_string).replace(tzinfo=UTC)
        parsed = pd.to_datetime(text, utc=True, errors="raise")
    except (TypeError, ValueError) as exc:
        raise _RowRejected(invalid_reason) from exc
    return parsed.to_pydatetime()


class _RowRejected(ValueError):
    pass


def _normalize_row(
    row: Mapping[str, object], airport_mapping: Mapping[str, str], source: str
) -> HistoricalFlightObservation:
    origin_icao = str(row.get("ADEP", "")).strip().upper()
    destination_icao = str(row.get("ADES", "")).strip().upper()
    if not re.fullmatch(r"[A-Z0-9]{4}", origin_icao) or origin_icao == "ZZZZ":
        raise _RowRejected("invalid_origin_icao")
    if not re.fullmatch(r"[A-Z0-9]{4}", destination_icao) or destination_icao == "ZZZZ":
        raise _RowRejected("invalid_destination_icao")
    if origin_icao not in airport_mapping:
        raise _RowRejected("unmapped_origin_icao")
    if destination_icao not in airport_mapping:
        raise _RowRejected("unmapped_destination_icao")

    scheduled_arrival = _parse_utc(
        row.get("FILED ARRIVAL TIME"),
        "missing_filed_arrival",
        "invalid_filed_arrival",
    )
    actual_arrival = _parse_utc(
        row.get("ACTUAL ARRIVAL TIME"),
        "missing_actual_arrival",
        "invalid_actual_arrival",
    )
    delay = (actual_arrival - scheduled_arrival).total_seconds() / 60.0
    if delay < -720 or delay > 2880:
        raise _RowRejected("extreme_delay")

    raw_operator = row.get("AC Operator")
    carrier = None
    if not pd.isna(raw_operator) and str(raw_operator).strip().upper() not in {"", "ZZZ"}:
        try:
            carrier = normalize_carrier(raw_operator)
        except ValueError as exc:
            raise _RowRejected("invalid_operator") from exc
    raw_aircraft = row.get("AC Type")
    aircraft_type = (
        None
        if pd.isna(raw_aircraft) or str(raw_aircraft).strip() == ""
        else str(raw_aircraft).strip().upper()
    )
    try:
        return HistoricalFlightObservation(
            flight_number=None,
            carrier=carrier,
            origin=airport_mapping[origin_icao],
            destination=airport_mapping[destination_icao],
            scheduled_departure=None,
            scheduled_arrival=scheduled_arrival,
            actual_arrival=actual_arrival,
            arrival_delay_minutes=delay,
            observation_date=scheduled_arrival.date(),
            source=source,
            aircraft_type=aircraft_type,
            terminal=None,
        )
    except (ValueError, ValidationError) as exc:
        raise _RowRejected("schema_validation") from exc


def format_ingestion_statistics(statistics: IngestionStatistics) -> str:
    lines = [
        f"Rows read:           {statistics.rows_read:,}",
        f"Valid observations:  {statistics.rows_valid:,}",
        f"Rejected:            {statistics.rows_rejected:,}",
        f"Duplicates removed:  {statistics.duplicates_removed:,}",
    ]
    if statistics.rejection_reason_counts:
        lines.append("Rejected reasons:")
        for reason, count in sorted(
            statistics.rejection_reason_counts.items(),
            key=lambda item: (-item[1], item[0]),
        ):
            lines.append(f"  {reason:28} {count:,}")
    return "\n".join(lines)


def ingest_eurocontrol_adrr(
    raw_csv: str | Path,
    output_path: str | Path,
    *,
    airport_mapping: Mapping[str, str] | str | Path,
    quality_report_path: str | Path | None = None,
    schema_report_path: str | Path | None = None,
    audit_sample_path: str | Path | None = None,
    audit_sample_size: int = 50,
    accept_filed_arrival_proxy: bool = False,
    chunksize: int = 100_000,
    source: str = "eurocontrol_adrr",
) -> IngestionStatistics:
    """Normalize an ADRR Flights CSV into canonical CSV or Parquet records.

    ``FILED ARRIVAL TIME`` is not an airline timetable arrival.  The explicit
    acknowledgement prevents accidentally presenting plan deviation as a
    passenger schedule delay benchmark.
    """
    if not accept_filed_arrival_proxy:
        raise ValueError(
            "ADRR provides FILED ARRIVAL TIME, not passenger scheduled arrival; "
            "set accept_filed_arrival_proxy=True after reviewing docs/data_sources.md"
        )
    if chunksize < 1:
        raise ValueError("chunksize must be positive")
    if audit_sample_size < 1:
        raise ValueError("audit_sample_size must be positive")
    if isinstance(airport_mapping, (str, Path)):
        mapping = load_airport_mapping(airport_mapping)
    else:
        mapping = {}
        for key, value in airport_mapping.items():
            icao = str(key).strip().upper()
            if not re.fullmatch(r"[A-Z0-9]{4}", icao) or icao == "ZZZZ":
                raise ValueError(f"invalid ICAO airport code in mapping: {icao!r}")
            mapping[icao] = normalize_airport_code(value)
    raw_path = Path(raw_csv)
    output = Path(output_path)
    if not raw_path.is_file():
        raise FileNotFoundError(f"ADRR flight file not found: {raw_path}")
    if output.suffix.lower() not in {".csv", ".parquet"}:
        raise ValueError("normalized output must use .csv or .parquet")
    output.parent.mkdir(parents=True, exist_ok=True)
    schema_destination = (
        Path(schema_report_path)
        if schema_report_path
        else output.with_suffix(".schema.json")
    )
    inspection = inspect_adrr_schema(raw_path, report_path=schema_destination)
    if output.exists():
        output.unlink()

    rows_read = 0
    valid_count = 0
    duplicate_count = 0
    reasons: Counter[str] = Counter()
    reason_examples: list[str] = []
    seen: set[tuple[object, ...]] = set()
    wrote_csv_header = False
    parquet_writer = None
    audit_heap: list[tuple[int, int, dict[str, object]]] = []
    try:
        for chunk in pd.read_csv(
            raw_path,
            dtype=object,
            chunksize=chunksize,
            sep=inspection.delimiter,
            encoding=inspection.encoding,
        ):
            normalized: list[dict[str, object]] = []
            for row in chunk.to_dict(orient="records"):
                rows_read += 1
                try:
                    observation = _normalize_row(row, mapping, source)
                except _RowRejected as exc:
                    reason = str(exc)
                    reasons[reason] += 1
                    if len(reason_examples) < 100:
                        reason_examples.append(f"row {rows_read + 1}: {reason}")
                    continue
                key = (
                    observation.flight_number,
                    observation.carrier,
                    observation.origin,
                    observation.destination,
                    observation.scheduled_arrival,
                    observation.actual_arrival,
                )
                if key in seen:
                    duplicate_count += 1
                    continue
                seen.add(key)
                normalized_record = observation.model_dump()
                normalized.append(normalized_record)
                audit_raw_fields = {
                    "raw_row_number": rows_read + 1,
                    "raw_ECTRL_ID": row.get("ECTRL_ID"),
                    "raw_ADEP": row.get("ADEP"),
                    "raw_ADES": row.get("ADES"),
                    "raw_FILED_ARRIVAL_TIME": row.get("FILED ARRIVAL TIME"),
                    "raw_ACTUAL_ARRIVAL_TIME": row.get("ACTUAL ARRIVAL TIME"),
                    "raw_AC_Operator": row.get("AC Operator"),
                    "raw_AC_Type": row.get("AC Type"),
                }
                normalized_audit = {
                    f"normalized_{name}": value
                    for name, value in observation.model_dump(mode="json").items()
                }
                audit_record = {**audit_raw_fields, **normalized_audit}
                audit_identity = json.dumps(
                    audit_raw_fields, sort_keys=True, default=str
                ).encode("utf-8")
                priority = int.from_bytes(
                    hashlib.sha256(audit_identity).digest(), "big"
                )
                heap_entry = (-priority, rows_read, audit_record)
                if len(audit_heap) < audit_sample_size:
                    heapq.heappush(audit_heap, heap_entry)
                elif priority < -audit_heap[0][0]:
                    heapq.heapreplace(audit_heap, heap_entry)
            if not normalized:
                continue
            valid_count += len(normalized)
            normalized_frame = pd.DataFrame(normalized, columns=CANONICAL_COLUMNS)
            if output.suffix.lower() == ".csv":
                normalized_frame.to_csv(
                    output,
                    mode="a" if wrote_csv_header else "w",
                    header=not wrote_csv_header,
                    index=False,
                )
                wrote_csv_header = True
            else:
                try:
                    import pyarrow as pa
                    import pyarrow.parquet as pq
                except ImportError as exc:
                    raise RuntimeError(
                        "Parquet output requires the 'benchmark' optional dependencies"
                    ) from exc
                table = pa.Table.from_pandas(normalized_frame, preserve_index=False)
                if parquet_writer is None:
                    parquet_writer = pq.ParquetWriter(output, table.schema)
                parquet_writer.write_table(table)
    finally:
        if parquet_writer is not None:
            parquet_writer.close()

    statistics = IngestionStatistics(
        rows_read=rows_read,
        rows_valid=valid_count,
        rows_rejected=sum(reasons.values()),
        duplicates_removed=duplicate_count,
        rejection_reasons=reason_examples,
        rejection_reason_counts=dict(reasons),
    )
    report_path = Path(quality_report_path) if quality_report_path else output.with_suffix(".quality.json")
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(
        json.dumps(statistics.model_dump(mode="json"), indent=2), encoding="utf-8"
    )
    if valid_count == 0:
        raise ValueError("ADRR ingestion produced no valid observations")
    audit_destination = (
        Path(audit_sample_path)
        if audit_sample_path
        else output.with_suffix(".audit.csv")
    )
    audit_destination.parent.mkdir(parents=True, exist_ok=True)
    audit_records = [
        item[2] for item in sorted(audit_heap, key=lambda item: (-item[0], item[1]))
    ]
    pd.DataFrame(audit_records).to_csv(audit_destination, index=False)
    return statistics
