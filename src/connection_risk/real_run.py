"""Frozen, reproducible workflow for the first real EUROCONTROL ADRR run."""

from datetime import date
import hashlib
import json
from pathlib import Path
import platform
from typing import Sequence

import numpy as np
import pandas as pd
from pydantic import BaseModel, ConfigDict, Field

from .benchmarking import (
    BenchmarkConfig,
    RouteInventoryEntry,
    discover_routes,
    evaluate_benchmark,
    write_benchmark_outputs,
)
from . import __version__
from .ingestion.eurocontrol import ingest_eurocontrol_adrr, load_airport_mapping
from .ingestion.schema import IngestionStatistics
from .models import HistoricalFlightObservation
from .providers.historical_csv import HistoricalCsvDelayProvider

FIRST_ADRR_BENCHMARK_CONFIG = BenchmarkConfig(
    airports=("BER", "FRA", "AMS", "BUD"),
    thresholds=(15.0, 30.0, 60.0),
    lookback_days=365,
    min_samples=30,
    route_min_total=200,
    route_min_test=50,
    test_fraction=0.2,
)


class PreBenchmarkSanityReport(BaseModel):
    model_config = ConfigDict(frozen=True)

    dataset_file: str
    dataset_sha256: str
    observation_count: int = Field(ge=0)
    date_start: date | None
    date_end: date | None
    temporal_span_days: int = Field(ge=0)
    source_counts: dict[str, int]
    carrier_missing_count: int = Field(ge=0)
    carrier_missing_fraction: float = Field(ge=0, le=1)
    flight_number_missing_count: int = Field(ge=0)
    flight_number_missing_fraction: float = Field(ge=0, le=1)
    selected_airport_observations: int = Field(ge=0)
    route_count: int = Field(ge=0)
    eligible_route_count: int = Field(ge=0)
    eligible_target_count: int = Field(ge=0)
    delay_statistics: dict[str, float]
    route_inventory: list[RouteInventoryEntry]
    ingestion_statistics: IngestionStatistics | None
    audit_sample_rows: int = Field(ge=0)
    critical_issues: list[str]
    warnings: list[str]
    ready_for_benchmark: bool


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def build_prebenchmark_sanity_report(
    dataset_path: str | Path,
    observations: Sequence[HistoricalFlightObservation],
    *,
    ingestion_statistics: IngestionStatistics | None = None,
    audit_sample_rows: int = 0,
    audit_validation_issues: Sequence[str] = (),
) -> PreBenchmarkSanityReport:
    """Validate processed data before any benchmark artifacts are generated."""
    dataset = Path(dataset_path)
    if not dataset.is_file():
        raise FileNotFoundError(f"normalized dataset not found: {dataset}")
    count = len(observations)
    dates = [item.observation_date for item in observations]
    date_start = min(dates) if dates else None
    date_end = max(dates) if dates else None
    span_days = (date_end - date_start).days if date_start and date_end else 0
    source_counts: dict[str, int] = {}
    for item in observations:
        source_counts[item.source] = source_counts.get(item.source, 0) + 1
    carrier_missing = sum(item.carrier is None for item in observations)
    flight_missing = sum(item.flight_number is None for item in observations)
    selected = set(FIRST_ADRR_BENCHMARK_CONFIG.airports)
    selected_observations = [
        item
        for item in observations
        if item.origin in selected and item.destination in selected
    ]
    inventory, targets = discover_routes(
        observations, FIRST_ADRR_BENCHMARK_CONFIG
    )
    eligible_routes = sum(item.eligible for item in inventory)
    delays = np.asarray(
        [item.arrival_delay_minutes for item in observations], dtype=np.float64
    )
    delay_statistics = (
        {
            "min": float(np.min(delays)),
            "mean": float(np.mean(delays)),
            "median": float(np.median(delays)),
            "p90": float(np.quantile(delays, 0.90)),
            "p95": float(np.quantile(delays, 0.95)),
            "max": float(np.max(delays)),
        }
        if delays.size
        else {}
    )
    duplicate_keys = set()
    seen = set()
    for item in observations:
        key = (
            item.flight_number,
            item.carrier,
            item.origin,
            item.destination,
            item.scheduled_arrival,
            item.actual_arrival,
        )
        if key in seen:
            duplicate_keys.add(key)
        seen.add(key)

    critical: list[str] = []
    warnings: list[str] = []
    if count == 0:
        critical.append("normalized dataset contains no observations")
    if duplicate_keys:
        critical.append(
            f"normalized dataset still contains {len(duplicate_keys)} duplicate keys"
        )
    if not selected_observations:
        critical.append("no observations connect the frozen BER/FRA/AMS/BUD airport set")
    if eligible_routes == 0:
        critical.append(
            "no route meets the frozen requirements of 200 total and 50 test observations"
        )
    if audit_sample_rows != min(50, count):
        critical.append(
            f"audit sample has {audit_sample_rows} rows; expected {min(50, count)}"
        )
    critical.extend(audit_validation_issues)
    if span_days < FIRST_ADRR_BENCHMARK_CONFIG.lookback_days:
        warnings.append(
            f"dataset spans only {span_days} days, shorter than the frozen 365-day lookback"
        )
    if source_counts and set(source_counts) != {"eurocontrol_adrr"}:
        warnings.append(
            "normalized dataset contains sources other than eurocontrol_adrr"
        )
    if ingestion_statistics and ingestion_statistics.rows_read:
        rejection_fraction = (
            ingestion_statistics.rows_rejected / ingestion_statistics.rows_read
        )
        if rejection_fraction > 0.10:
            warnings.append(
                f"ingestion rejected {rejection_fraction:.1%} of raw rows"
            )
    if carrier_missing:
        warnings.append(
            f"carrier is missing for {carrier_missing / count:.1%} of observations"
            if count
            else "carrier availability cannot be assessed"
        )
    if flight_missing == count and count:
        warnings.append(
            "flight_number is absent for all observations; exact-flight matching is unavailable"
        )
    return PreBenchmarkSanityReport(
        dataset_file=dataset.name,
        dataset_sha256=_file_sha256(dataset),
        observation_count=count,
        date_start=date_start,
        date_end=date_end,
        temporal_span_days=span_days,
        source_counts=source_counts,
        carrier_missing_count=carrier_missing,
        carrier_missing_fraction=carrier_missing / count if count else 0.0,
        flight_number_missing_count=flight_missing,
        flight_number_missing_fraction=flight_missing / count if count else 0.0,
        selected_airport_observations=len(selected_observations),
        route_count=len(inventory),
        eligible_route_count=eligible_routes,
        eligible_target_count=len(targets),
        delay_statistics=delay_statistics,
        route_inventory=inventory,
        ingestion_statistics=ingestion_statistics,
        audit_sample_rows=audit_sample_rows,
        critical_issues=critical,
        warnings=warnings,
        ready_for_benchmark=not critical,
    )


def validate_raw_normalized_audit(
    audit_path: str | Path, airport_mapping: str | Path
) -> list[str]:
    """Recalculate the sampled transformations before allowing a benchmark."""
    audit = pd.read_csv(audit_path, dtype=object)
    mapping = load_airport_mapping(airport_mapping)
    required = {
        "raw_ADEP",
        "raw_ADES",
        "raw_FILED_ARRIVAL_TIME",
        "raw_ACTUAL_ARRIVAL_TIME",
        "normalized_origin",
        "normalized_destination",
        "normalized_scheduled_arrival",
        "normalized_actual_arrival",
        "normalized_arrival_delay_minutes",
    }
    missing = required.difference(audit.columns)
    if missing:
        return [f"audit sample is missing columns: {', '.join(sorted(missing))}"]
    issues: list[str] = []
    for index, row in audit.iterrows():
        label = f"audit row {index + 2}"
        origin_icao = str(row["raw_ADEP"]).strip().upper()
        destination_icao = str(row["raw_ADES"]).strip().upper()
        if mapping.get(origin_icao) != str(row["normalized_origin"]).strip().upper():
            issues.append(f"{label}: origin mapping does not match")
        if mapping.get(destination_icao) != str(row["normalized_destination"]).strip().upper():
            issues.append(f"{label}: destination mapping does not match")
        try:
            raw_scheduled = pd.to_datetime(
                row["raw_FILED_ARRIVAL_TIME"], utc=True, errors="raise"
            )
            raw_actual = pd.to_datetime(
                row["raw_ACTUAL_ARRIVAL_TIME"], utc=True, errors="raise"
            )
            normalized_scheduled = pd.to_datetime(
                row["normalized_scheduled_arrival"], utc=True, errors="raise"
            )
            normalized_actual = pd.to_datetime(
                row["normalized_actual_arrival"], utc=True, errors="raise"
            )
        except (TypeError, ValueError) as exc:
            issues.append(f"{label}: timestamp audit could not be parsed ({exc})")
            continue
        if raw_scheduled != normalized_scheduled:
            issues.append(f"{label}: filed arrival normalization does not match")
        if raw_actual != normalized_actual:
            issues.append(f"{label}: actual arrival normalization does not match")
        expected_delay = (raw_actual - raw_scheduled).total_seconds() / 60.0
        try:
            normalized_delay = float(row["normalized_arrival_delay_minutes"])
        except (TypeError, ValueError):
            issues.append(f"{label}: normalized delay is not numeric")
            continue
        if abs(expected_delay - normalized_delay) > 1e-9:
            issues.append(f"{label}: normalized delay calculation does not match")
    return issues[:100]


def format_sanity_report(report: PreBenchmarkSanityReport) -> str:
    lines = [
        "Pre-Benchmark Data Sanity Report",
        "================================",
        f"Dataset:                    {report.dataset_file}",
        f"SHA-256:                    {report.dataset_sha256}",
        f"Observations:               {report.observation_count:,}",
        f"Date range:                 {report.date_start} to {report.date_end}",
        f"Temporal span:              {report.temporal_span_days:,} days",
        f"Selected-airport rows:      {report.selected_airport_observations:,}",
        f"Routes discovered:          {report.route_count:,}",
        f"Eligible routes:            {report.eligible_route_count:,}",
        f"Eligible benchmark targets: {report.eligible_target_count:,}",
        f"Audit rows:                 {report.audit_sample_rows:,}",
        f"Ready for benchmark:        {report.ready_for_benchmark}",
    ]
    if report.critical_issues:
        lines.append("Critical issues:")
        lines.extend(f"  - {item}" for item in report.critical_issues)
    if report.warnings:
        lines.append("Warnings:")
        lines.extend(f"  - {item}" for item in report.warnings)
    return "\n".join(lines)


def write_sanity_report(
    report: PreBenchmarkSanityReport,
    json_path: str | Path,
    markdown_path: str | Path,
) -> None:
    json_destination = Path(json_path)
    markdown_destination = Path(markdown_path)
    json_destination.parent.mkdir(parents=True, exist_ok=True)
    markdown_destination.parent.mkdir(parents=True, exist_ok=True)
    json_destination.write_text(
        json.dumps(report.model_dump(mode="json"), indent=2, sort_keys=True),
        encoding="utf-8",
    )
    route_lines = [
        "| Route | Observations | Test observations | Eligible |",
        "| --- | ---: | ---: | --- |",
    ]
    route_lines.extend(
        f"| {item.origin}->{item.destination} | {item.observation_count} | "
        f"{item.test_observation_count} | {item.eligible} |"
        for item in report.route_inventory
    )
    markdown_destination.write_text(
        "# Pre-Benchmark Data Sanity Report\n\n"
        + "```text\n"
        + format_sanity_report(report)
        + "\n```\n\n## Route inventory\n\n"
        + "\n".join(route_lines)
        + "\n",
        encoding="utf-8",
    )


def run_first_adrr_workflow(
    raw_dataset: str | Path,
    airport_mapping: str | Path,
    *,
    normalized_dataset: str | Path = "data/processed/adrr_flights.parquet",
    benchmark_output: str | Path = "benchmark/output",
    accept_filed_arrival_proxy: bool = False,
) -> dict[str, object]:
    """Run strict inspection → normalization → sanity gate → frozen benchmark."""
    normalized = Path(normalized_dataset)
    benchmark_directory = Path(benchmark_output)
    schema_path = normalized.with_suffix(".schema.json")
    quality_path = normalized.with_suffix(".quality.json")
    audit_path = normalized.with_suffix(".audit.csv")
    statistics = ingest_eurocontrol_adrr(
        raw_dataset,
        normalized,
        airport_mapping=airport_mapping,
        schema_report_path=schema_path,
        quality_report_path=quality_path,
        audit_sample_path=audit_path,
        audit_sample_size=50,
        accept_filed_arrival_proxy=accept_filed_arrival_proxy,
    )
    provider = HistoricalCsvDelayProvider(
        normalized,
        min_samples=1,
        lookback_days=FIRST_ADRR_BENCHMARK_CONFIG.lookback_days,
        strict=True,
    )
    observations = list(provider.observations)
    audit_rows = len(pd.read_csv(audit_path))
    audit_issues = validate_raw_normalized_audit(audit_path, airport_mapping)
    sanity = build_prebenchmark_sanity_report(
        normalized,
        observations,
        ingestion_statistics=statistics,
        audit_sample_rows=audit_rows,
        audit_validation_issues=audit_issues,
    )
    sanity_json = normalized.with_suffix(".sanity.json")
    sanity_markdown = normalized.with_suffix(".sanity.md")
    write_sanity_report(sanity, sanity_json, sanity_markdown)
    if not sanity.ready_for_benchmark:
        raise ValueError(
            "pre-benchmark sanity checks failed: "
            + "; ".join(sanity.critical_issues)
        )

    result = evaluate_benchmark(observations, FIRST_ADRR_BENCHMARK_CONFIG)
    paths = write_benchmark_outputs(
        result,
        observations,
        benchmark_directory,
        quality=statistics.model_dump(mode="json"),
    )
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    manifest = {
        "workflow": "connection-risk-first-adrr-benchmark-v1",
        "software": {
            "connection_risk_version": __version__,
            "python_version": platform.python_version(),
            "numpy_version": np.__version__,
            "pandas_version": pd.__version__,
        },
        "raw_dataset": {
            "file_name": Path(raw_dataset).name,
            "sha256": schema["sha256"],
            "schema_report": str(schema_path),
        },
        "airport_mapping": {
            "file_name": Path(airport_mapping).name,
            "sha256": _file_sha256(Path(airport_mapping)),
        },
        "normalized_dataset": {
            "path": str(normalized),
            "sha256": sanity.dataset_sha256,
        },
        "frozen_benchmark_config": result.config,
        "quality_report": str(quality_path),
        "audit_sample": str(audit_path),
        "sanity_report_json": str(sanity_json),
        "sanity_report_markdown": str(sanity_markdown),
        "benchmark_artifacts": {key: str(value) for key, value in paths.items()},
    }
    manifest_path = benchmark_directory / "run_manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8"
    )
    return {"manifest": manifest, "manifest_path": manifest_path, "sanity": sanity}
