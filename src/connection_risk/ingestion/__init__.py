"""Normalization boundary for external historical aviation data."""

from .normalization import normalize_airport_code, normalize_carrier, normalize_flight_number
from .schema import IngestionStatistics
from .eurocontrol import (
    AdrrSchemaInspection,
    ingest_eurocontrol_adrr,
    inspect_adrr_schema,
    load_airport_mapping,
)

__all__ = [
    "IngestionStatistics",
    "normalize_airport_code",
    "normalize_carrier",
    "normalize_flight_number",
    "ingest_eurocontrol_adrr",
    "inspect_adrr_schema",
    "AdrrSchemaInspection",
    "load_airport_mapping",
]
