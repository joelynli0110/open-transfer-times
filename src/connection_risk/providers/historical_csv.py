"""Normalized, leakage-safe historical CSV/Parquet delay provider."""

from collections import Counter
from datetime import UTC, datetime, timedelta
from pathlib import Path
import warnings

import numpy as np
import pandas as pd
from numpy.typing import NDArray
from pydantic import ValidationError

from ..ingestion.normalization import (
    normalize_airport_code,
    normalize_carrier,
    normalize_flight_number,
)
from ..ingestion.schema import IngestionStatistics
from ..models import DelayObservationSet, HistoricalFlightObservation, MatchLevel
from .base import DelayProvider

REQUIRED_COLUMNS = {
    "flight_number",
    "carrier",
    "origin",
    "destination",
    "scheduled_departure",
    "scheduled_arrival",
    "actual_arrival",
    "arrival_delay_minutes",
}


class HistoricalDataQualityError(ValueError):
    """Raised when strict ingestion encounters invalid historical rows."""


class InsufficientHistoryError(LookupError):
    """Raised when no hierarchy level reaches the configured minimum sample size."""


def _optional(value: object) -> object | None:
    return None if pd.isna(value) or str(value).strip() == "" else value


def _parse_utc(value: object, field_name: str) -> datetime:
    if _optional(value) is None:
        raise ValueError(f"{field_name} is missing")
    parsed = pd.to_datetime(value, utc=True, errors="raise")
    return parsed.to_pydatetime()


class HistoricalCsvDelayProvider(DelayProvider):
    """Read a normalized historical dataset and apply hierarchical matching."""

    def __init__(
        self,
        csv_path: str | Path,
        *,
        min_samples: int = 30,
        lookback_days: int = 365,
        strict: bool = False,
        source: str | None = None,
    ) -> None:
        if min_samples < 1:
            raise ValueError("min_samples must be positive")
        if lookback_days < 1:
            raise ValueError("lookback_days must be positive")
        self.csv_path = Path(csv_path)
        self.min_samples = min_samples
        self.lookback_days = lookback_days
        self.source = source or f"csv:{self.csv_path.name}"
        if not self.csv_path.is_file():
            raise FileNotFoundError(f"historical delay data not found: {self.csv_path}")

        if self.csv_path.suffix.lower() == ".parquet":
            try:
                frame = pd.read_parquet(self.csv_path)
            except ImportError as exc:
                raise RuntimeError(
                    "Parquet input requires the 'benchmark' optional dependencies"
                ) from exc
        else:
            frame = pd.read_csv(self.csv_path, dtype=object)
        missing = REQUIRED_COLUMNS.difference(frame.columns)
        if missing:
            raise HistoricalDataQualityError(
                f"historical CSV is missing columns: {', '.join(sorted(missing))}"
            )

        valid: list[HistoricalFlightObservation] = []
        rejection_reasons: list[str] = []
        for row_number, (_, row) in enumerate(frame.iterrows(), start=2):
            try:
                scheduled_arrival = _parse_utc(
                    row["scheduled_arrival"], "scheduled_arrival"
                )
                scheduled_departure_raw = _optional(row["scheduled_departure"])
                observation = HistoricalFlightObservation(
                    flight_number=normalize_flight_number(
                        _optional(row["flight_number"])
                    ),
                    carrier=normalize_carrier(_optional(row["carrier"])),
                    origin=normalize_airport_code(row["origin"]),
                    destination=normalize_airport_code(row["destination"]),
                    scheduled_departure=(
                        _parse_utc(scheduled_departure_raw, "scheduled_departure")
                        if scheduled_departure_raw is not None
                        else None
                    ),
                    scheduled_arrival=scheduled_arrival,
                    actual_arrival=_parse_utc(row["actual_arrival"], "actual_arrival"),
                    arrival_delay_minutes=float(row["arrival_delay_minutes"]),
                    observation_date=scheduled_arrival.date(),
                    source=str(_optional(row.get("source")) or self.source),
                    aircraft_type=_optional(row.get("aircraft_type")),
                    terminal=_optional(row.get("terminal")),
                )
                valid.append(observation)
            except (TypeError, ValueError, ValidationError) as exc:
                rejection_reasons.append(f"row {row_number}: {exc}")

        deduplicated: list[HistoricalFlightObservation] = []
        seen: set[tuple[object, ...]] = set()
        for observation in valid:
            key = (
                observation.flight_number,
                observation.origin,
                observation.destination,
                observation.scheduled_arrival,
                observation.actual_arrival,
            )
            if key not in seen:
                seen.add(key)
                deduplicated.append(observation)
        duplicate_count = len(valid) - len(deduplicated)
        self._observations = tuple(
            sorted(deduplicated, key=lambda item: item.scheduled_arrival)
        )
        self.ingestion_statistics = IngestionStatistics(
            rows_read=len(frame),
            rows_valid=len(self._observations),
            rows_rejected=len(rejection_reasons),
            duplicates_removed=duplicate_count,
            rejection_reasons=rejection_reasons,
        )
        if rejection_reasons:
            message = (
                f"rejected {len(rejection_reasons)} of {len(frame)} historical rows; "
                "inspect provider.ingestion_statistics.rejection_reasons"
            )
            if strict:
                raise HistoricalDataQualityError(message)
            warnings.warn(message, UserWarning, stacklevel=2)
        if duplicate_count:
            warnings.warn(
                f"removed {duplicate_count} duplicate historical observations",
                UserWarning,
                stacklevel=2,
            )
        if not self._observations:
            raise HistoricalDataQualityError("historical CSV contains no valid observations")

    @property
    def observations(self) -> tuple[HistoricalFlightObservation, ...]:
        return self._observations

    def _temporal_candidates(
        self, scheduled_arrival: datetime | None
    ) -> list[HistoricalFlightObservation]:
        if scheduled_arrival is None:
            # Anchor the lookback window to the latest observation itself. The
            # exclusive cutoff is nudged only so that latest record is included;
            # using the nudged cutoff as the window anchor would incorrectly
            # exclude a record exactly ``lookback_days`` before it.
            reference = self._observations[-1].scheduled_arrival
            cutoff = reference + timedelta(microseconds=1)
        else:
            if scheduled_arrival.tzinfo is None or scheduled_arrival.utcoffset() is None:
                raise ValueError("scheduled_arrival must be timezone-aware")
            reference = scheduled_arrival.astimezone(UTC)
            cutoff = reference
        start = reference - timedelta(days=self.lookback_days)
        return [
            item
            for item in self._observations
            if start <= item.scheduled_arrival < cutoff
        ]

    def get_observations(
        self,
        flight_number: str | None,
        carrier: str | None,
        origin: str,
        destination: str,
        scheduled_arrival: datetime | None = None,
    ) -> DelayObservationSet:
        flight_number = normalize_flight_number(flight_number)
        carrier = normalize_carrier(carrier)
        if carrier is None and flight_number is not None:
            carrier = flight_number[:2]
        origin = normalize_airport_code(origin)
        destination = normalize_airport_code(destination)
        temporal = self._temporal_candidates(scheduled_arrival)
        route = [
            item
            for item in temporal
            if item.origin == origin and item.destination == destination
        ]
        levels: list[tuple[MatchLevel, list[HistoricalFlightObservation]]] = []
        if flight_number is not None:
            levels.append(
                (
                    "exact_flight",
                    [item for item in route if item.flight_number == flight_number],
                )
            )
        if carrier is not None:
            levels.append(
                (
                    "carrier_route",
                    [item for item in route if item.carrier == carrier],
                )
            )
        levels.append(("route", route))

        counts = Counter({level: len(items) for level, items in levels})
        for level, items in levels:
            if len(items) >= self.min_samples:
                dates = [item.observation_date for item in items]
                return DelayObservationSet(
                    observations=items,
                    match_level=level,
                    sample_count=len(items),
                    source=self.source,
                    date_start=min(dates),
                    date_end=max(dates),
                )
        details = ", ".join(f"{level}={count}" for level, count in counts.items())
        raise InsufficientHistoryError(
            f"no delay match level has at least {self.min_samples} observations ({details})"
        )

    def get_arrival_delays(
        self, flight_number: str, destination: str
    ) -> NDArray[np.float64]:
        """Compatibility helper for callers that do not have route metadata."""
        normalized_flight = normalize_flight_number(flight_number)
        normalized_destination = normalize_airport_code(destination)
        matches = [
            item.arrival_delay_minutes
            for item in self._observations
            if item.flight_number == normalized_flight
            and item.destination == normalized_destination
        ]
        if not matches:
            raise LookupError(
                f"no arrival delay observations for {flight_number} to {destination}"
            )
        return np.asarray(matches, dtype=np.float64)
