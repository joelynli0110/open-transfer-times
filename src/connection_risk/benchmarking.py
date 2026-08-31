"""Reproducible, leakage-safe real-data arrival-delay benchmarks.

Visualization and report generation live here rather than in the simulation
engine.  Evaluation is deterministic and uses indexed chronological slices so
each prediction sees only observations strictly earlier than its target.
"""

from bisect import bisect_left
from collections import Counter, defaultdict
from dataclasses import dataclass, replace
from datetime import date, timedelta
import json
import math
from pathlib import Path
from typing import Callable, Iterable, Literal, Sequence

import numpy as np
import pandas as pd
from pydantic import BaseModel, ConfigDict, Field

from .backtesting import brier_score, calibration_buckets
from .models import HistoricalFlightObservation, MatchLevel

DEFAULT_AIRPORTS = ("BER", "FRA", "AMS", "BUD")
DEFAULT_THRESHOLDS = (15.0, 30.0, 60.0)


@dataclass(frozen=True)
class BenchmarkConfig:
    airports: tuple[str, ...] = DEFAULT_AIRPORTS
    thresholds: tuple[float, ...] = DEFAULT_THRESHOLDS
    lookback_days: int = 365
    min_samples: int = 30
    route_min_total: int = 200
    route_min_test: int = 50
    test_fraction: float = 0.2

    def __post_init__(self) -> None:
        normalized = tuple(dict.fromkeys(item.strip().upper() for item in self.airports))
        if not normalized or any(len(item) != 3 for item in normalized):
            raise ValueError("airports must contain three-letter IATA codes")
        object.__setattr__(self, "airports", normalized)
        if not self.thresholds or any(not math.isfinite(item) for item in self.thresholds):
            raise ValueError("thresholds must be finite and non-empty")
        if self.lookback_days < 1 or self.min_samples < 1:
            raise ValueError("lookback_days and min_samples must be positive")
        if self.route_min_total < 1 or self.route_min_test < 1:
            raise ValueError("route eligibility counts must be positive")
        if not 0 < self.test_fraction < 1:
            raise ValueError("test_fraction must lie between zero and one")


class RouteInventoryEntry(BaseModel):
    model_config = ConfigDict(frozen=True)

    origin: str
    destination: str
    observation_count: int = Field(ge=1)
    test_observation_count: int = Field(ge=0)
    eligible: bool


class BenchmarkPrediction(BaseModel):
    model_config = ConfigDict(frozen=True)

    flight_number: str | None
    carrier: str | None
    origin: str
    destination: str
    target_date: date
    threshold_minutes: float
    predicted_probability: float | None = Field(default=None, ge=0, le=1)
    actual_outcome: int = Field(ge=0, le=1)
    match_level: MatchLevel | None = None
    training_sample_count: int = Field(ge=0)
    actual_delay_minutes: float
    global_baseline_probability: float | None = Field(default=None, ge=0, le=1)
    route_baseline_probability: float | None = Field(default=None, ge=0, le=1)
    carrier_route_baseline_probability: float | None = Field(default=None, ge=0, le=1)


class BenchmarkResult(BaseModel):
    model_config = ConfigDict(frozen=True, arbitrary_types_allowed=True)

    config: dict[str, object]
    inventory: list[RouteInventoryEntry]
    eligible_target_count: int = Field(ge=0)
    predictions: list[BenchmarkPrediction]
    metrics: dict[str, object]
    diagnostics: dict[str, object]


@dataclass(frozen=True)
class _TimedGroup:
    observations: tuple[HistoricalFlightObservation, ...]
    times: tuple[object, ...]

    @classmethod
    def build(cls, items: Iterable[HistoricalFlightObservation]) -> "_TimedGroup":
        ordered = tuple(sorted(items, key=lambda item: item.scheduled_arrival))
        return cls(ordered, tuple(item.scheduled_arrival for item in ordered))

    def prior(
        self, target: HistoricalFlightObservation, lookback_days: int
    ) -> tuple[HistoricalFlightObservation, ...]:
        end = bisect_left(self.times, target.scheduled_arrival)
        start_time = target.scheduled_arrival - timedelta(days=lookback_days)
        start = bisect_left(self.times, start_time, hi=end)
        return self.observations[start:end]


class ObservationIndex:
    """Pre-index observations for rolling hierarchy and baseline queries."""

    def __init__(self, observations: Sequence[HistoricalFlightObservation]) -> None:
        self.global_group = _TimedGroup.build(observations)
        route: defaultdict[tuple[str, str], list[HistoricalFlightObservation]] = defaultdict(list)
        carrier_route: defaultdict[tuple[str, str, str], list[HistoricalFlightObservation]] = defaultdict(list)
        exact: defaultdict[tuple[str, str, str], list[HistoricalFlightObservation]] = defaultdict(list)
        for item in observations:
            route[(item.origin, item.destination)].append(item)
            if item.carrier:
                carrier_route[(item.carrier, item.origin, item.destination)].append(item)
            if item.flight_number:
                exact[(item.flight_number, item.origin, item.destination)].append(item)
        self.route = {key: _TimedGroup.build(value) for key, value in route.items()}
        self.carrier_route = {
            key: _TimedGroup.build(value) for key, value in carrier_route.items()
        }
        self.exact = {key: _TimedGroup.build(value) for key, value in exact.items()}

    @staticmethod
    def _query(
        groups: dict[tuple[str, ...], _TimedGroup],
        key: tuple[str, ...] | None,
        target: HistoricalFlightObservation,
        lookback_days: int,
    ) -> tuple[HistoricalFlightObservation, ...]:
        if key is None or key not in groups:
            return ()
        return groups[key].prior(target, lookback_days)

    def histories(
        self, target: HistoricalFlightObservation, lookback_days: int
    ) -> dict[str, tuple[HistoricalFlightObservation, ...]]:
        return {
            "global": self.global_group.prior(target, lookback_days),
            "route": self._query(
                self.route,
                (target.origin, target.destination),
                target,
                lookback_days,
            ),
            "carrier_route": self._query(
                self.carrier_route,
                (
                    (target.carrier, target.origin, target.destination)
                    if target.carrier
                    else None
                ),
                target,
                lookback_days,
            ),
            "exact_flight": self._query(
                self.exact,
                (
                    (target.flight_number, target.origin, target.destination)
                    if target.flight_number
                    else None
                ),
                target,
                lookback_days,
            ),
        }


def discover_routes(
    observations: Sequence[HistoricalFlightObservation], config: BenchmarkConfig
) -> tuple[list[RouteInventoryEntry], list[HistoricalFlightObservation]]:
    """Inventory selected-airport routes and return their chronological test targets."""
    selected = set(config.airports)
    grouped: defaultdict[tuple[str, str], list[HistoricalFlightObservation]] = defaultdict(list)
    for item in observations:
        if item.origin in selected and item.destination in selected:
            grouped[(item.origin, item.destination)].append(item)

    inventory: list[RouteInventoryEntry] = []
    targets: list[HistoricalFlightObservation] = []
    for (origin, destination), items in sorted(grouped.items()):
        ordered = sorted(items, key=lambda item: item.scheduled_arrival)
        requested_test = max(
            config.route_min_test, int(math.ceil(len(ordered) * config.test_fraction))
        )
        training_count = len(ordered) - requested_test
        eligible = (
            len(ordered) >= config.route_min_total
            and requested_test <= len(ordered)
            and training_count >= config.min_samples
        )
        test_count = requested_test if eligible else 0
        inventory.append(
            RouteInventoryEntry(
                origin=origin,
                destination=destination,
                observation_count=len(ordered),
                test_observation_count=test_count,
                eligible=eligible,
            )
        )
        if eligible:
            targets.extend(ordered[-test_count:])
    return inventory, sorted(targets, key=lambda item: item.scheduled_arrival)


def _frequency(
    observations: Sequence[HistoricalFlightObservation], threshold: float
) -> float | None:
    if not observations:
        return None
    return float(
        np.mean([item.arrival_delay_minutes > threshold for item in observations])
    )


def _select_model_history(
    histories: dict[str, tuple[HistoricalFlightObservation, ...]], min_samples: int
) -> tuple[MatchLevel | None, tuple[HistoricalFlightObservation, ...]]:
    for level in ("exact_flight", "carrier_route", "route"):
        items = histories[level]
        if len(items) >= min_samples:
            return level, items  # type: ignore[return-value]
    return None, ()


def brier_skill_score(model_score: float, reference_score: float) -> float:
    if not math.isfinite(model_score) or not math.isfinite(reference_score):
        raise ValueError("Brier scores must be finite")
    if reference_score < 0:
        raise ValueError("reference Brier score cannot be negative")
    if reference_score == 0:
        if model_score == 0:
            return 0.0
        raise ValueError("Brier skill score is undefined for a perfect reference")
    return 1.0 - model_score / reference_score


def expected_calibration_error(
    probabilities: Sequence[float], outcomes: Sequence[int], bucket_count: int = 10
) -> float:
    buckets = calibration_buckets(probabilities, outcomes, bucket_count=bucket_count)
    total = sum(bucket.prediction_count for bucket in buckets)
    return float(
        sum(
            bucket.prediction_count
            * abs(bucket.mean_predicted_probability - bucket.observed_frequency)
            for bucket in buckets
            if bucket.prediction_count
            and bucket.mean_predicted_probability is not None
            and bucket.observed_frequency is not None
        )
        / total
    )


def _score_field(
    predictions: Sequence[BenchmarkPrediction], field: str
) -> tuple[float | None, int]:
    selected = [item for item in predictions if getattr(item, field) is not None]
    if not selected:
        return None, 0
    return (
        brier_score(
            [float(getattr(item, field)) for item in selected],
            [item.actual_outcome for item in selected],
        ),
        len(selected),
    )


def _threshold_metrics(
    predictions: Sequence[BenchmarkPrediction], eligible_target_count: int
) -> dict[str, object]:
    model_rows = [item for item in predictions if item.predicted_probability is not None]
    model_brier, model_n = _score_field(predictions, "predicted_probability")
    global_brier, global_n = _score_field(predictions, "global_baseline_probability")
    route_brier, route_n = _score_field(predictions, "route_baseline_probability")
    carrier_brier, carrier_n = _score_field(
        predictions, "carrier_route_baseline_probability"
    )
    paired = [
        item
        for item in predictions
        if item.predicted_probability is not None
        and item.global_baseline_probability is not None
    ]
    skill = None
    if paired:
        paired_model = brier_score(
            [float(item.predicted_probability) for item in paired],
            [item.actual_outcome for item in paired],
        )
        paired_global = brier_score(
            [float(item.global_baseline_probability) for item in paired],
            [item.actual_outcome for item in paired],
        )
        skill = (
            brier_skill_score(paired_model, paired_global)
            if paired_global > 0 or paired_model == 0
            else None
        )
    fallback = Counter(item.match_level for item in model_rows)
    return {
        "eligible_targets": eligible_target_count,
        "predictions_made": model_n,
        "skipped": eligible_target_count - model_n,
        "coverage": model_n / eligible_target_count if eligible_target_count else 0.0,
        "model_brier": model_brier,
        "global_baseline_brier": global_brier,
        "global_baseline_n": global_n,
        "route_baseline_brier": route_brier,
        "route_baseline_n": route_n,
        "carrier_route_baseline_brier": carrier_brier,
        "carrier_route_baseline_n": carrier_n,
        "brier_skill_score_vs_global": skill,
        "expected_calibration_error": (
            expected_calibration_error(
                [float(item.predicted_probability) for item in model_rows],
                [item.actual_outcome for item in model_rows],
            )
            if model_rows
            else None
        ),
        "fallback_distribution": {
            str(level): count / model_n for level, count in sorted(fallback.items())
        },
    }


def _diagnostic_rows(
    predictions: Sequence[BenchmarkPrediction],
    key_name: str,
    key_function: Callable[[BenchmarkPrediction], str],
) -> list[dict[str, object]]:
    groups: defaultdict[str, list[BenchmarkPrediction]] = defaultdict(list)
    for item in predictions:
        if item.predicted_probability is not None:
            groups[key_function(item)].append(item)
    output = []
    for key, items in sorted(groups.items()):
        output.append(
            {
                key_name: key,
                "prediction_count": len(items),
                "brier": brier_score(
                    [float(item.predicted_probability) for item in items],
                    [item.actual_outcome for item in items],
                ),
                "expected_calibration_error": expected_calibration_error(
                    [float(item.predicted_probability) for item in items],
                    [item.actual_outcome for item in items],
                ),
            }
        )
    return output


def _sample_bucket(item: BenchmarkPrediction) -> str:
    count = item.training_sample_count
    if count < 30:
        return "0-29"
    if count < 50:
        return "30-49"
    if count < 100:
        return "50-99"
    return "100+"


def evaluate_benchmark(
    observations: Sequence[HistoricalFlightObservation],
    config: BenchmarkConfig | None = None,
) -> BenchmarkResult:
    config = config or BenchmarkConfig()
    selected = [
        item
        for item in observations
        if item.origin in config.airports and item.destination in config.airports
    ]
    inventory, targets = discover_routes(selected, config)
    index = ObservationIndex(selected)
    predictions: list[BenchmarkPrediction] = []
    for target in targets:
        histories = index.histories(target, config.lookback_days)
        if any(
            item.scheduled_arrival >= target.scheduled_arrival
            for values in histories.values()
            for item in values
        ):
            raise RuntimeError("benchmark index returned future observations")
        match_level, model_history = _select_model_history(histories, config.min_samples)
        for threshold in config.thresholds:
            predictions.append(
                BenchmarkPrediction(
                    flight_number=target.flight_number,
                    carrier=target.carrier,
                    origin=target.origin,
                    destination=target.destination,
                    target_date=target.observation_date,
                    threshold_minutes=threshold,
                    predicted_probability=_frequency(model_history, threshold),
                    actual_outcome=int(target.arrival_delay_minutes > threshold),
                    match_level=match_level,
                    training_sample_count=len(model_history),
                    actual_delay_minutes=target.arrival_delay_minutes,
                    global_baseline_probability=_frequency(histories["global"], threshold),
                    route_baseline_probability=_frequency(histories["route"], threshold),
                    carrier_route_baseline_probability=_frequency(
                        histories["carrier_route"], threshold
                    ),
                )
            )

    metrics: dict[str, object] = {}
    diagnostics: dict[str, object] = {}
    for threshold in config.thresholds:
        rows = [item for item in predictions if item.threshold_minutes == threshold]
        label = f"{threshold:g}"
        metrics[label] = _threshold_metrics(rows, len(targets))
        diagnostics[label] = {
            "airport": _diagnostic_rows(rows, "airport", lambda item: item.destination),
            "route": _diagnostic_rows(
                rows, "route", lambda item: f"{item.origin}->{item.destination}"
            ),
            "carrier": _diagnostic_rows(
                rows, "carrier", lambda item: item.carrier or "unknown"
            ),
            "match_level": _diagnostic_rows(
                rows, "match_level", lambda item: item.match_level or "none"
            ),
            "sample_count_bucket": _diagnostic_rows(
                rows, "sample_count_bucket", _sample_bucket
            ),
        }
    return BenchmarkResult(
        config={
            "airports": list(config.airports),
            "thresholds": list(config.thresholds),
            "lookback_days": config.lookback_days,
            "min_samples": config.min_samples,
            "route_min_total": config.route_min_total,
            "route_min_test": config.route_min_test,
            "test_fraction": config.test_fraction,
        },
        inventory=inventory,
        eligible_target_count=len(targets),
        predictions=predictions,
        metrics=metrics,
        diagnostics=diagnostics,
    )


def _experiment_summary(result: BenchmarkResult) -> dict[str, object]:
    threshold = "30" if "30" in result.metrics else next(iter(result.metrics), None)
    values = result.metrics.get(threshold, {}) if threshold else {}
    return {
        "threshold_minutes": float(threshold) if threshold is not None else None,
        "coverage": values.get("coverage"),
        "brier": values.get("model_brier"),
        "brier_skill_score": values.get("brier_skill_score_vs_global"),
    }


def run_lookback_experiment(
    observations: Sequence[HistoricalFlightObservation],
    config: BenchmarkConfig,
    lookbacks: Sequence[int] = (90, 180, 365),
) -> list[dict[str, object]]:
    output = []
    for days in lookbacks:
        result = evaluate_benchmark(observations, replace(config, lookback_days=days))
        output.append({"lookback_days": days, **_experiment_summary(result)})
    return output


def run_sample_size_experiment(
    observations: Sequence[HistoricalFlightObservation],
    config: BenchmarkConfig,
    minimums: Sequence[int] = (20, 30, 50, 100),
) -> list[dict[str, object]]:
    output = []
    for minimum in minimums:
        result = evaluate_benchmark(observations, replace(config, min_samples=minimum))
        output.append({"min_samples": minimum, **_experiment_summary(result)})
    return output


def _calibration_frame(rows: Sequence[BenchmarkPrediction]) -> pd.DataFrame:
    selected = [item for item in rows if item.predicted_probability is not None]
    if not selected:
        return pd.DataFrame(
            columns=[
                "lower_bound",
                "upper_bound",
                "prediction_count",
                "mean_predicted_probability",
                "observed_frequency",
            ]
        )
    return pd.DataFrame(
        [
            bucket.model_dump()
            for bucket in calibration_buckets(
                [float(item.predicted_probability) for item in selected],
                [item.actual_outcome for item in selected],
            )
        ]
    )


def _write_reliability_diagram(frame: pd.DataFrame, threshold: float, path: Path) -> None:
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError as exc:
        raise RuntimeError(
            "Reliability diagrams require the 'benchmark' optional dependencies"
        ) from exc
    populated = frame[frame["prediction_count"] > 0]
    figure, axis = plt.subplots(figsize=(6, 6))
    axis.plot([0, 1], [0, 1], linestyle="--", color="gray", label="Perfect calibration")
    if not populated.empty:
        axis.plot(
            populated["mean_predicted_probability"],
            populated["observed_frequency"],
            marker="o",
            label="Historical model",
        )
    axis.set(xlim=(0, 1), ylim=(0, 1), xlabel="Mean predicted probability", ylabel="Observed frequency")
    axis.set_title(f"Reliability diagram: delay > {threshold:g} minutes")
    axis.grid(alpha=0.25)
    axis.legend()
    figure.tight_layout()
    figure.savefig(path, dpi=150)
    plt.close(figure)


def _markdown_table(headers: Sequence[str], rows: Sequence[Sequence[object]]) -> str:
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join("---" for _ in headers) + " |",
    ]
    lines.extend("| " + " | ".join(str(value) for value in row) + " |" for row in rows)
    return "\n".join(lines)


def _format_metric(value: object) -> str:
    if value is None:
        return "n/a"
    if isinstance(value, float):
        return f"{value:.4f}"
    return str(value)


def generate_benchmark_report(
    result: BenchmarkResult,
    observations: Sequence[HistoricalFlightObservation],
    lookback_experiment: Sequence[dict[str, object]],
    sample_experiment: Sequence[dict[str, object]],
    quality: dict[str, object] | None = None,
) -> str:
    selected = [
        item
        for item in observations
        if item.origin in result.config["airports"] and item.destination in result.config["airports"]
    ]
    dates = [item.observation_date for item in selected]
    sources = sorted({item.source for item in selected})
    eligible_routes = [item for item in result.inventory if item.eligible]
    lines = [
        "# Connection Risk Real-Data Benchmark",
        "",
        "## Dataset",
        "",
        f"Source: {', '.join(sources) if sources else 'n/a'}  ",
        f"Date range: {min(dates) if dates else 'n/a'} to {max(dates) if dates else 'n/a'}  ",
        f"Flights in selected-airport subset: {len(selected):,}  ",
        f"Eligible routes: {len(eligible_routes):,}  ",
        f"Airports: {', '.join(result.config['airports'])}",
        "",
        "## Data Quality",
        "",
        f"Rows read: {quality.get('rows_read', 'not supplied') if quality else 'not supplied'}  ",
        f"Rows accepted: {quality.get('rows_valid', 'not supplied') if quality else 'not supplied'}  ",
        f"Rows rejected: {quality.get('rows_rejected', 'not supplied') if quality else 'not supplied'}  ",
        f"Duplicates: {quality.get('duplicates_removed', 'not supplied') if quality else 'not supplied'}",
        "",
        "## Evaluation Protocol",
        "",
        "Routes are evaluated on their chronologically latest holdout observations: the larger of the configured minimum test count or test fraction. For every target, model and baseline histories contain only records strictly before the target and within the configured lookback window. The history is updated after each target (rolling origin); no random split is used.",
        "",
        f"Lookback: {result.config['lookback_days']} days  ",
        f"Minimum model samples: {result.config['min_samples']}  ",
        f"Thresholds: {', '.join(f'{item:g}m' for item in result.config['thresholds'])}",
        "",
        "## Route Inventory",
        "",
        _markdown_table(
            ["Route", "N", "Test N", "Eligible"],
            [
                [f"{item.origin}->{item.destination}", item.observation_count, item.test_observation_count, item.eligible]
                for item in result.inventory
            ],
        ),
        "",
        "## Coverage and Results",
        "",
    ]
    findings: list[str] = []
    for threshold in result.config["thresholds"]:
        key = f"{threshold:g}"
        metrics = result.metrics[key]
        lines.extend(
            [
                f"### {threshold:g}-minute threshold",
                "",
                _markdown_table(
                    ["Metric", "Value"],
                    [
                        ["Coverage", f"{metrics['coverage']:.1%}"],
                        ["Predictions", metrics["predictions_made"]],
                        ["Skipped", metrics["skipped"]],
                        ["Model Brier", _format_metric(metrics["model_brier"])],
                        ["Global baseline Brier", _format_metric(metrics["global_baseline_brier"])],
                        ["Route baseline Brier", _format_metric(metrics["route_baseline_brier"])],
                        ["Carrier-route baseline Brier", _format_metric(metrics["carrier_route_baseline_brier"])],
                        ["Brier skill vs global", _format_metric(metrics["brier_skill_score_vs_global"])],
                        ["Expected calibration error", _format_metric(metrics["expected_calibration_error"])],
                    ],
                ),
                "",
                "Fallback distribution: "
                + ", ".join(
                    f"{level}={share:.1%}"
                    for level, share in metrics["fallback_distribution"].items()
                ),
                "",
                "Calibration:",
                "",
            ]
        )
        calibration = _calibration_frame(
            [item for item in result.predictions if item.threshold_minutes == threshold]
        )
        lines.append(
            _markdown_table(
                ["Predicted", "N", "Mean predicted", "Observed"],
                [
                    [
                        f"{row.lower_bound:.0%}-{row.upper_bound:.0%}",
                        row.prediction_count,
                        "n/a" if pd.isna(row.mean_predicted_probability) else f"{row.mean_predicted_probability:.1%}",
                        "n/a" if pd.isna(row.observed_frequency) else f"{row.observed_frequency:.1%}",
                    ]
                    for row in calibration.itertuples()
                ],
            )
        )
        match_diagnostics = result.diagnostics[key]["match_level"]
        route_diagnostics = result.diagnostics[key]["route"]
        lines.extend(
            [
                "",
                "Match-level diagnostics:",
                "",
                _markdown_table(
                    ["Match level", "N", "Brier", "ECE"],
                    [
                        [
                            row["match_level"],
                            row["prediction_count"],
                            _format_metric(row["brier"]),
                            _format_metric(row["expected_calibration_error"]),
                        ]
                        for row in match_diagnostics
                    ],
                ),
                "",
            ]
        )
        if route_diagnostics:
            best = min(route_diagnostics, key=lambda row: row["expected_calibration_error"])
            worst = max(route_diagnostics, key=lambda row: row["expected_calibration_error"])
            lines.extend(
                [
                    f"Lowest route ECE: {best['route']} ({best['expected_calibration_error']:.4f}, N={best['prediction_count']}).  ",
                    f"Highest route ECE: {worst['route']} ({worst['expected_calibration_error']:.4f}, N={worst['prediction_count']}).",
                    "",
                ]
            )
        skill = metrics["brier_skill_score_vs_global"]
        if skill is not None:
            relation = "improved on" if skill > 0 else "underperformed" if skill < 0 else "matched"
            findings.append(
                f"For the {threshold:g}-minute event, the hierarchical model {relation} the global baseline on paired predictions (Brier skill score {_format_metric(skill)})."
            )

    lines.extend(
        [
            "## Lookback Experiment",
            "",
            "The same benchmark protocol is rerun for each window. The table reports the 30-minute event when configured (otherwise the first threshold). These are test-set diagnostics, not an automatically selected production hyperparameter.",
            "",
            _markdown_table(
                ["Lookback days", "Coverage", "Brier", "Brier skill"],
                [
                    [row["lookback_days"], _format_metric(row["coverage"]), _format_metric(row["brier"]), _format_metric(row["brier_skill_score"])]
                    for row in lookback_experiment
                ],
            ),
            "",
            "## Minimum Sample Experiment",
            "",
            _markdown_table(
                ["Minimum samples", "Coverage", "Brier", "Brier skill"],
                [
                    [row["min_samples"], _format_metric(row["coverage"]), _format_metric(row["brier"]), _format_metric(row["brier_skill_score"])]
                    for row in sample_experiment
                ],
            ),
            "",
            "## Diagnostics",
            "",
            "Machine-readable diagnostics by destination airport, route, carrier, match level, and training-sample bucket are stored in `metrics.json`.",
            "",
            "## Findings",
            "",
        ]
    )
    lines.extend(f"- {finding}" for finding in findings)
    if not findings:
        lines.append("- No model-versus-global comparison was available.")
    lines.extend(
        [
            "",
            "## Limitations",
            "",
            "- Passenger connection outcomes are unavailable; missed-connection probability is not validated here.",
            "- The airport-transfer model is not evaluated by this benchmark.",
            "- Dataset coverage may be incomplete and source-specific biases may exist.",
            "- Historical performance may not represent future performance.",
            "- EUROCONTROL ADRR filed arrival time is a flight-plan value, not a passenger timetable arrival; ADRR results measure filed-plan deviation.",
        ]
    )
    return "\n".join(lines) + "\n"


def write_benchmark_outputs(
    result: BenchmarkResult,
    observations: Sequence[HistoricalFlightObservation],
    output_directory: str | Path,
    *,
    quality: dict[str, object] | None = None,
    lookback_experiment: Sequence[dict[str, object]] | None = None,
    sample_experiment: Sequence[dict[str, object]] | None = None,
) -> dict[str, Path]:
    output = Path(output_directory)
    output.mkdir(parents=True, exist_ok=True)
    config = BenchmarkConfig(
        airports=tuple(result.config["airports"]),
        thresholds=tuple(result.config["thresholds"]),
        lookback_days=int(result.config["lookback_days"]),
        min_samples=int(result.config["min_samples"]),
        route_min_total=int(result.config["route_min_total"]),
        route_min_test=int(result.config["route_min_test"]),
        test_fraction=float(result.config["test_fraction"]),
    )
    lookbacks = list(lookback_experiment or run_lookback_experiment(observations, config))
    samples = list(sample_experiment or run_sample_size_experiment(observations, config))
    prediction_path = output / "predictions.csv"
    pd.DataFrame(
        [item.model_dump(mode="json") for item in result.predictions]
    ).to_csv(prediction_path, index=False)
    inventory_path = output / "route_inventory.csv"
    pd.DataFrame([item.model_dump() for item in result.inventory]).to_csv(
        inventory_path, index=False
    )
    metrics_path = output / "metrics.json"
    metrics_path.write_text(
        json.dumps(
            {
                "config": result.config,
                "eligible_target_count": result.eligible_target_count,
                "metrics": result.metrics,
                "diagnostics": result.diagnostics,
                "lookback_experiment": lookbacks,
                "sample_size_experiment": samples,
            },
            indent=2,
            sort_keys=True,
        ),
        encoding="utf-8",
    )
    paths = {
        "predictions": prediction_path,
        "inventory": inventory_path,
        "metrics": metrics_path,
    }
    for threshold in config.thresholds:
        rows = [item for item in result.predictions if item.threshold_minutes == threshold]
        frame = _calibration_frame(rows)
        suffix = f"{threshold:g}m"
        calibration_path = output / f"calibration_{suffix}.csv"
        image_path = output / f"calibration_{suffix}.png"
        frame.to_csv(calibration_path, index=False)
        _write_reliability_diagram(frame, threshold, image_path)
        paths[f"calibration_{suffix}"] = calibration_path
        paths[f"diagram_{suffix}"] = image_path
    report_path = output / "benchmark_report.md"
    report_path.write_text(
        generate_benchmark_report(
            result, observations, lookbacks, samples, quality=quality
        ),
        encoding="utf-8",
    )
    paths["report"] = report_path
    return paths
