from datetime import UTC, datetime, timedelta
import json

import pandas as pd
import pytest
from pydantic import ValidationError

from connection_risk.backtesting import (
    brier_score,
    calibration_buckets,
    rolling_backtest,
)
from connection_risk.confidence import assess_delay_confidence
from connection_risk.delay_distribution import (
    empirical_exceedance_probability,
    summarize_delays,
)
from connection_risk.engine import RiskEngine
from connection_risk.models import HistoricalFlightObservation, RiskResult
from connection_risk.providers.historical_csv import (
    HistoricalCsvDelayProvider,
    InsufficientHistoryError,
)


BASE = datetime(2025, 1, 1, 10, tzinfo=UTC)


def row(
    index,
    *,
    flight="W62316",
    carrier="W6",
    origin="BER",
    destination="BUD",
    delay=10,
    days=None,
):
    arrival = BASE + timedelta(days=index if days is None else days)
    return {
        "flight_number": flight,
        "carrier": carrier,
        "origin": origin,
        "destination": destination,
        "scheduled_departure": (arrival - timedelta(hours=1, minutes=30)).isoformat(),
        "scheduled_arrival": arrival.isoformat(),
        "actual_arrival": (arrival + timedelta(minutes=delay)).isoformat(),
        "arrival_delay_minutes": delay,
    }


def provider_from(tmp_path, rows, **kwargs):
    path = tmp_path / "history.csv"
    pd.DataFrame(rows).to_csv(path, index=False)
    return HistoricalCsvDelayProvider(path, **kwargs)


def test_historical_observation_checks_delay_consistency_and_normalizes_utc():
    scheduled = datetime(2025, 1, 1, 10, tzinfo=UTC)
    observation = HistoricalFlightObservation(
        flight_number="w6 2316",
        carrier="w6",
        origin="ber",
        destination="bud",
        scheduled_arrival=scheduled,
        actual_arrival=scheduled + timedelta(minutes=10.5),
        arrival_delay_minutes=10,
        observation_date=scheduled.date(),
        source="test",
    )
    assert observation.flight_number == "W62316"
    assert observation.origin == "BER"
    with pytest.raises(ValidationError, match="inconsistent"):
        HistoricalFlightObservation.model_validate(
            {**observation.model_dump(), "arrival_delay_minutes": 20}
        )


def test_historical_observation_rejects_naive_timestamp():
    with pytest.raises(ValidationError, match="timezone-aware"):
        HistoricalFlightObservation(
            origin="BER",
            destination="BUD",
            scheduled_arrival=datetime(2025, 1, 1, 10),
            actual_arrival=datetime(2025, 1, 1, 10, 5),
            arrival_delay_minutes=5,
            observation_date=BASE.date(),
            source="test",
        )


def test_csv_normalization(tmp_path):
    item = row(0, flight="w6-2316", carrier="w6", origin="ber", destination="bud")
    provider = provider_from(tmp_path, [item], min_samples=1)
    observation = provider.observations[0]
    assert (observation.flight_number, observation.carrier) == ("W62316", "W6")
    assert (observation.origin, observation.destination) == ("BER", "BUD")
    assert observation.scheduled_arrival.tzinfo is not None


def test_hierarchy_selects_exact_flight(tmp_path):
    rows = [row(i) for i in range(3)] + [row(4, flight="W62222")]
    provider = provider_from(tmp_path, rows, min_samples=3)
    selected = provider.get_observations("W62316", "W6", "BER", "BUD")
    assert selected.match_level == "exact_flight"
    assert selected.sample_count == 3


def test_hierarchy_falls_back_to_carrier_route(tmp_path):
    rows = [row(i) for i in range(2)] + [row(i + 2, flight="W62222") for i in range(2)]
    provider = provider_from(tmp_path, rows, min_samples=3)
    selected = provider.get_observations("W62316", "W6", "BER", "BUD")
    assert selected.match_level == "carrier_route"
    assert selected.sample_count == 4


def test_hierarchy_falls_back_to_route(tmp_path):
    rows = [row(i) for i in range(2)] + [
        row(i + 2, flight="LH123", carrier="LH") for i in range(2)
    ]
    provider = provider_from(tmp_path, rows, min_samples=3)
    selected = provider.get_observations("W62316", "W6", "BER", "BUD")
    assert selected.match_level == "route"
    assert selected.sample_count == 4


def test_minimum_sample_threshold_is_enforced(tmp_path):
    provider = provider_from(tmp_path, [row(0), row(1)], min_samples=3)
    with pytest.raises(InsufficientHistoryError, match="at least 3"):
        provider.get_observations("W62316", "W6", "BER", "BUD")


def test_future_observations_are_never_used(tmp_path):
    provider = provider_from(tmp_path, [row(i) for i in range(5)], min_samples=2)
    cutoff = BASE + timedelta(days=3)
    selected = provider.get_observations(
        "W62316", "W6", "BER", "BUD", scheduled_arrival=cutoff
    )
    assert selected.sample_count == 3
    assert all(item.scheduled_arrival < cutoff for item in selected.observations)


def test_lookback_window_excludes_stale_history(tmp_path):
    rows = [row(0), row(1), row(2, days=100), row(3, days=101)]
    provider = provider_from(tmp_path, rows, min_samples=1, lookback_days=10)
    selected = provider.get_observations(
        "W62316",
        "W6",
        "BER",
        "BUD",
        scheduled_arrival=BASE + timedelta(days=102),
    )
    assert selected.sample_count == 2
    assert selected.date_start == (BASE + timedelta(days=100)).date()


def test_default_cutoff_includes_exact_lookback_boundary(tmp_path):
    provider = provider_from(
        tmp_path,
        [row(0), row(1, days=10)],
        min_samples=1,
        lookback_days=10,
    )
    selected = provider.get_observations("W62316", "W6", "BER", "BUD")
    assert selected.sample_count == 2


def test_confidence_depends_on_match_specificity():
    assert assess_delay_confidence(100, "exact_flight").level == "high"
    assert assess_delay_confidence(100, "carrier_route").level == "high"
    assert assess_delay_confidence(100, "route").level == "medium"


def test_confidence_depends_on_sample_count():
    assert assess_delay_confidence(29, "exact_flight").level == "low"
    assert assess_delay_confidence(30, "exact_flight").level == "medium"


def test_empirical_probability_and_summary():
    delays = [-10, 0, 20, 40]
    assert empirical_exceedance_probability(delays, 15) == 0.5
    summary = summarize_delays(delays)
    assert summary.mean == pytest.approx(12.5)
    assert summary.sample_count == 4


def test_empirical_probability_rejects_non_finite_threshold():
    with pytest.raises(ValueError, match="finite"):
        empirical_exceedance_probability([0, 10], float("nan"))


def test_brier_score_calculation():
    assert brier_score([0.0, 1.0], [0, 0]) == pytest.approx(0.5)


def test_metrics_reject_non_finite_or_empty_inputs():
    with pytest.raises(ValueError, match="finite"):
        brier_score([float("nan")], [0])
    with pytest.raises(ValueError, match="at least one"):
        calibration_buckets([], [])


def test_calibration_bucket_calculation():
    buckets = calibration_buckets([0.05, 0.15, 0.18, 1.0], [0, 0, 1, 1])
    assert buckets[0].prediction_count == 1
    assert buckets[1].prediction_count == 2
    assert buckets[1].mean_predicted_probability == pytest.approx(0.165)
    assert buckets[1].observed_frequency == pytest.approx(0.5)
    assert buckets[9].prediction_count == 1


def test_rolling_backtest_is_chronological_and_has_no_leakage(tmp_path):
    provider = provider_from(
        tmp_path,
        [row(i, delay=40 if i % 2 else 0) for i in range(7)],
        min_samples=3,
    )
    report = rolling_backtest(provider, threshold_minutes=30)
    assert len(report.predictions) == 4
    assert [item.sample_count for item in report.predictions] == [3, 4, 5, 6]
    assert all(0 <= item.predicted_probability <= 1 for item in report.predictions)
    assert report.dataset_date_start == BASE.date()
    assert report.dataset_date_end == (BASE + timedelta(days=6)).date()
    assert report.date_start == (BASE + timedelta(days=3)).date()


def test_corrupt_rows_are_reported_explicitly(tmp_path):
    corrupt = row(1)
    corrupt["actual_arrival"] = "not-a-time"
    with pytest.warns(UserWarning, match="rejected 1"):
        provider = provider_from(tmp_path, [row(0), corrupt], min_samples=1)
    stats = provider.ingestion_statistics
    assert (stats.rows_read, stats.rows_valid, stats.rows_rejected) == (2, 1, 1)
    assert "row 3" in stats.rejection_reasons[0]


def test_duplicate_observations_are_reported_and_removed(tmp_path):
    duplicate = row(0)
    with pytest.warns(UserWarning, match="duplicate"):
        provider = provider_from(tmp_path, [duplicate, duplicate], min_samples=1)
    assert provider.ingestion_statistics.duplicates_removed == 1
    assert len(provider.observations) == 1


def test_practical_buffer_calculation_is_correct():
    # Reuse the legacy-provider fixture to prove the new naming did not alter V0.1.
    from test_connection_risk import FixedDelayProvider, make_connection

    engine = RiskEngine(FixedDelayProvider([0, 5, 10] * 20))
    result = engine.analyze(make_connection(120), random_seed=42)
    assert result.time_available_until_deadline_minutes == 75
    assert result.practical_buffer_minutes == pytest.approx(
        75 - result.transfer_median_minutes
    )
    with pytest.deprecated_call():
        assert result.usable_buffer_minutes == 75


def test_backtest_exports_machine_readable_records(tmp_path):
    provider = provider_from(tmp_path, [row(i) for i in range(5)], min_samples=2)
    report = rolling_backtest(provider)
    csv_path = tmp_path / "predictions.csv"
    json_path = tmp_path / "predictions.json"
    report.export_csv(csv_path)
    report.export_json(json_path)
    assert "predicted_probability" in csv_path.read_text(encoding="utf-8")
    assert len(json.loads(json_path.read_text(encoding="utf-8"))) == 3


def test_v01_risk_result_shape_remains_constructible():
    legacy = RiskResult(
        scheduled_connection_minutes=120,
        usable_buffer_minutes=75,
        miss_probability=0.1,
        transfer_median_minutes=20,
        transfer_p90_minutes=30,
        risk_level="moderate",
        confidence="medium",
        risk_factors=[],
    )
    assert legacy.time_available_until_deadline_minutes == 75
    assert legacy.expected_transfer_minutes == 20
    assert legacy.practical_buffer_minutes == 55
