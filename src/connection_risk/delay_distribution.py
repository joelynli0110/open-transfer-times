"""Empirical arrival-delay distribution calculations."""

import numpy as np
from numpy.typing import ArrayLike

from .models import DelayDistributionSummary


def _validated_delays(delay_samples: ArrayLike) -> np.ndarray:
    values = np.asarray(delay_samples, dtype=np.float64)
    if values.ndim != 1 or values.size == 0:
        raise ValueError("delay samples must be a non-empty one-dimensional array")
    if not np.all(np.isfinite(values)):
        raise ValueError("delay samples must contain only finite values")
    return values


def empirical_exceedance_probability(
    delay_samples: ArrayLike, threshold_minutes: float
) -> float:
    """Return the empirical probability of delay strictly exceeding a threshold."""
    if not np.isfinite(threshold_minutes):
        raise ValueError("threshold_minutes must be finite")
    values = _validated_delays(delay_samples)
    return float(np.mean(values > threshold_minutes))


def summarize_delays(delay_samples: ArrayLike) -> DelayDistributionSummary:
    values = _validated_delays(delay_samples)
    return DelayDistributionSummary(
        sample_count=int(values.size),
        mean=float(np.mean(values)),
        median=float(np.median(values)),
        std=float(np.std(values, ddof=1)) if values.size > 1 else 0.0,
        p75=float(np.quantile(values, 0.75)),
        p90=float(np.quantile(values, 0.90)),
        p95=float(np.quantile(values, 0.95)),
    )
