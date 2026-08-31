"""CSV-backed delay provider bundled for offline examples."""

from pathlib import Path

import numpy as np
import pandas as pd
from numpy.typing import NDArray

from .base import DelayProvider


def default_delay_data_path() -> Path:
    repository_data = (
        Path(__file__).resolve().parents[3] / "data" / "samples" / "arrival_delays.csv"
    )
    if repository_data.is_file():
        return repository_data
    return Path(__file__).resolve().parents[1] / "data" / "samples" / "arrival_delays.csv"


class SampleDelayProvider(DelayProvider):
    def __init__(self, csv_path: str | Path | None = None) -> None:
        self.csv_path = Path(csv_path) if csv_path else default_delay_data_path()
        self.source = "bundled_demo_sample"
        if not self.csv_path.is_file():
            raise FileNotFoundError(f"arrival delay data not found: {self.csv_path}")
        frame = pd.read_csv(self.csv_path)
        required = {"flight_number", "destination", "delay_minutes"}
        missing = required.difference(frame.columns)
        if missing:
            raise ValueError(f"delay CSV is missing columns: {', '.join(sorted(missing))}")
        frame = frame.copy()
        frame["flight_number"] = frame["flight_number"].astype(str).str.upper()
        frame["destination"] = frame["destination"].astype(str).str.upper()
        frame["delay_minutes"] = pd.to_numeric(frame["delay_minutes"], errors="coerce")
        self._data = frame.dropna(subset=["delay_minutes"])

    def get_arrival_delays(
        self, flight_number: str, destination: str
    ) -> NDArray[np.float64]:
        matches = self._data[
            (self._data["flight_number"] == flight_number.upper())
            & (self._data["destination"] == destination.upper())
        ]
        if matches.empty:
            raise LookupError(
                f"no arrival delay observations for {flight_number} to {destination}"
            )
        return matches["delay_minutes"].to_numpy(dtype=np.float64, copy=True)
