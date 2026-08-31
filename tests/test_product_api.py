from datetime import datetime, timedelta

from fastapi.testclient import TestClient
import numpy as np
import pytest

from connection_risk.api.app import create_app
from connection_risk.engine import RiskEngine
from connection_risk.flight_data import ScheduledFlight
from connection_risk.models import Connection, FlightLeg, PassengerProfile
from connection_risk.product import ConsumerRiskResponse, interpret_risk_result
from connection_risk.providers.base import DelayProvider


class FixedDelayProvider(DelayProvider):
    def __init__(self, delays):
        self.delays = np.asarray(delays, dtype=float)

    def get_arrival_delays(self, flight_number: str, destination: str):
        return self.delays.copy()


class FailingDelayProvider(DelayProvider):
    def get_arrival_delays(self, flight_number: str, destination: str):
        raise RuntimeError("private implementation failure")


class FixedScheduleProvider:
    def find_flights(self, flight_number, flight_date):
        if flight_number == "W62316":
            return [
                ScheduledFlight(
                    flight_number="W62316",
                    airline_iata="W6",
                    origin="BER",
                    destination="BUD",
                    scheduled_departure=datetime(2026, 9, 20, 8, 0),
                    scheduled_arrival=datetime(2026, 9, 20, 10, 0),
                    arrival_terminal="2A",
                )
            ]
        if flight_number == "MU8640":
            return [
                ScheduledFlight(
                    flight_number="MU8640",
                    airline_iata="MU",
                    origin="BUD",
                    destination="PVG",
                    scheduled_departure=datetime(2026, 9, 20, 11, 35),
                    scheduled_arrival=datetime(2026, 9, 20, 23, 0),
                    departure_terminal="2B",
                )
            ]
        return []


def make_connection(minutes=95, **passenger_overrides):
    arrival = datetime(2026, 9, 20, 10, 0)
    passenger = {
        "checked_baggage": True,
        "self_transfer": True,
        "schengen_to_non_schengen": True,
        "requires_terminal_change": False,
    }
    passenger.update(passenger_overrides)
    return Connection(
        inbound=FlightLeg(
            flight_number="W62316",
            origin="BER",
            destination="BUD",
            scheduled_departure=arrival - timedelta(hours=2),
            scheduled_arrival=arrival,
        ),
        outbound=FlightLeg(
            flight_number="MU8640",
            origin="BUD",
            destination="PVG",
            scheduled_departure=arrival + timedelta(minutes=minutes),
            scheduled_arrival=arrival + timedelta(minutes=minutes + 120),
        ),
        passenger=PassengerProfile(**passenger),
    )


def valid_payload():
    return {
        "connection_airport": "BUD",
        "inbound": {
            "flight_number": "W62316",
            "origin": "BER",
            "scheduled_arrival": "2026-09-20T10:00:00",
        },
        "outbound": {
            "flight_number": "MU8640",
            "destination": "PVG",
            "scheduled_departure": "2026-09-20T11:35:00",
        },
        "checked_baggage": True,
        "self_transfer": True,
        "terminal_change": False,
        "transfer_context": {"schengen_to_non_schengen": True},
    }


@pytest.fixture
def fixed_engine():
    return RiskEngine(FixedDelayProvider([-5, 0, 10, 25, 45, 80] * 20))


def test_product_interpretation_is_structured_and_preserves_probability(fixed_engine):
    connection = make_connection()
    engine_result = fixed_engine.analyze(connection, random_seed=42)
    product = interpret_risk_result(connection, engine_result)
    assert isinstance(product, ConsumerRiskResponse)
    assert product.miss_probability == engine_result.miss_probability
    assert product.risk_score == round(engine_result.miss_probability * 100)
    assert product.recommended_connection_minutes % 15 == 0
    assert product.recommended_connection_minutes >= 45 + engine_result.transfer_p90_minutes
    codes = {reason.code for reason in product.reasons}
    assert {"CHECKED_BAGGAGE", "SELF_TRANSFER", "PASSPORT_CONTROL"} <= codes
    assert product.warnings[0].code == "SELF_TRANSFER"
    assert product.confidence.transfer == "low"
    assert product.confidence.overall == "low"


def test_product_interpretation_omits_inapplicable_self_transfer_claims(fixed_engine):
    connection = make_connection(
        self_transfer=False,
        checked_baggage=False,
        schengen_to_non_schengen=False,
    )
    result = fixed_engine.analyze(connection, random_seed=1)
    product = interpret_risk_result(connection, result)
    assert all(item.code != "SELF_TRANSFER" for item in product.reasons)
    assert all(item.code != "SELF_TRANSFER" for item in product.warnings)


def test_health_and_frontend_are_served(fixed_engine):
    client = TestClient(create_app(fixed_engine))
    health = client.get("/health")
    assert health.status_code == 200
    assert health.json()["data_mode"] == "demonstration"
    page = client.get("/")
    assert page.status_code == 200
    assert "Will I make my connection?" in page.text
    assert client.get("/static/app.js").status_code == 200
    assert 'id="origin"' not in page.text
    assert 'id="terminal-change"' not in page.text
    assert 'id="self-transfer"' not in page.text
    assert 'id="flight-date"' in page.text
    preflight = client.options(
        "/v1/analyze",
        headers={
            "Origin": "chrome-extension://abcdefghijklmnopqrstuvwxzyabcdef",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"].startswith(
        "chrome-extension://"
    )


def test_valid_api_request_returns_consumer_contract(fixed_engine):
    client = TestClient(create_app(fixed_engine))
    response = client.post("/v1/analyze", json=valid_payload())
    assert response.status_code == 200
    body = response.json()
    assert 0 <= body["risk_score"] <= 100
    assert body["headline"] in {
        "Comfortable connection",
        "Tight connection",
        "Risky connection",
    }
    assert body["scheduled_connection_minutes"] == 95
    assert body["confidence"]["delay"] in {"low", "medium", "high"}
    assert any(item["code"] == "SELF_TRANSFER" for item in body["warnings"])
    assert body["experimental"] is True


def test_minimal_itinerary_request_uses_resolved_real_schedule(fixed_engine):
    client = TestClient(create_app(fixed_engine, FixedScheduleProvider()))
    response = client.post(
        "/v1/analyze-itinerary",
        json={
            "inbound_flight_number": "w6 2316",
            "outbound_flight_number": "mu8640",
            "flight_date": "2026-09-20",
            "checked_baggage": True,
            "schengen_exit_required": True,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["itinerary"]["origin"] == "BER"
    assert body["itinerary"]["connection_airport"] == "BUD"
    assert body["itinerary"]["destination"] == "PVG"
    assert body["itinerary"]["terminal_change"] is True
    assert body["itinerary"]["terminal_change_known"] is True
    assert body["itinerary"]["self_transfer"] is True
    assert body["assessment"]["scheduled_connection_minutes"] == 95


@pytest.mark.parametrize(
    ("mutate", "expected_text"),
    [
        (lambda payload: payload.update(connection_airport="XX"), "connection_airport"),
        (
            lambda payload: payload["inbound"].update(flight_number="!"),
            "flight_number",
        ),
        (
            lambda payload: payload["outbound"].update(
                scheduled_departure="2026-09-20T09:00:00"
            ),
            "outbound departure",
        ),
    ],
)
def test_invalid_api_input_returns_useful_validation_error(
    fixed_engine, mutate, expected_text
):
    client = TestClient(create_app(fixed_engine))
    payload = valid_payload()
    mutate(payload)
    response = client.post("/v1/analyze", json=payload)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert expected_text in response.json()["error"]["message"]


def test_unsupported_airport_and_delay_data_have_stable_errors():
    default_client = TestClient(create_app())
    airport_payload = valid_payload()
    airport_payload["connection_airport"] = "XXX"
    airport_response = default_client.post("/v1/analyze", json=airport_payload)
    assert airport_response.status_code == 404
    assert airport_response.json()["error"]["code"] == "UNSUPPORTED_AIRPORT"

    delay_payload = valid_payload()
    delay_payload["inbound"]["flight_number"] = "ZZ999"
    delay_response = default_client.post("/v1/analyze", json=delay_payload)
    assert delay_response.status_code == 404
    assert delay_response.json()["error"]["code"] == "UNSUPPORTED_DELAY_DATA"


def test_unexpected_failure_does_not_expose_stack_or_exception_message():
    client = TestClient(
        create_app(RiskEngine(FailingDelayProvider())), raise_server_exceptions=False
    )
    response = client.post("/v1/analyze", json=valid_payload())
    assert response.status_code == 500
    serialized = response.text.lower()
    assert "private implementation failure" not in serialized
    assert "traceback" not in serialized


def test_default_api_exercises_real_existing_engine_end_to_end():
    client = TestClient(create_app())
    first = client.post("/v1/analyze", json=valid_payload())
    second = client.post("/v1/analyze", json=valid_payload())
    assert first.status_code == 200
    assert first.json() == second.json()
    assert first.json()["technical_details"]["delay_sample_count"] == 35
