"""Airport transfer profiles and component distributions."""

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import yaml
from numpy.typing import NDArray
from scipy.stats import lognorm, rv_continuous

from .models import PassengerProfile

Z_90 = 1.2815515655446004
BASE_COMPONENTS = ("deplane", "walking")


class AirportProfileNotFoundError(LookupError):
    """Raised when no transfer profile exists for an airport."""


def default_transfer_profiles_path() -> Path:
    repository_data = (
        Path(__file__).resolve().parents[2]
        / "data"
        / "airports"
        / "transfer_profiles.yaml"
    )
    if repository_data.is_file():
        return repository_data
    return Path(__file__).resolve().parent / "data" / "airports" / "transfer_profiles.yaml"


def lognormal_from_median_p90(median: float, p90: float) -> rv_continuous:
    """Build a zero-location log-normal distribution from two quantiles."""
    if median <= 0:
        raise ValueError("component median must be greater than zero")
    if p90 <= median:
        raise ValueError("component p90 must be greater than its median")
    sigma = np.log(p90 / median) / Z_90
    return lognorm(s=float(sigma), scale=float(median), loc=0)


@dataclass(frozen=True)
class TransferComponent:
    name: str
    median: float
    p90: float

    def distribution(self) -> rv_continuous:
        return lognormal_from_median_p90(self.median, self.p90)


@dataclass(frozen=True)
class TransferModel:
    airport: str
    components: tuple[TransferComponent, ...]

    def sample(
        self, n: int, rng: np.random.Generator
    ) -> NDArray[np.float64]:
        if n <= 0:
            raise ValueError("number of transfer samples must be positive")
        total = np.zeros(n, dtype=np.float64)
        for component in self.components:
            total += component.distribution().rvs(size=n, random_state=rng)
        return total


class TransferProfileStore:
    """Loads airport component profiles and creates passenger-specific models."""

    def __init__(self, yaml_path: str | Path | None = None) -> None:
        self.yaml_path = Path(yaml_path) if yaml_path else default_transfer_profiles_path()
        if not self.yaml_path.is_file():
            raise FileNotFoundError(f"transfer profiles not found: {self.yaml_path}")
        with self.yaml_path.open("r", encoding="utf-8") as handle:
            document = yaml.safe_load(handle) or {}
        airports = document.get("airports", document)
        if not isinstance(airports, dict):
            raise ValueError("transfer profile YAML must contain an airports mapping")
        self._profiles: dict[str, Any] = {
            str(code).upper(): profile for code, profile in airports.items()
        }

    def get_model(
        self, airport: str, passenger: PassengerProfile
    ) -> TransferModel:
        airport = airport.upper()
        raw_profile = self._profiles.get(airport)
        if raw_profile is None:
            raise AirportProfileNotFoundError(
                f"no transfer profile found for airport {airport}"
            )

        names = list(BASE_COMPONENTS)
        if passenger.checked_baggage:
            names.append("baggage_reclaim")
        if passenger.schengen_to_non_schengen:
            names.append("passport_control")
        if passenger.self_transfer:
            names.extend(("checkin", "security"))
        if passenger.requires_terminal_change:
            names.append("terminal_transfer")

        components: list[TransferComponent] = []
        for name in names:
            values = raw_profile.get(name) if isinstance(raw_profile, dict) else None
            if not isinstance(values, dict) or "median" not in values or "p90" not in values:
                raise ValueError(
                    f"airport {airport} profile is missing valid component {name}"
                )
            component = TransferComponent(
                name=name, median=float(values["median"]), p90=float(values["p90"])
            )
            # Validate parameters while loading, rather than during a simulation.
            component.distribution()
            components.append(component)
        return TransferModel(airport=airport, components=tuple(components))
