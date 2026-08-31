"""Monte Carlo simulation independent of delay data acquisition."""

from dataclasses import dataclass

import numpy as np
from numpy.typing import ArrayLike

from .models import Connection
from .transfer import TransferModel


@dataclass(frozen=True)
class SimulationResult:
    miss_probability: float
    transfer_median_minutes: float
    transfer_p90_minutes: float
    time_available_until_deadline_minutes: float
    practical_buffer_minutes: float

    @property
    def usable_buffer_minutes(self) -> float:
        """Deprecated V0.1 alias for time available until the deadline."""
        return self.time_available_until_deadline_minutes


def simulate_connection(
    connection: Connection,
    delay_samples: ArrayLike,
    transfer_model: TransferModel,
    n_simulations: int = 50_000,
    random_seed: int | None = None,
    outbound_deadline_minutes: float = 45.0,
) -> SimulationResult:
    """Estimate connection failure using empirical delays and transfer samples."""
    if n_simulations <= 0:
        raise ValueError("n_simulations must be positive")
    if outbound_deadline_minutes < 0:
        raise ValueError("outbound_deadline_minutes cannot be negative")
    delays = np.asarray(delay_samples, dtype=np.float64)
    if delays.ndim != 1 or delays.size == 0:
        raise ValueError("delay_samples must be a non-empty one-dimensional array")
    if not np.all(np.isfinite(delays)):
        raise ValueError("delay_samples must contain only finite values")

    scheduled_minutes = (
        connection.outbound.scheduled_departure
        - connection.inbound.scheduled_arrival
    ).total_seconds() / 60.0
    time_available = scheduled_minutes - outbound_deadline_minutes
    rng = np.random.default_rng(random_seed)
    simulated_delays = rng.choice(delays, size=n_simulations, replace=True)
    transfer_minutes = transfer_model.sample(n_simulations, rng)
    misses = simulated_delays + transfer_minutes > time_available
    transfer_median = float(np.quantile(transfer_minutes, 0.5))

    return SimulationResult(
        miss_probability=float(np.mean(misses)),
        transfer_median_minutes=transfer_median,
        transfer_p90_minutes=float(np.quantile(transfer_minutes, 0.9)),
        time_available_until_deadline_minutes=float(time_available),
        practical_buffer_minutes=float(time_available - transfer_median),
    )
