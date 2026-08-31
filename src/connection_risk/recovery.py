"""Deterministic, user-facing explanations of modeled risk factors.

The module name is reserved for broader recovery-option modeling in later releases;
V0.1 contains only explanation logic.
"""

import numpy as np
from numpy.typing import ArrayLike

from .models import PassengerProfile


def build_risk_factors(
    passenger: PassengerProfile,
    delay_samples: ArrayLike,
    high_variability_std_minutes: float = 30.0,
) -> list[str]:
    factors: list[str] = []
    if passenger.checked_baggage:
        factors.append("Checked baggage increases transfer time.")
    if passenger.self_transfer:
        factors.append(
            "Because this is a self-transfer, baggage, check-in, and security may need to be repeated."
        )
    if passenger.schengen_to_non_schengen:
        factors.append(
            "Passport control is included because the connection crosses the Schengen boundary."
        )
    if passenger.requires_terminal_change:
        factors.append("A terminal change adds transfer time.")
    delays = np.asarray(delay_samples, dtype=np.float64)
    if delays.size >= 2 and float(np.std(delays, ddof=1)) >= high_variability_std_minutes:
        factors.append("The inbound flight has high arrival-time variability.")
    return factors
