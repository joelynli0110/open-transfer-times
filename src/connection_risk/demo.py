"""Central deterministic fixtures for the UX-first flight-shopping playground.

Schedules, fares, and flight identities below are illustrative product fixtures,
not live offers. Risk values are always computed by the configured RiskEngine.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from .models import Connection, FlightLeg, PassengerProfile


@dataclass(frozen=True)
class DemoItinerary:
    id: str
    scenario: str
    airline: str
    price_eur: int
    inbound: FlightLeg
    outbound: FlightLeg
    passenger: PassengerProfile
    separate_tickets: bool
    safer_option_id: str | None = None
    featured: bool = False

    def to_connection(self) -> Connection:
        return Connection(
            inbound=self.inbound,
            outbound=self.outbound,
            passenger=self.passenger,
        )


def _leg(number: str, origin: str, destination: str, departure: str, arrival: str) -> FlightLeg:
    return FlightLeg(
        flight_number=number,
        origin=origin,
        destination=destination,
        scheduled_departure=datetime.fromisoformat(departure),
        scheduled_arrival=datetime.fromisoformat(arrival),
    )


DEMO_ITINERARIES: tuple[DemoItinerary, ...] = (
    DemoItinerary(
        id="protected-comfortable",
        scenario="Protected connection · comfortable buffer",
        airline="Turkish Airlines",
        price_eur=552,
        inbound=_leg("TK1722", "BER", "IST", "2026-09-20T11:20", "2026-09-20T15:20"),
        outbound=_leg("TK26", "IST", "PVG", "2026-09-20T18:35", "2026-09-21T09:40"),
        passenger=PassengerProfile(
            checked_baggage=False,
            self_transfer=False,
            schengen_to_non_schengen=True,
            requires_terminal_change=False,
        ),
        separate_tickets=False,
        featured=True,
    ),
    DemoItinerary(
        id="protected-tight",
        scenario="Protected connection · tight buffer",
        airline="Turkish Airlines",
        price_eur=518,
        inbound=_leg("TK1722", "BER", "IST", "2026-09-20T11:20", "2026-09-20T15:20"),
        outbound=_leg("TK26", "IST", "PVG", "2026-09-20T18:05", "2026-09-21T09:10"),
        passenger=PassengerProfile(
            checked_baggage=False,
            self_transfer=False,
            schengen_to_non_schengen=True,
            requires_terminal_change=False,
        ),
        separate_tickets=False,
    ),
    DemoItinerary(
        id="self-transfer-high",
        scenario="Self-transfer · lowest fare",
        airline="Wizz Air + China Eastern",
        price_eur=397,
        inbound=_leg("W62316", "BER", "BUD", "2026-09-20T08:30", "2026-09-20T10:00"),
        outbound=_leg("MU8640", "BUD", "PVG", "2026-09-20T12:05", "2026-09-21T05:30"),
        passenger=PassengerProfile(
            checked_baggage=True,
            self_transfer=True,
            schengen_to_non_schengen=True,
            requires_terminal_change=False,
        ),
        separate_tickets=True,
        safer_option_id="self-transfer-safer",
    ),
    DemoItinerary(
        id="self-transfer-safer",
        scenario="Self-transfer · safer buffer",
        airline="Wizz Air + China Eastern",
        price_eur=445,
        inbound=_leg("W62316", "BER", "BUD", "2026-09-20T08:30", "2026-09-20T10:00"),
        outbound=_leg("MU8640", "BUD", "PVG", "2026-09-20T15:00", "2026-09-21T08:25"),
        passenger=PassengerProfile(
            checked_baggage=True,
            self_transfer=True,
            schengen_to_non_schengen=True,
            requires_terminal_change=False,
        ),
        separate_tickets=True,
        featured=True,
    ),
    DemoItinerary(
        id="low-confidence",
        scenario="Limited historical evidence",
        airline="Turkish Airlines",
        price_eur=489,
        inbound=_leg("TK1724", "BER", "IST", "2026-09-20T14:10", "2026-09-20T18:10"),
        outbound=_leg("TK26", "IST", "PVG", "2026-09-20T22:10", "2026-09-21T13:15"),
        passenger=PassengerProfile(
            checked_baggage=False,
            self_transfer=False,
            schengen_to_non_schengen=True,
            requires_terminal_change=False,
        ),
        separate_tickets=False,
    ),
)


def get_demo_itinerary(itinerary_id: str) -> DemoItinerary:
    try:
        return next(item for item in DEMO_ITINERARIES if item.id == itinerary_id)
    except StopIteration as exc:
        raise KeyError(itinerary_id) from exc
