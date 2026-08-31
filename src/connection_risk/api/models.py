"""Versioned API request models and domain conversion."""

from datetime import date, datetime, timedelta
import re

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from ..models import Connection, FlightLeg, PassengerProfile

AIRPORT_PATTERN = re.compile(r"^[A-Z]{3}$")
FLIGHT_PATTERN = re.compile(r"^[A-Z0-9]{2,8}$")


class InboundRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    flight_number: str
    origin: str
    scheduled_arrival: datetime

    @field_validator("flight_number")
    @classmethod
    def normalize_flight(cls, value: str) -> str:
        normalized = re.sub(r"[\s-]+", "", value).upper()
        if not FLIGHT_PATTERN.fullmatch(normalized):
            raise ValueError("flight_number must contain 2-8 letters or digits")
        return normalized

    @field_validator("origin")
    @classmethod
    def normalize_airport(cls, value: str) -> str:
        normalized = value.upper()
        if not AIRPORT_PATTERN.fullmatch(normalized):
            raise ValueError("origin must be a three-letter IATA airport code")
        return normalized


class OutboundRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    flight_number: str
    destination: str
    scheduled_departure: datetime

    @field_validator("flight_number")
    @classmethod
    def normalize_flight(cls, value: str) -> str:
        normalized = re.sub(r"[\s-]+", "", value).upper()
        if not FLIGHT_PATTERN.fullmatch(normalized):
            raise ValueError("flight_number must contain 2-8 letters or digits")
        return normalized

    @field_validator("destination")
    @classmethod
    def normalize_airport(cls, value: str) -> str:
        normalized = value.upper()
        if not AIRPORT_PATTERN.fullmatch(normalized):
            raise ValueError("destination must be a three-letter IATA airport code")
        return normalized


class TransferContextRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schengen_to_non_schengen: bool = False


class AnalyzeRequest(BaseModel):
    """Small API contract aligned with the schedule fields the engine needs."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    connection_airport: str
    inbound: InboundRequest
    outbound: OutboundRequest
    checked_baggage: bool = False
    self_transfer: bool = False
    terminal_change: bool = False
    transfer_context: TransferContextRequest = Field(
        default_factory=TransferContextRequest
    )

    @field_validator("connection_airport")
    @classmethod
    def normalize_airport(cls, value: str) -> str:
        normalized = value.upper()
        if not AIRPORT_PATTERN.fullmatch(normalized):
            raise ValueError(
                "connection_airport must be a three-letter IATA airport code"
            )
        return normalized

    @model_validator(mode="after")
    def validate_connection_schedule(self) -> "AnalyzeRequest":
        arrival = self.inbound.scheduled_arrival
        departure = self.outbound.scheduled_departure
        arrival_aware = arrival.tzinfo is not None and arrival.utcoffset() is not None
        departure_aware = departure.tzinfo is not None and departure.utcoffset() is not None
        if arrival_aware != departure_aware:
            raise ValueError(
                "arrival and departure must both include timezone offsets or both omit them"
            )
        connection_minutes = (departure - arrival).total_seconds() / 60.0
        if connection_minutes <= 0:
            raise ValueError("outbound departure must be after inbound arrival")
        if connection_minutes > 24 * 60:
            raise ValueError("connection time cannot exceed 24 hours")
        return self

    def to_connection(self) -> Connection:
        arrival = self.inbound.scheduled_arrival
        departure = self.outbound.scheduled_departure
        return Connection(
            inbound=FlightLeg(
                flight_number=self.inbound.flight_number,
                origin=self.inbound.origin,
                destination=self.connection_airport,
                scheduled_departure=arrival - timedelta(hours=2),
                scheduled_arrival=arrival,
            ),
            outbound=FlightLeg(
                flight_number=self.outbound.flight_number,
                origin=self.connection_airport,
                destination=self.outbound.destination,
                scheduled_departure=departure,
                scheduled_arrival=departure + timedelta(hours=2),
            ),
            passenger=PassengerProfile(
                checked_baggage=self.checked_baggage,
                self_transfer=self.self_transfer,
                schengen_to_non_schengen=(
                    self.transfer_context.schengen_to_non_schengen
                ),
                requires_terminal_change=self.terminal_change,
            ),
        )


class ItineraryAnalyzeRequest(BaseModel):
    """Minimal consumer input; schedule and route fields come from live data."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    inbound_flight_number: str
    outbound_flight_number: str
    flight_date: date
    checked_baggage: bool = False
    schengen_exit_required: bool = False

    @field_validator("inbound_flight_number", "outbound_flight_number")
    @classmethod
    def normalize_flight(cls, value: str) -> str:
        normalized = re.sub(r"[\s-]+", "", value).upper()
        if not FLIGHT_PATTERN.fullmatch(normalized):
            raise ValueError("flight number must contain 2-8 letters or digits")
        return normalized


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    data_mode: str


class ErrorDetail(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    error: ErrorDetail
