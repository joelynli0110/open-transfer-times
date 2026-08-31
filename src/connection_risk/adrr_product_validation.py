"""Product-facing validation for a locally normalized ADRR dataset."""

from __future__ import annotations

from dataclasses import asdict, dataclass
import json
from pathlib import Path

from .confidence import ConfidenceThresholds, assess_delay_confidence
from .providers.historical_csv import HistoricalCsvDelayProvider


@dataclass(frozen=True)
class RouteValidation:
    origin: str
    destination: str
    supported: bool
    match_level: str | None
    observation_count: int
    confidence: str | None
    source: str | None
    route_level_verified: bool
    message: str | None = None


@dataclass(frozen=True)
class AdrrProductValidationReport:
    dataset: str
    total_observations: int
    source_values: list[str]
    passenger_flight_number_count: int
    exact_flight_matching_available: bool
    routes: list[RouteValidation]

    def to_dict(self) -> dict:
        return asdict(self)

    def write_json(self, path: str | Path) -> None:
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(
            json.dumps(self.to_dict(), indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )


def validate_adrr_for_product(
    dataset: str | Path,
    routes: list[tuple[str, str]],
    *,
    min_samples: int = 30,
    lookback_days: int = 365,
) -> AdrrProductValidationReport:
    """Verify the claims the UI may make without pretending ADRR is live data."""

    provider = HistoricalCsvDelayProvider(
        dataset,
        min_samples=min_samples,
        lookback_days=lookback_days,
        source="eurocontrol_adrr_local",
    )
    observations = provider.observations
    route_reports: list[RouteValidation] = []
    thresholds = ConfidenceThresholds()
    for origin, destination in routes:
        normalized_origin = origin.strip().upper()
        normalized_destination = destination.strip().upper()
        try:
            selected = provider.get_observations(
                flight_number="ZZ9999",
                carrier="ZZ",
                origin=normalized_origin,
                destination=normalized_destination,
                scheduled_arrival=None,
            )
            confidence = assess_delay_confidence(
                selected.sample_count, selected.match_level, thresholds
            ).level
            route_reports.append(
                RouteValidation(
                    origin=normalized_origin,
                    destination=normalized_destination,
                    supported=True,
                    match_level=selected.match_level,
                    observation_count=selected.sample_count,
                    confidence=confidence,
                    source=selected.source,
                    route_level_verified=selected.match_level == "route",
                )
            )
        except LookupError as exc:
            count = sum(
                item.origin == normalized_origin
                and item.destination == normalized_destination
                for item in observations
            )
            route_reports.append(
                RouteValidation(
                    origin=normalized_origin,
                    destination=normalized_destination,
                    supported=False,
                    match_level=None,
                    observation_count=count,
                    confidence=None,
                    source=None,
                    route_level_verified=False,
                    message=str(exc),
                )
            )
    sources = sorted({item.source for item in observations})
    flight_number_count = sum(bool(item.flight_number) for item in observations)
    return AdrrProductValidationReport(
        dataset=str(Path(dataset)),
        total_observations=len(observations),
        source_values=sources,
        passenger_flight_number_count=flight_number_count,
        exact_flight_matching_available=flight_number_count > 0,
        routes=route_reports,
    )


def format_adrr_product_validation(report: AdrrProductValidationReport) -> str:
    lines = [
        "ADRR product validation",
        "=======================",
        f"Dataset: {report.dataset}",
        f"Observations: {report.total_observations:,}",
        f"Record sources: {', '.join(report.source_values) or 'Unavailable'}",
        f"Passenger flight numbers present: {report.passenger_flight_number_count:,}",
        (
            "Exact-flight matching: available"
            if report.exact_flight_matching_available
            else "Exact-flight matching: unavailable (expected for inspected ADRR Flights schema)"
        ),
        "",
        "Routes:",
    ]
    for route in report.routes:
        if route.supported:
            lines.append(
                f"- {route.origin}-{route.destination}: {route.match_level}, "
                f"n={route.observation_count}, confidence={route.confidence}, "
                f"source={route.source}"
            )
        else:
            lines.append(
                f"- {route.origin}-{route.destination}: unsupported, "
                f"available route rows={route.observation_count} ({route.message})"
            )
    return "\n".join(lines)
