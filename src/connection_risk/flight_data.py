"""Live flight schedule lookup used by the consumer web flow."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
import json
import os
import re
from typing import Any, Protocol
from urllib.parse import urlencode
from urllib.request import Request, urlopen


class FlightDataError(RuntimeError):
    """Base error for failures that are safe to translate at the API boundary."""


class FlightDataNotConfiguredError(FlightDataError):
    pass


class FlightNotFoundError(FlightDataError):
    pass


class InvalidConnectionError(FlightDataError):
    pass


@dataclass(frozen=True)
class ScheduledFlight:
    flight_number: str
    airline_iata: str
    origin: str
    destination: str
    scheduled_departure: datetime
    scheduled_arrival: datetime
    departure_terminal: str | None = None
    arrival_terminal: str | None = None


@dataclass(frozen=True)
class ResolvedItinerary:
    inbound: ScheduledFlight
    outbound: ScheduledFlight
    self_transfer: bool
    self_transfer_basis: str
    terminal_change: bool
    terminal_change_known: bool


class FlightScheduleProvider(Protocol):
    def find_flights(self, flight_number: str, flight_date: date) -> list[ScheduledFlight]: ...


def normalize_flight_number(value: str) -> str:
    return re.sub(r"[\s-]+", "", value).upper()


class AviationstackScheduleProvider:
    """Aviationstack adapter. Credentials stay server-side."""

    endpoint = "https://api.aviationstack.com/v1/flights"

    def __init__(self, api_key: str | None = None, timeout_seconds: float = 12.0):
        self.api_key = api_key or os.getenv("AVIATIONSTACK_API_KEY")
        self.timeout_seconds = timeout_seconds

    @staticmethod
    def _parse_time(value: Any) -> datetime:
        if not isinstance(value, str) or not value:
            raise ValueError("missing scheduled time")
        return datetime.fromisoformat(value.replace("Z", "+00:00"))

    def find_flights(self, flight_number: str, flight_date: date) -> list[ScheduledFlight]:
        if not self.api_key:
            raise FlightDataNotConfiguredError(
                "Live flight lookup is not configured. Set AVIATIONSTACK_API_KEY."
            )
        normalized = normalize_flight_number(flight_number)
        query = urlencode(
            {
                "access_key": self.api_key,
                "flight_iata": normalized,
                "flight_date": flight_date.isoformat(),
                "limit": 100,
            }
        )
        request = Request(f"{self.endpoint}?{query}", headers={"Accept": "application/json"})
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                payload = json.load(response)
        except FlightDataError:
            raise
        except Exception as exc:
            raise FlightDataError("The live flight data service is unavailable.") from exc
        if payload.get("error"):
            raise FlightDataError("The live flight data service rejected the lookup.")

        matches: list[ScheduledFlight] = []
        for item in payload.get("data", []):
            departure = item.get("departure") or {}
            arrival = item.get("arrival") or {}
            flight = item.get("flight") or {}
            airline = item.get("airline") or {}
            try:
                matches.append(
                    ScheduledFlight(
                        flight_number=normalize_flight_number(flight.get("iata") or normalized),
                        airline_iata=(airline.get("iata") or normalized[:2]).upper(),
                        origin=departure["iata"].upper(),
                        destination=arrival["iata"].upper(),
                        scheduled_departure=self._parse_time(departure.get("scheduled")),
                        scheduled_arrival=self._parse_time(arrival.get("scheduled")),
                        departure_terminal=departure.get("terminal"),
                        arrival_terminal=arrival.get("terminal"),
                    )
                )
            except (KeyError, TypeError, ValueError):
                continue
        if not matches:
            raise FlightNotFoundError(f"No real schedule was found for {normalized} on {flight_date}.")
        return matches


def resolve_connection(
    provider: FlightScheduleProvider,
    inbound_number: str,
    outbound_number: str,
    flight_date: date,
) -> ResolvedItinerary:
    """Choose the chronologically valid pair that shares a connection airport."""

    inbound_options = provider.find_flights(inbound_number, flight_date)
    outbound_options: list[ScheduledFlight] = []
    for candidate_date in (flight_date, flight_date + timedelta(days=1)):
        try:
            outbound_options.extend(provider.find_flights(outbound_number, candidate_date))
        except FlightNotFoundError:
            pass

    candidates = [
        (first, second)
        for first in inbound_options
        for second in outbound_options
        if first.destination == second.origin
        and second.scheduled_departure > first.scheduled_arrival
        and second.scheduled_departure - first.scheduled_arrival <= timedelta(hours=24)
    ]
    if not candidates:
        raise InvalidConnectionError(
            "The two real flight schedules do not form a connection within 24 hours."
        )
    inbound, outbound = min(
        candidates, key=lambda pair: pair[1].scheduled_departure - pair[0].scheduled_arrival
    )

    # Ticket protection is not published in flight schedules. Different marketing
    # carriers are therefore treated conservatively as a likely self-transfer.
    different_carriers = inbound.airline_iata != outbound.airline_iata
    self_transfer_basis = (
        "Different marketing carriers; treated conservatively as self-transfer. "
        "Only the booking/PNR can confirm ticket protection."
        if different_carriers
        else "Same marketing carrier; treated as protected. Confirm if booked separately."
    )
    terminals_known = bool(inbound.arrival_terminal and outbound.departure_terminal)
    terminal_change = terminals_known and (
        inbound.arrival_terminal.casefold() != outbound.departure_terminal.casefold()
    )
    return ResolvedItinerary(
        inbound=inbound,
        outbound=outbound,
        self_transfer=different_carriers,
        self_transfer_basis=self_transfer_basis,
        terminal_change=terminal_change,
        terminal_change_known=terminals_known,
    )
