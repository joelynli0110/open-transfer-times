"""Validated domain models used by the risk engine.

Historical timestamps are normalized to timezone-aware UTC datetimes. Naive
timestamps are rejected because silently guessing their timezone would corrupt
delay calculations and temporal backtests.
"""

from datetime import UTC, date, datetime
import re
from typing import Literal

import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

MatchLevel = Literal["exact_flight", "carrier_route", "route", "peer_group"]
ConfidenceLevel = Literal["low", "medium", "high"]
AIRPORT_CODE_PATTERN = re.compile(r"^[A-Z]{3}$")


class FlightLeg(BaseModel):
    model_config = ConfigDict(frozen=True, str_strip_whitespace=True)

    flight_number: str = Field(min_length=1)
    origin: str = Field(min_length=3, max_length=3)
    destination: str = Field(min_length=3, max_length=3)
    scheduled_departure: datetime
    scheduled_arrival: datetime

    @field_validator("origin", "destination")
    @classmethod
    def uppercase_airport_code(cls, value: str) -> str:
        return value.upper()

    @model_validator(mode="after")
    def validate_schedule(self) -> "FlightLeg":
        if self.scheduled_arrival <= self.scheduled_departure:
            raise ValueError("scheduled arrival must be after scheduled departure")
        return self


class PassengerProfile(BaseModel):
    model_config = ConfigDict(frozen=True)

    checked_baggage: bool
    self_transfer: bool
    schengen_to_non_schengen: bool
    requires_terminal_change: bool = False


class Connection(BaseModel):
    model_config = ConfigDict(frozen=True)

    inbound: FlightLeg
    outbound: FlightLeg
    passenger: PassengerProfile

    @model_validator(mode="after")
    def validate_itinerary(self) -> "Connection":
        if self.inbound.destination != self.outbound.origin:
            raise ValueError("inbound destination must match outbound origin")
        if self.outbound.scheduled_departure <= self.inbound.scheduled_arrival:
            raise ValueError(
                "outbound departure must be after the inbound scheduled arrival"
            )
        return self


class HistoricalFlightObservation(BaseModel):
    """One normalized historical arrival observation.

    All datetimes must carry timezone information and are stored in UTC. The
    supplied delay may differ from the timestamp-derived delay by at most one
    minute to allow normal source-data rounding.
    """

    model_config = ConfigDict(frozen=True, str_strip_whitespace=True)

    flight_number: str | None = None
    carrier: str | None = None
    origin: str
    destination: str
    scheduled_departure: datetime | None = None
    scheduled_arrival: datetime
    actual_arrival: datetime
    arrival_delay_minutes: float = Field(ge=-720.0, le=2880.0)
    observation_date: date
    source: str = Field(min_length=1)
    aircraft_type: str | None = None
    terminal: str | None = None

    @field_validator("origin", "destination")
    @classmethod
    def validate_airport(cls, value: str) -> str:
        normalized = value.strip().upper()
        if not AIRPORT_CODE_PATTERN.fullmatch(normalized):
            raise ValueError("airport codes must be exactly three ASCII letters")
        return normalized

    @field_validator("flight_number")
    @classmethod
    def normalize_flight_number(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        normalized = re.sub(r"[\s-]+", "", value).upper()
        if not re.fullmatch(r"[A-Z0-9]{2,8}", normalized):
            raise ValueError("flight_number has an invalid format")
        return normalized

    @field_validator("carrier")
    @classmethod
    def normalize_carrier(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        normalized = value.strip().upper()
        if not re.fullmatch(r"[A-Z0-9]{2,3}", normalized):
            raise ValueError("carrier has an invalid format")
        return normalized

    @field_validator("scheduled_departure", "scheduled_arrival", "actual_arrival")
    @classmethod
    def normalize_datetime_utc(cls, value: datetime | None) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("historical timestamps must be timezone-aware")
        return value.astimezone(UTC)

    @model_validator(mode="after")
    def validate_observation(self) -> "HistoricalFlightObservation":
        if self.origin == self.destination:
            raise ValueError("origin and destination must differ")
        if (
            self.scheduled_departure is not None
            and self.scheduled_departure >= self.scheduled_arrival
        ):
            raise ValueError("scheduled departure must precede scheduled arrival")
        calculated = (
            self.actual_arrival - self.scheduled_arrival
        ).total_seconds() / 60.0
        if abs(calculated - self.arrival_delay_minutes) > 1.0:
            raise ValueError(
                "arrival_delay_minutes is inconsistent with arrival timestamps"
            )
        return self


class DelayObservationSet(BaseModel):
    model_config = ConfigDict(frozen=True)

    observations: list[HistoricalFlightObservation]
    match_level: MatchLevel
    sample_count: int = Field(ge=0)
    source: str
    date_start: date | None = None
    date_end: date | None = None

    @model_validator(mode="after")
    def validate_metadata(self) -> "DelayObservationSet":
        if self.sample_count != len(self.observations):
            raise ValueError("sample_count must equal the number of observations")
        if self.date_start and self.date_end and self.date_start > self.date_end:
            raise ValueError("date_start cannot be after date_end")
        return self

    def delay_minutes(self) -> NDArray[np.float64]:
        return np.asarray(
            [item.arrival_delay_minutes for item in self.observations],
            dtype=np.float64,
        )


class DelayDistributionSummary(BaseModel):
    model_config = ConfigDict(frozen=True)

    sample_count: int = Field(ge=1)
    mean: float
    median: float
    std: float = Field(ge=0)
    p75: float
    p90: float
    p95: float


class DelayModelConfidence(BaseModel):
    model_config = ConfigDict(frozen=True)

    level: ConfidenceLevel
    sample_count: int = Field(ge=0)
    match_level: MatchLevel
    reasons: list[str]


class TransferModelConfidence(BaseModel):
    model_config = ConfigDict(frozen=True)

    level: ConfidenceLevel = "low"
    reasons: list[str]


class RiskResult(BaseModel):
    model_config = ConfigDict(frozen=True)

    @model_validator(mode="before")
    @classmethod
    def populate_compatibility_buffer_fields(cls, value: object) -> object:
        """Accept both the V0.1 and V0.2 buffer field sets."""
        if not isinstance(value, dict):
            return value
        data = dict(value)
        if "time_available_until_deadline_minutes" not in data and "usable_buffer_minutes" in data:
            data["time_available_until_deadline_minutes"] = data["usable_buffer_minutes"]
        if "usable_buffer_minutes" not in data and "time_available_until_deadline_minutes" in data:
            data["usable_buffer_minutes"] = data["time_available_until_deadline_minutes"]
        if "expected_transfer_minutes" not in data and "transfer_median_minutes" in data:
            data["expected_transfer_minutes"] = data["transfer_median_minutes"]
        if (
            "practical_buffer_minutes" not in data
            and "time_available_until_deadline_minutes" in data
            and "expected_transfer_minutes" in data
        ):
            data["practical_buffer_minutes"] = (
                data["time_available_until_deadline_minutes"]
                - data["expected_transfer_minutes"]
            )
        return data

    scheduled_connection_minutes: float
    time_available_until_deadline_minutes: float
    expected_transfer_minutes: float
    practical_buffer_minutes: float
    usable_buffer_minutes: float = Field(
        description=(
            "Deprecated alias for time_available_until_deadline_minutes; "
            "retained for V0.1 compatibility."
        ),
        deprecated=True,
    )
    miss_probability: float = Field(ge=0.0, le=1.0)
    transfer_median_minutes: float = Field(ge=0.0)
    transfer_p90_minutes: float = Field(ge=0.0)
    risk_level: Literal["low", "moderate", "high"]
    confidence: Literal["low", "medium", "high"]
    delay_confidence: DelayModelConfidence | None = None
    transfer_confidence: TransferModelConfidence | None = None
    delay_distribution: DelayDistributionSummary | None = None
    risk_factors: list[str]
    delay_data_source: str | None = None
