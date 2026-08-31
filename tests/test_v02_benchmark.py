from datetime import UTC, datetime, timedelta
import json

import pandas as pd
import pytest

from connection_risk.benchmarking import (
    BenchmarkConfig,
    brier_skill_score,
    discover_routes,
    evaluate_benchmark,
    expected_calibration_error,
    generate_benchmark_report,
    run_lookback_experiment,
    run_sample_size_experiment,
    write_benchmark_outputs,
)
from connection_risk.ingestion.eurocontrol import (
    AdrrSchemaError,
    ingest_eurocontrol_adrr,
    inspect_adrr_schema,
)
from connection_risk.models import HistoricalFlightObservation
from connection_risk.providers.historical_csv import HistoricalCsvDelayProvider
from connection_risk.real_run import (
    FIRST_ADRR_BENCHMARK_CONFIG,
    build_prebenchmark_sanity_report,
    run_first_adrr_workflow,
    validate_raw_normalized_audit,
)


BASE = datetime(2024, 1, 1, 12, tzinfo=UTC)


def observation(
    index: int,
    *,
    origin: str = "BER",
    destination: str = "FRA",
    carrier: str = "DLH",
    flight: str | None = None,
    delay: float | None = None,
) -> HistoricalFlightObservation:
    scheduled = BASE + timedelta(days=index)
    delay_value = float((index % 5) * 20 if delay is None else delay)
    return HistoricalFlightObservation(
        flight_number=flight,
        carrier=carrier,
        origin=origin,
        destination=destination,
        scheduled_departure=scheduled - timedelta(hours=1),
        scheduled_arrival=scheduled,
        actual_arrival=scheduled + timedelta(minutes=delay_value),
        arrival_delay_minutes=delay_value,
        observation_date=scheduled.date(),
        source="synthetic-benchmark-fixture",
    )


def benchmark_observations():
    rows = [observation(index) for index in range(12)]
    rows += [
        observation(
            index,
            origin="AMS",
            destination="BUD",
            carrier="KLM" if index % 2 else "WZZ",
        )
        for index in range(12)
    ]
    rows += [
        observation(index, origin="CDG", destination="BER", carrier="AFR")
        for index in range(12)
    ]
    return rows


def benchmark_config(**overrides):
    values = {
        "airports": ("BER", "FRA", "AMS", "BUD"),
        "lookback_days": 365,
        "min_samples": 3,
        "route_min_total": 8,
        "route_min_test": 3,
        "test_fraction": 0.2,
    }
    values.update(overrides)
    return BenchmarkConfig(**values)


def test_eurocontrol_parser_normalization_and_quality_report(tmp_path):
    valid = {
        "ECTRL_ID": "1",
        "ADEP": "EDDB",
        "ADES": "EDDF",
        "FILED ARRIVAL TIME": "2025-03-01T10:00:00Z",
        "ACTUAL ARRIVAL TIME": "2025-03-01T10:25:00Z",
        "AC Operator": "DLH",
        "AC Type": "A320",
    }
    missing_actual = {**valid, "ECTRL_ID": "2", "ACTUAL ARRIVAL TIME": ""}
    unmapped = {**valid, "ECTRL_ID": "3", "ADES": "LFPG"}
    raw = tmp_path / "adrr.csv"
    pd.DataFrame([valid, valid, missing_actual, unmapped]).to_csv(raw, index=False)
    mapping = tmp_path / "airports.csv"
    pd.DataFrame(
        [{"icao_code": "EDDB", "iata_code": "BER"}, {"icao_code": "EDDF", "iata_code": "FRA"}]
    ).to_csv(mapping, index=False)
    output = tmp_path / "normalized.csv"
    quality = tmp_path / "quality.json"

    statistics = ingest_eurocontrol_adrr(
        raw,
        output,
        airport_mapping=mapping,
        quality_report_path=quality,
        accept_filed_arrival_proxy=True,
        chunksize=2,
    )

    assert statistics.rows_read == 4
    assert statistics.rows_valid == 1
    assert statistics.rows_rejected == 2
    assert statistics.duplicates_removed == 1
    assert statistics.rejection_reason_counts == {
        "missing_actual_arrival": 1,
        "unmapped_destination_icao": 1,
    }
    assert json.loads(quality.read_text(encoding="utf-8"))["rows_valid"] == 1
    provider = HistoricalCsvDelayProvider(output, min_samples=1)
    item = provider.observations[0]
    assert (item.origin, item.destination, item.carrier) == ("BER", "FRA", "DLH")
    assert item.flight_number is None
    assert item.scheduled_departure is None
    assert item.arrival_delay_minutes == 25


def test_eurocontrol_parser_requires_proxy_acknowledgement(tmp_path):
    raw = tmp_path / "raw.csv"
    raw.write_text("ADEP,ADES,FILED ARRIVAL TIME,ACTUAL ARRIVAL TIME\n", encoding="utf-8")
    with pytest.raises(ValueError, match="FILED ARRIVAL TIME"):
        ingest_eurocontrol_adrr(raw, tmp_path / "out.csv", airport_mapping={})


def test_eurocontrol_parser_uses_adrr_day_month_year_order(tmp_path):
    raw = tmp_path / "Flights_extract.csv"
    pd.DataFrame(
        [
            {
                "ADEP": "LFPG",
                "ADES": "LEMG",
                "FILED ARRIVAL TIME": "01-03-2015 08:18:23",
                "ACTUAL ARRIVAL TIME": "01-03-2015 08:11:21",
                "AC Operator": "EZY",
            }
        ]
    ).to_csv(raw, index=False)
    output = tmp_path / "normalized.csv"
    ingest_eurocontrol_adrr(
        raw,
        output,
        airport_mapping={"LFPG": "CDG", "LEMG": "AGP"},
        accept_filed_arrival_proxy=True,
    )
    observation = HistoricalCsvDelayProvider(output, min_samples=1).observations[0]
    assert observation.scheduled_arrival.isoformat() == "2015-03-01T08:18:23+00:00"
    assert observation.actual_arrival.isoformat() == "2015-03-01T08:11:21+00:00"


def test_strict_adrr_schema_inspection_detects_real_file_format(tmp_path):
    raw = tmp_path / "flights.csv"
    raw.write_text(
        "ADEP;ADES;FILED ARRIVAL TIME;ACTUAL ARRIVAL TIME;AC Operator;EXTRA\n"
        "EDDB;EDDF;2025-03-01T10:00:00Z;2025-03-01T10:20:00Z;DLH;x\n",
        encoding="utf-8",
    )
    report = tmp_path / "schema.json"
    inspection = inspect_adrr_schema(raw, report_path=report)
    assert inspection.compatible is True
    assert inspection.delimiter == ";"
    assert inspection.additional_columns == ["EXTRA"]
    assert inspection.sampled_time_parse_failures == {
        "FILED ARRIVAL TIME": 0,
        "ACTUAL ARRIVAL TIME": 0,
    }
    assert json.loads(report.read_text(encoding="utf-8"))["sha256"] == inspection.sha256


def test_strict_adrr_schema_inspection_writes_failure_report(tmp_path):
    raw = tmp_path / "bad.csv"
    raw.write_text("ADEP,ADES,FILED ARRIVAL TIME\nEDDB,EDDF,2025-01-01T00:00:00Z\n", encoding="utf-8")
    report = tmp_path / "bad.schema.json"
    with pytest.raises(AdrrSchemaError, match="ACTUAL ARRIVAL TIME"):
        inspect_adrr_schema(raw, report_path=report)
    assert json.loads(report.read_text(encoding="utf-8"))["compatible"] is False


def test_raw_to_normalized_audit_is_deterministic_and_capped_at_50(tmp_path):
    rows = []
    for index in range(80):
        scheduled = BASE + timedelta(days=index)
        rows.append(
            {
                "ECTRL_ID": str(index),
                "ADEP": "EDDB",
                "ADES": "EDDF",
                "FILED ARRIVAL TIME": scheduled.isoformat(),
                "ACTUAL ARRIVAL TIME": (scheduled + timedelta(minutes=index % 20)).isoformat(),
                "AC Operator": "DLH",
                "AC Type": "A320",
            }
        )
    raw = tmp_path / "raw.csv"
    pd.DataFrame(rows).to_csv(raw, index=False)
    mapping = {"EDDB": "BER", "EDDF": "FRA"}
    first = tmp_path / "first.csv"
    second = tmp_path / "second.csv"
    ingest_eurocontrol_adrr(
        raw,
        first,
        airport_mapping=mapping,
        accept_filed_arrival_proxy=True,
        chunksize=7,
    )
    ingest_eurocontrol_adrr(
        raw,
        second,
        airport_mapping=mapping,
        accept_filed_arrival_proxy=True,
        chunksize=23,
    )
    first_audit = pd.read_csv(first.with_suffix(".audit.csv"))
    second_audit = pd.read_csv(second.with_suffix(".audit.csv"))
    assert len(first_audit) == 50
    assert first_audit["raw_ECTRL_ID"].tolist() == second_audit["raw_ECTRL_ID"].tolist()
    assert {
        "raw_FILED_ARRIVAL_TIME",
        "normalized_scheduled_arrival",
        "normalized_arrival_delay_minutes",
    }.issubset(first_audit.columns)
    mapping_path = tmp_path / "mapping.csv"
    pd.DataFrame(
        [{"icao_code": "EDDB", "iata_code": "BER"}, {"icao_code": "EDDF", "iata_code": "FRA"}]
    ).to_csv(mapping_path, index=False)
    assert validate_raw_normalized_audit(first.with_suffix(".audit.csv"), mapping_path) == []
    first_audit.loc[0, "normalized_arrival_delay_minutes"] = 999
    first_audit.to_csv(first.with_suffix(".audit.csv"), index=False)
    assert "delay calculation" in validate_raw_normalized_audit(
        first.with_suffix(".audit.csv"), mapping_path
    )[0]


def test_route_discovery_filters_airports_and_requires_history():
    inventory, targets = discover_routes(benchmark_observations(), benchmark_config())
    assert {(item.origin, item.destination) for item in inventory} == {
        ("AMS", "BUD"),
        ("BER", "FRA"),
    }
    assert all(item.eligible for item in inventory)
    assert len(targets) == 6


def test_chronological_benchmark_and_baselines_have_no_leakage():
    rows = benchmark_observations()
    result = evaluate_benchmark(rows, benchmark_config())
    assert result.eligible_target_count == 6
    assert len(result.predictions) == 18
    assert all(item.training_sample_count >= 3 for item in result.predictions)
    assert all(item.global_baseline_probability is not None for item in result.predictions)
    assert all(item.route_baseline_probability is not None for item in result.predictions)

    first_target = min(
        (item for item in result.predictions if item.origin == "BER"),
        key=lambda item: item.target_date,
    )
    changed = [
        item.model_copy(
            update={
                "actual_arrival": item.scheduled_arrival + timedelta(hours=8),
                "arrival_delay_minutes": 480.0,
            }
        )
        if item.origin == "BER" and item.observation_date >= first_target.target_date
        else item
        for item in rows
    ]
    changed_result = evaluate_benchmark(changed, benchmark_config())
    changed_first = next(
        item
        for item in changed_result.predictions
        if item.origin == "BER"
        and item.target_date == first_target.target_date
        and item.threshold_minutes == first_target.threshold_minutes
    )
    assert changed_first.predicted_probability == first_target.predicted_probability
    assert changed_first.global_baseline_probability == first_target.global_baseline_probability
    assert changed_first.route_baseline_probability == first_target.route_baseline_probability


def test_brier_skill_score_and_expected_calibration_error():
    assert brier_skill_score(0.1, 0.2) == pytest.approx(0.5)
    assert brier_skill_score(0.3, 0.2) == pytest.approx(-0.5)
    assert brier_skill_score(0.0, 0.0) == 0.0
    with pytest.raises(ValueError, match="perfect reference"):
        brier_skill_score(0.1, 0.0)
    assert expected_calibration_error([0.1, 0.9], [0, 1]) == pytest.approx(0.1)


def test_coverage_and_diagnostics_are_reported():
    covered = evaluate_benchmark(benchmark_observations(), benchmark_config())
    assert covered.metrics["30"]["coverage"] == 1.0
    assert {"airport", "route", "carrier", "match_level", "sample_count_bucket"} == set(
        covered.diagnostics["30"]
    )
    uncovered = evaluate_benchmark(
        benchmark_observations(), benchmark_config(lookback_days=1, min_samples=3)
    )
    assert uncovered.metrics["30"]["coverage"] == 0.0
    assert uncovered.metrics["30"]["skipped"] == 6


def test_lookback_and_minimum_sample_experiments():
    rows = benchmark_observations()
    lookbacks = run_lookback_experiment(rows, benchmark_config(), (1, 365))
    samples = run_sample_size_experiment(rows, benchmark_config(), (3, 100))
    assert [item["lookback_days"] for item in lookbacks] == [1, 365]
    assert lookbacks[0]["coverage"] < lookbacks[1]["coverage"]
    assert [item["min_samples"] for item in samples] == [3, 100]
    assert samples[0]["coverage"] > samples[1]["coverage"]


def test_report_and_artifact_generation(tmp_path, monkeypatch):
    rows = benchmark_observations()
    config = benchmark_config()
    result = evaluate_benchmark(rows, config)
    lookbacks = run_lookback_experiment(rows, config, (365,))
    samples = run_sample_size_experiment(rows, config, (3,))
    report = generate_benchmark_report(
        result,
        rows,
        lookbacks,
        samples,
        quality={
            "rows_read": 36,
            "rows_valid": 36,
            "rows_rejected": 0,
            "duplicates_removed": 0,
        },
    )
    assert "# Connection Risk Real-Data Benchmark" in report
    assert "Brier skill vs global" in report
    assert "passenger connection outcomes are unavailable" in report.lower()

    def fake_diagram(frame, threshold, path):
        path.write_bytes(b"synthetic-png-fixture")

    monkeypatch.setattr(
        "connection_risk.benchmarking._write_reliability_diagram", fake_diagram
    )
    paths = write_benchmark_outputs(
        result,
        rows,
        tmp_path / "output",
        quality={"rows_read": 36, "rows_valid": 36, "rows_rejected": 0, "duplicates_removed": 0},
        lookback_experiment=lookbacks,
        sample_experiment=samples,
    )
    assert paths["metrics"].is_file()
    assert paths["report"].is_file()
    assert (tmp_path / "output" / "calibration_15m.csv").is_file()
    assert (tmp_path / "output" / "calibration_60m.png").is_file()


def test_prebenchmark_sanity_report_enforces_frozen_scope(tmp_path):
    dataset = tmp_path / "normalized.csv"
    dataset.write_text("fixture", encoding="utf-8")
    insufficient = benchmark_observations()
    failed = build_prebenchmark_sanity_report(
        dataset, insufficient, audit_sample_rows=len(insufficient)
    )
    assert failed.ready_for_benchmark is False
    assert any("200 total" in item for item in failed.critical_issues)
    assert FIRST_ADRR_BENCHMARK_CONFIG.airports == ("BER", "FRA", "AMS", "BUD")
    assert FIRST_ADRR_BENCHMARK_CONFIG.lookback_days == 365
    assert FIRST_ADRR_BENCHMARK_CONFIG.min_samples == 30
    assert FIRST_ADRR_BENCHMARK_CONFIG.thresholds == (15.0, 30.0, 60.0)


def test_one_command_workflow_writes_reproducibility_manifest(tmp_path, monkeypatch):
    raw_rows = []
    for index in range(260):
        scheduled = BASE + timedelta(days=index)
        raw_rows.append(
            {
                "ECTRL_ID": str(index),
                "ADEP": "EDDB",
                "ADES": "EDDF",
                "FILED ARRIVAL TIME": scheduled.isoformat(),
                "ACTUAL ARRIVAL TIME": (scheduled + timedelta(minutes=(index % 6) * 15)).isoformat(),
                "AC Operator": "DLH",
                "AC Type": "A320",
            }
        )
    raw = tmp_path / "adrr.csv"
    pd.DataFrame(raw_rows).to_csv(raw, index=False)
    mapping = tmp_path / "mapping.csv"
    pd.DataFrame(
        [{"icao_code": "EDDB", "iata_code": "BER"}, {"icao_code": "EDDF", "iata_code": "FRA"}]
    ).to_csv(mapping, index=False)
    normalized = tmp_path / "processed" / "flights.csv"
    benchmark_output = tmp_path / "benchmark"

    def fake_outputs(result, observations, output_directory, **kwargs):
        destination = tmp_path / "benchmark" / "benchmark_report.md"
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text("synthetic workflow fixture", encoding="utf-8")
        return {"report": destination}

    monkeypatch.setattr("connection_risk.real_run.write_benchmark_outputs", fake_outputs)
    outcome = run_first_adrr_workflow(
        raw,
        mapping,
        normalized_dataset=normalized,
        benchmark_output=benchmark_output,
        accept_filed_arrival_proxy=True,
    )
    assert outcome["sanity"].ready_for_benchmark is True
    assert outcome["sanity"].audit_sample_rows == 50
    manifest = json.loads(outcome["manifest_path"].read_text(encoding="utf-8"))
    assert manifest["workflow"] == "connection-risk-first-adrr-benchmark-v1"
    assert manifest["frozen_benchmark_config"]["lookback_days"] == 365
    assert manifest["frozen_benchmark_config"]["min_samples"] == 30
    assert manifest["frozen_benchmark_config"]["thresholds"] == [15.0, 30.0, 60.0]
