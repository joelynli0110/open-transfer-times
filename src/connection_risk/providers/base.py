"""Provider interface for historical arrival-delay observations."""

from abc import ABC
from datetime import datetime

import numpy as np
from numpy.typing import NDArray

from ..models import DelayObservationSet


class DelayProvider(ABC):
    """Abstract source of historical arrival delays, in minutes."""

    def get_arrival_delays(
        self, flight_number: str, destination: str
    ) -> NDArray[np.float64]:
        """Return one-dimensional delay observations for a flight."""
        raise NotImplementedError("this rich provider exposes observation sets only")

    def get_observations(
        self,
        flight_number: str | None,
        carrier: str | None,
        origin: str,
        destination: str,
        scheduled_arrival: datetime | None = None,
    ) -> DelayObservationSet:
        """Return rich historical observations when supported.

        Legacy V0.1 providers remain valid by implementing ``get_arrival_delays``.
        Rich V0.2 providers override this method; callers may fall back to the
        array helper when ``NotImplementedError`` is raised.
        """
        raise NotImplementedError("this legacy provider exposes delay arrays only")
