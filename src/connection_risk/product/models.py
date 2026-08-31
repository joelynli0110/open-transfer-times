"""Stable product response contracts, kept separate from engine models."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ConfidenceLevel = Literal["low", "medium", "high"]
ConsumerRiskLevel = Literal["low", "moderate", "high"]
ReasonCode = Literal[
    "INBOUND_DELAY_HISTORY",
    "SHORT_CONNECTION",
    "TERMINAL_CHANGE",
    "PASSPORT_CONTROL",
    "SECURITY_RECHECK",
    "CHECKED_BAGGAGE",
    "SELF_TRANSFER",
    "LOW_DATA_CONFIDENCE",
]
WarningCode = Literal["SELF_TRANSFER", "EXPERIMENTAL_ESTIMATE"]


class ConsumerReason(BaseModel):
    model_config = ConfigDict(frozen=True)

    code: ReasonCode
    label: str
    description: str


class ConsumerWarning(BaseModel):
    model_config = ConfigDict(frozen=True)

    code: WarningCode
    severity: Literal["info", "medium", "high"]
    message: str


class ConsumerConfidence(BaseModel):
    model_config = ConfigDict(frozen=True)

    overall: ConfidenceLevel
    delay: ConfidenceLevel
    transfer: ConfidenceLevel
    summary: str


class TechnicalDetails(BaseModel):
    model_config = ConfigDict(frozen=True)

    time_available_until_deadline_minutes: float
    expected_transfer_minutes: float
    practical_buffer_minutes: float
    transfer_p90_minutes: float
    outbound_deadline_minutes: float
    delay_sample_count: int | None = Field(default=None, ge=0)
    delay_match_level: str | None = None
    delay_data_source: str | None = None
    transfer_profile: str | None = None


class ConsumerRiskResponse(BaseModel):
    """Frontend-independent response suitable for web and future extensions."""

    model_config = ConfigDict(frozen=True)

    risk_score: int = Field(ge=0, le=100)
    miss_probability: float = Field(ge=0, le=1)
    risk_level: ConsumerRiskLevel
    headline: str
    scheduled_connection_minutes: int = Field(ge=0)
    recommended_connection_minutes: int | None = Field(default=None, ge=0)
    recommendation_basis: str | None = None
    confidence: ConsumerConfidence
    reasons: list[ConsumerReason]
    warnings: list[ConsumerWarning]
    technical_details: TechnicalDetails
    experimental: bool = True
    data_notice: str
