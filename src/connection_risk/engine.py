"""Risk-engine orchestration and configurable classification."""

from dataclasses import dataclass, field
from typing import Literal

from .confidence import (
    ConfidenceThresholds,
    assess_delay_confidence,
    assess_transfer_confidence,
)
from .delay_distribution import summarize_delays
from .models import Connection, RiskResult
from .providers.base import DelayProvider
from .recovery import build_risk_factors
from .simulation import simulate_connection
from .transfer import TransferProfileStore

RiskLevel = Literal["low", "moderate", "high"]


@dataclass(frozen=True)
class RiskThresholds:
    moderate_probability: float = 0.05
    high_probability: float = 0.15

    def __post_init__(self) -> None:
        if not 0 <= self.moderate_probability < self.high_probability <= 1:
            raise ValueError("risk thresholds must satisfy 0 <= moderate < high <= 1")


def classify_risk(
    probability: float, thresholds: RiskThresholds | None = None
) -> RiskLevel:
    thresholds = thresholds or RiskThresholds()
    if not 0 <= probability <= 1:
        raise ValueError("probability must lie in [0, 1]")
    if probability >= thresholds.high_probability:
        return "high"
    if probability >= thresholds.moderate_probability:
        return "moderate"
    return "low"


@dataclass
class RiskEngine:
    delay_provider: DelayProvider
    transfer_profiles: TransferProfileStore = field(default_factory=TransferProfileStore)
    outbound_deadline_minutes: float = 45.0
    risk_thresholds: RiskThresholds = field(default_factory=RiskThresholds)
    confidence_thresholds: ConfidenceThresholds = field(
        default_factory=ConfidenceThresholds
    )

    def analyze(
        self,
        connection: Connection,
        n_simulations: int = 50_000,
        random_seed: int | None = None,
    ) -> RiskResult:
        carrier = connection.inbound.flight_number.replace(" ", "").upper()[:2]
        try:
            observation_set = self.delay_provider.get_observations(
                flight_number=connection.inbound.flight_number,
                carrier=carrier,
                origin=connection.inbound.origin,
                destination=connection.inbound.destination,
                scheduled_arrival=connection.inbound.scheduled_arrival,
            )
        except NotImplementedError:
            observation_set = None
        if observation_set is None:
            delays = self.delay_provider.get_arrival_delays(
                connection.inbound.flight_number, connection.inbound.destination
            )
            match_level = "exact_flight"
            data_source = getattr(
                self.delay_provider,
                "source",
                self.delay_provider.__class__.__name__,
            )
        else:
            delays = observation_set.delay_minutes()
            match_level = observation_set.match_level
            data_source = observation_set.source
        transfer_model = self.transfer_profiles.get_model(
            connection.inbound.destination, connection.passenger
        )
        simulation = simulate_connection(
            connection=connection,
            delay_samples=delays,
            transfer_model=transfer_model,
            n_simulations=n_simulations,
            random_seed=random_seed,
            outbound_deadline_minutes=self.outbound_deadline_minutes,
        )
        scheduled_connection = (
            connection.outbound.scheduled_departure
            - connection.inbound.scheduled_arrival
        ).total_seconds() / 60.0
        return RiskResult(
            scheduled_connection_minutes=scheduled_connection,
            time_available_until_deadline_minutes=(
                simulation.time_available_until_deadline_minutes
            ),
            expected_transfer_minutes=simulation.transfer_median_minutes,
            practical_buffer_minutes=simulation.practical_buffer_minutes,
            usable_buffer_minutes=simulation.usable_buffer_minutes,
            miss_probability=simulation.miss_probability,
            transfer_median_minutes=simulation.transfer_median_minutes,
            transfer_p90_minutes=simulation.transfer_p90_minutes,
            risk_level=classify_risk(
                simulation.miss_probability, self.risk_thresholds
            ),
            confidence=assess_delay_confidence(
                len(delays), match_level, self.confidence_thresholds
            ).level,
            delay_confidence=assess_delay_confidence(
                len(delays), match_level, self.confidence_thresholds
            ),
            transfer_confidence=assess_transfer_confidence(),
            delay_distribution=summarize_delays(delays),
            risk_factors=build_risk_factors(connection.passenger, delays),
            delay_data_source=str(data_source),
        )
