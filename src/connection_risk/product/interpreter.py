"""Deterministic mapping from engine output to traveler-facing information."""

import math

from ..models import Connection, RiskResult
from .models import (
    ConfidenceLevel,
    ConsumerConfidence,
    ConsumerReason,
    ConsumerRiskResponse,
    ConsumerWarning,
    TechnicalDetails,
)

_CONFIDENCE_RANK: dict[ConfidenceLevel, int] = {"low": 0, "medium": 1, "high": 2}
_HEADLINES = {
    "low": "Comfortable connection",
    "moderate": "Tight connection",
    "high": "Risky connection",
}


def _round_up(value: float, increment: int = 15) -> int:
    return int(math.ceil(value / increment) * increment)


def _confidence(result: RiskResult) -> ConsumerConfidence:
    delay: ConfidenceLevel = (
        result.delay_confidence.level if result.delay_confidence else result.confidence
    )
    transfer: ConfidenceLevel = (
        result.transfer_confidence.level if result.transfer_confidence else "low"
    )
    overall = min((delay, transfer), key=_CONFIDENCE_RANK.__getitem__)
    if overall == "low":
        summary = (
            "Treat this as a directional estimate. At least one model component "
            "has limited empirical validation."
        )
    elif overall == "medium":
        summary = "The estimate has useful supporting data, but meaningful uncertainty remains."
    else:
        summary = "The estimate is supported by relatively strong model evidence."
    return ConsumerConfidence(
        overall=overall, delay=delay, transfer=transfer, summary=summary
    )


def _reasons(
    connection: Connection,
    result: RiskResult,
    recommended_connection_minutes: int,
) -> list[ConsumerReason]:
    reasons: list[ConsumerReason] = []
    if result.scheduled_connection_minutes < recommended_connection_minutes:
        reasons.append(
            ConsumerReason(
                code="SHORT_CONNECTION",
                label="Limited connection time",
                description=(
                    "Your scheduled connection is shorter than the planning reference "
                    "derived from this airport's modeled transfer-time range."
                ),
            )
        )
    if connection.passenger.checked_baggage:
        reasons.append(
            ConsumerReason(
                code="CHECKED_BAGGAGE",
                label="Checked baggage",
                description=(
                    "Collecting and rechecking baggage adds modeled transfer time."
                ),
            )
        )
    if connection.passenger.self_transfer:
        reasons.append(
            ConsumerReason(
                code="SELF_TRANSFER",
                label="Self-transfer",
                description=(
                    "The model includes repeated check-in and security steps for this self-transfer."
                ),
            )
        )
        reasons.append(
            ConsumerReason(
                code="SECURITY_RECHECK",
                label="Security and check-in again",
                description=(
                    "A self-transfer may require leaving the protected transfer flow and clearing security again."
                ),
            )
        )
    if connection.passenger.schengen_to_non_schengen:
        reasons.append(
            ConsumerReason(
                code="PASSPORT_CONTROL",
                label="Passport control",
                description="The modeled transfer includes Schengen exit passport control.",
            )
        )
    if connection.passenger.requires_terminal_change:
        reasons.append(
            ConsumerReason(
                code="TERMINAL_CHANGE",
                label="Terminal change",
                description="Changing terminals adds modeled walking or transfer time.",
            )
        )
    if result.delay_distribution and result.delay_distribution.p90 > 30:
        reasons.append(
            ConsumerReason(
                code="INBOUND_DELAY_HISTORY",
                label="Inbound delay history",
                description=(
                    "In the available delay sample, 90% of arrivals were no more than "
                    f"about {result.delay_distribution.p90:.0f} minutes late."
                ),
            )
        )
    delay_level = (
        result.delay_confidence.level if result.delay_confidence else result.confidence
    )
    if delay_level == "low":
        reasons.append(
            ConsumerReason(
                code="LOW_DATA_CONFIDENCE",
                label="Limited delay evidence",
                description=(
                    "The delay estimate has limited historical evidence and should be treated cautiously."
                ),
            )
        )
    return reasons


def interpret_risk_result(
    connection: Connection,
    result: RiskResult,
    *,
    outbound_deadline_minutes: float = 45.0,
) -> ConsumerRiskResponse:
    """Translate engine output without changing the underlying probability."""
    recommended = _round_up(
        outbound_deadline_minutes + result.transfer_p90_minutes
    )
    is_research_data = bool(
        result.delay_data_source
        and result.delay_data_source != "bundled_demo_sample"
    )
    warnings = [
        ConsumerWarning(
            code="EXPERIMENTAL_ESTIMATE",
            severity="medium",
            message=(
                "Experimental estimate using historical research data, not live operational flight data."
                if is_research_data
                else "Experimental estimate using demonstration delay data, not live operational flight data."
            ),
        )
    ]
    if connection.passenger.self_transfer:
        warnings.insert(
            0,
            ConsumerWarning(
                code="SELF_TRANSFER",
                severity="high",
                message=(
                    "This self-transfer may be unprotected. If the inbound flight is delayed, "
                    "the next airline may not be required to rebook you."
                ),
            ),
        )
    confidence = _confidence(result)
    return ConsumerRiskResponse(
        risk_score=int(round(result.miss_probability * 100)),
        miss_probability=result.miss_probability,
        risk_level=result.risk_level,
        headline=_HEADLINES[result.risk_level],
        scheduled_connection_minutes=int(round(result.scheduled_connection_minutes)),
        recommended_connection_minutes=recommended,
        recommendation_basis=(
            "Rounded planning reference: outbound deadline offset plus the modeled "
            "90th-percentile airport transfer time. It is not a guarantee or official MCT."
        ),
        confidence=confidence,
        reasons=_reasons(connection, result, recommended),
        warnings=warnings,
        technical_details=TechnicalDetails(
            time_available_until_deadline_minutes=result.time_available_until_deadline_minutes,
            expected_transfer_minutes=result.expected_transfer_minutes,
            practical_buffer_minutes=result.practical_buffer_minutes,
            transfer_p90_minutes=result.transfer_p90_minutes,
            outbound_deadline_minutes=outbound_deadline_minutes,
            delay_sample_count=(
                result.delay_confidence.sample_count if result.delay_confidence else None
            ),
            delay_match_level=(
                result.delay_confidence.match_level if result.delay_confidence else None
            ),
            delay_data_source=result.delay_data_source,
            transfer_profile=connection.inbound.destination,
        ),
        data_notice=(
            "This estimate uses a locally configured historical research dataset. "
            "It is not live operational data and does not guarantee that a connection will be made."
            if is_research_data
            else "Bundled historical observations are demonstration data. This alpha is "
            "not real-time and does not guarantee that a connection will be made."
        ),
    )
