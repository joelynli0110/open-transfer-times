"""Confidence scoring based on historical evidence."""

from dataclasses import dataclass
from typing import Literal

from .models import DelayModelConfidence, MatchLevel, TransferModelConfidence

ConfidenceLevel = Literal["low", "medium", "high"]


@dataclass(frozen=True)
class ConfidenceThresholds:
    medium_min_samples: int = 30
    high_min_samples: int = 100

    def __post_init__(self) -> None:
        if self.medium_min_samples < 1:
            raise ValueError("medium_min_samples must be positive")
        if self.high_min_samples <= self.medium_min_samples:
            raise ValueError("high_min_samples must exceed medium_min_samples")


def classify_confidence(
    sample_count: int, thresholds: ConfidenceThresholds | None = None
) -> ConfidenceLevel:
    thresholds = thresholds or ConfidenceThresholds()
    if sample_count < 0:
        raise ValueError("sample_count cannot be negative")
    if sample_count >= thresholds.high_min_samples:
        return "high"
    if sample_count >= thresholds.medium_min_samples:
        return "medium"
    return "low"


def assess_delay_confidence(
    sample_count: int,
    match_level: MatchLevel,
    thresholds: ConfidenceThresholds | None = None,
) -> DelayModelConfidence:
    """Assess evidence strength using both quantity and match specificity."""
    thresholds = thresholds or ConfidenceThresholds()
    if sample_count < 0:
        raise ValueError("sample_count cannot be negative")
    specific = match_level in {"exact_flight", "carrier_route"}
    if sample_count >= thresholds.high_min_samples and specific:
        level: ConfidenceLevel = "high"
    elif sample_count >= thresholds.medium_min_samples and match_level != "peer_group":
        level = "medium"
    else:
        level = "low"

    reasons = [f"{sample_count} historical observations available"]
    if match_level == "exact_flight":
        reasons.append("Using exact-flight history")
    elif match_level == "carrier_route":
        reasons.append(
            "Using carrier-route fallback because exact-flight history was insufficient"
        )
    elif match_level == "route":
        reasons.append(
            "Using route fallback; it is less specific than flight or carrier history"
        )
    else:
        reasons.append("Using a broad peer-group fallback")
    if sample_count < thresholds.medium_min_samples:
        reasons.append("Historical sample count is below the medium-confidence minimum")
    elif sample_count >= thresholds.high_min_samples and not specific:
        reasons.append("Broad route matching limits confidence despite the sample count")
    return DelayModelConfidence(
        level=level,
        sample_count=sample_count,
        match_level=match_level,
        reasons=reasons,
    )


def assess_transfer_confidence() -> TransferModelConfidence:
    """Describe the currently modeled—not empirically validated—transfer layer."""
    return TransferModelConfidence(
        level="low",
        reasons=[
            "Airport transfer times are modeled from component quantiles",
            "No passenger-level transfer outcome data is available for calibration",
        ],
    )
