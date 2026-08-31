"""Chronological out-of-sample evaluation for arrival-delay probabilities."""

import csv
from datetime import date
import json
from pathlib import Path
from typing import Sequence

import numpy as np
from pydantic import BaseModel, ConfigDict, Field

from .delay_distribution import empirical_exceedance_probability
from .models import HistoricalFlightObservation, MatchLevel
from .providers.base import DelayProvider


class BacktestPrediction(BaseModel):
    model_config = ConfigDict(frozen=True)

    target_flight: str | None
    target_date: date
    origin: str
    destination: str
    threshold_minutes: float
    predicted_probability: float = Field(ge=0, le=1)
    actual_outcome: int = Field(ge=0, le=1)
    match_level: MatchLevel
    sample_count: int = Field(ge=1)


class CalibrationBucket(BaseModel):
    model_config = ConfigDict(frozen=True)

    lower_bound: float
    upper_bound: float
    prediction_count: int = Field(ge=0)
    mean_predicted_probability: float | None
    observed_frequency: float | None


class BacktestReport(BaseModel):
    model_config = ConfigDict(frozen=True)

    threshold_minutes: float
    predictions: list[BacktestPrediction]
    brier_score: float = Field(ge=0, le=1)
    calibration: list[CalibrationBucket]
    dataset_date_start: date | None = None
    dataset_date_end: date | None = None

    @property
    def date_start(self) -> date | None:
        return min((item.target_date for item in self.predictions), default=None)

    @property
    def date_end(self) -> date | None:
        return max((item.target_date for item in self.predictions), default=None)

    def export_csv(self, path: str | Path) -> None:
        fields = [
            "target_flight",
            "target_date",
            "origin",
            "destination",
            "threshold_minutes",
            "predicted_probability",
            "actual_outcome",
            "match_level",
            "sample_count",
        ]
        with Path(path).open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            for prediction in self.predictions:
                writer.writerow(prediction.model_dump(mode="json"))

    def export_json(self, path: str | Path) -> None:
        Path(path).write_text(
            json.dumps(
                [item.model_dump(mode="json") for item in self.predictions],
                indent=2,
            ),
            encoding="utf-8",
        )


def brier_score(predicted_probabilities: Sequence[float], outcomes: Sequence[int]) -> float:
    predictions = np.asarray(predicted_probabilities, dtype=np.float64)
    actual = np.asarray(outcomes, dtype=np.float64)
    if predictions.ndim != 1 or predictions.size == 0:
        raise ValueError("at least one prediction is required")
    if predictions.shape != actual.shape:
        raise ValueError("predictions and outcomes must have the same length")
    if not np.all(np.isfinite(predictions)) or not np.all(np.isfinite(actual)):
        raise ValueError("predictions and outcomes must contain only finite values")
    if np.any((predictions < 0) | (predictions > 1)):
        raise ValueError("predicted probabilities must lie in [0, 1]")
    if np.any((actual != 0) & (actual != 1)):
        raise ValueError("outcomes must be binary")
    return float(np.mean((predictions - actual) ** 2))


def calibration_buckets(
    predicted_probabilities: Sequence[float],
    outcomes: Sequence[int],
    *,
    bucket_count: int = 10,
) -> list[CalibrationBucket]:
    if bucket_count < 1:
        raise ValueError("bucket_count must be positive")
    predictions = np.asarray(predicted_probabilities, dtype=np.float64)
    actual = np.asarray(outcomes, dtype=np.float64)
    if predictions.shape != actual.shape or predictions.ndim != 1:
        raise ValueError("predictions and outcomes must be same-length vectors")
    if predictions.size == 0:
        raise ValueError("at least one prediction is required")
    if not np.all(np.isfinite(predictions)) or not np.all(np.isfinite(actual)):
        raise ValueError("predictions and outcomes must contain only finite values")
    if np.any((predictions < 0) | (predictions > 1)):
        raise ValueError("predicted probabilities must lie in [0, 1]")
    if np.any((actual != 0) & (actual != 1)):
        raise ValueError("outcomes must be binary")

    assignments = np.minimum((predictions * bucket_count).astype(int), bucket_count - 1)
    buckets: list[CalibrationBucket] = []
    for index in range(bucket_count):
        selected = assignments == index
        count = int(np.sum(selected))
        buckets.append(
            CalibrationBucket(
                lower_bound=index / bucket_count,
                upper_bound=(index + 1) / bucket_count,
                prediction_count=count,
                mean_predicted_probability=(
                    float(np.mean(predictions[selected])) if count else None
                ),
                observed_frequency=float(np.mean(actual[selected])) if count else None,
            )
        )
    return buckets


def rolling_backtest(
    provider: DelayProvider,
    *,
    threshold_minutes: float = 30.0,
    targets: Sequence[HistoricalFlightObservation] | None = None,
) -> BacktestReport:
    """Evaluate targets chronologically using only strictly earlier observations."""
    if targets is None:
        available = getattr(provider, "observations", None)
        if available is None:
            raise TypeError("provider must expose observations or targets must be supplied")
        targets = available
    chronological_targets = sorted(targets, key=lambda item: item.scheduled_arrival)
    predictions: list[BacktestPrediction] = []
    for target in chronological_targets:
        try:
            history = provider.get_observations(
                flight_number=target.flight_number,
                carrier=target.carrier,
                origin=target.origin,
                destination=target.destination,
                scheduled_arrival=target.scheduled_arrival,
            )
        except LookupError:
            # Early observations commonly have too little prior history. They are
            # not test predictions and are intentionally omitted.
            continue
        if any(
            item.scheduled_arrival >= target.scheduled_arrival
            for item in history.observations
        ):
            raise RuntimeError("provider returned future data during backtesting")
        probability = empirical_exceedance_probability(
            history.delay_minutes(), threshold_minutes
        )
        predictions.append(
            BacktestPrediction(
                target_flight=target.flight_number,
                target_date=target.observation_date,
                origin=target.origin,
                destination=target.destination,
                threshold_minutes=threshold_minutes,
                predicted_probability=probability,
                actual_outcome=int(target.arrival_delay_minutes > threshold_minutes),
                match_level=history.match_level,
                sample_count=history.sample_count,
            )
        )
    if not predictions:
        raise ValueError("backtest produced no predictions; add history or lower min_samples")
    probabilities = [item.predicted_probability for item in predictions]
    outcomes = [item.actual_outcome for item in predictions]
    return BacktestReport(
        threshold_minutes=threshold_minutes,
        predictions=predictions,
        brier_score=brier_score(probabilities, outcomes),
        calibration=calibration_buckets(probabilities, outcomes),
        dataset_date_start=min(
            (item.observation_date for item in chronological_targets), default=None
        ),
        dataset_date_end=max(
            (item.observation_date for item in chronological_targets), default=None
        ),
    )
