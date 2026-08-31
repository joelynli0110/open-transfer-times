from datetime import datetime, timedelta

import numpy as np
import pytest
from pydantic import ValidationError

from connection_risk.confidence import classify_confidence
from connection_risk.engine import RiskEngine, classify_risk
from connection_risk.models import Connection, FlightLeg, PassengerProfile
from connection_risk.providers.base import DelayProvider
from connection_risk.simulation import simulate_connection
from connection_risk.transfer import (
    AirportProfileNotFoundError,
    TransferProfileStore,
    lognormal_from_median_p90,
)


class FixedDelayProvider(DelayProvider):
    def __init__(self, delays):
        self.delays = np.asarray(delays, dtype=float)

    def get_arrival_delays(self, flight_number: str, destination: str):
        return self.delays.copy()


def make_connection(minutes=120, **passenger_overrides):
    arrival = datetime(2026, 9, 20, 10, 0)
    passenger = {
        "checked_baggage": False,
        "self_transfer": False,
        "schengen_to_non_schengen": False,
        "requires_terminal_change": False,
    }
    passenger.update(passenger_overrides)
    return Connection(
        inbound=FlightLeg(
            flight_number="W62316",
            origin="BER",
            destination="BUD",
            scheduled_departure=arrival - timedelta(hours=1, minutes=30),
            scheduled_arrival=arrival,
        ),
        outbound=FlightLeg(
            flight_number="MU8640",
            origin="BUD",
            destination="PVG",
            scheduled_departure=arrival + timedelta(minutes=minutes),
            scheduled_arrival=arrival + timedelta(minutes=minutes + 600),
        ),
        passenger=PassengerProfile(**passenger),
    )


@pytest.fixture
def engine():
    delays = np.array([-5, 0, 5, 10, 20, 35, 50, 80] * 15)
    return RiskEngine(FixedDelayProvider(delays))


def test_longer_connections_reduce_miss_probability(engine):
    short = engine.analyze(make_connection(90), random_seed=7)
    long = engine.analyze(make_connection(180), random_seed=7)
    assert long.miss_probability < short.miss_probability


@pytest.mark.parametrize(
    "attribute",
    [
        "checked_baggage",
        "self_transfer",
        "schengen_to_non_schengen",
        "requires_terminal_change",
    ],
)
def test_added_transfer_component_increases_miss_probability(engine, attribute):
    baseline = engine.analyze(make_connection(105), random_seed=19)
    increased = engine.analyze(
        make_connection(105, **{attribute: True}), random_seed=19
    )
    assert increased.miss_probability > baseline.miss_probability


def test_identical_seed_produces_identical_result(engine):
    first = engine.analyze(make_connection(100, self_transfer=True), random_seed=123)
    second = engine.analyze(make_connection(100, self_transfer=True), random_seed=123)
    assert first == second


def test_missing_airport_profile_raises_clear_error(engine):
    connection = make_connection().model_copy(
        update={
            "inbound": make_connection().inbound.model_copy(update={"destination": "XXX"}),
            "outbound": make_connection().outbound.model_copy(update={"origin": "XXX"}),
        }
    )
    with pytest.raises(AirportProfileNotFoundError, match="XXX"):
        engine.analyze(connection)


def test_insufficient_history_has_low_confidence():
    engine = RiskEngine(FixedDelayProvider([0, 5, 10]))
    assert engine.analyze(make_connection(), random_seed=1).confidence == "low"
    assert classify_confidence(30) == "medium"
    assert classify_confidence(100) == "high"


def test_invalid_itinerary_is_rejected():
    with pytest.raises(ValidationError, match="outbound departure"):
        make_connection(minutes=-5)


def test_probability_is_always_bounded(engine):
    for minutes in (46, 90, 300):
        probability = engine.analyze(
            make_connection(minutes), n_simulations=2_000, random_seed=2
        ).miss_probability
        assert 0 <= probability <= 1


def test_lognormal_conversion_reproduces_quantiles():
    distribution = lognormal_from_median_p90(10, 25)
    assert distribution.ppf(0.5) == pytest.approx(10)
    assert distribution.ppf(0.9) == pytest.approx(25)


def test_threshold_boundaries():
    assert classify_risk(0.049) == "low"
    assert classify_risk(0.05) == "moderate"
    assert classify_risk(0.15) == "high"


def test_simulation_rejects_empty_delay_data():
    connection = make_connection()
    model = TransferProfileStore().get_model("BUD", connection.passenger)
    with pytest.raises(ValueError, match="non-empty"):
        simulate_connection(connection, [], model)

