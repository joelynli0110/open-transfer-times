"""Isolated adapter for the public-domain OurAirports airports.csv dataset."""

from __future__ import annotations

import csv
from pathlib import Path
import re

from pydantic import BaseModel, ConfigDict, Field, field_validator


REQUIRED_COLUMNS = {
    "name",
    "latitude_deg",
    "longitude_deg",
    "iso_country",
    "iso_region",
    "icao_code",
    "iata_code",
}


class AirportMetadataError(ValueError):
    pass


class DuplicateAirportError(AirportMetadataError):
    pass


class AirportMetadata(BaseModel):
    model_config = ConfigDict(frozen=True, str_strip_whitespace=True)

    iata: str | None = None
    icao: str | None = None
    name: str = Field(min_length=1)
    country: str = Field(min_length=2, max_length=2)
    region: str | None = None
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    elevation_ft: float | None = None

    @field_validator("iata")
    @classmethod
    def validate_iata(cls, value: str | None) -> str | None:
        if not value:
            return None
        normalized = value.upper()
        if not re.fullmatch(r"[A-Z]{3}", normalized):
            raise ValueError("IATA code must be three letters")
        return normalized

    @field_validator("icao")
    @classmethod
    def validate_icao(cls, value: str | None) -> str | None:
        if not value:
            return None
        normalized = value.upper()
        if not re.fullmatch(r"[A-Z]{4}", normalized):
            raise ValueError("ICAO code must be four letters")
        return normalized

    @field_validator("country")
    @classmethod
    def normalize_country(cls, value: str) -> str:
        normalized = value.upper()
        if not re.fullmatch(r"[A-Z]{2}", normalized):
            raise ValueError("country must be a two-letter code")
        return normalized


def _optional(value: str | None) -> str | None:
    stripped = (value or "").strip()
    return stripped or None


def load_ourairports(path: str | Path) -> list[AirportMetadata]:
    """Normalize OurAirports columns without leaking raw CSV shape downstream."""

    source = Path(path)
    with source.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        missing = REQUIRED_COLUMNS.difference(reader.fieldnames or ())
        if missing:
            raise AirportMetadataError(
                f"OurAirports CSV is missing columns: {', '.join(sorted(missing))}"
            )
        records: list[AirportMetadata] = []
        by_icao: dict[str, AirportMetadata] = {}
        for row_number, row in enumerate(reader, start=2):
            try:
                record = AirportMetadata(
                    iata=_optional(row.get("iata_code")),
                    icao=_optional(row.get("icao_code")),
                    name=row["name"],
                    country=row["iso_country"],
                    region=_optional(row.get("iso_region")),
                    latitude=float(row["latitude_deg"]),
                    longitude=float(row["longitude_deg"]),
                    elevation_ft=(
                        float(row["elevation_ft"])
                        if _optional(row.get("elevation_ft")) is not None
                        else None
                    ),
                )
            except (TypeError, ValueError) as exc:
                raise AirportMetadataError(f"invalid airport row {row_number}: {exc}") from exc
            if record.icao and record.icao in by_icao:
                if by_icao[record.icao] == record:
                    continue
                raise DuplicateAirportError(
                    f"conflicting duplicate ICAO code {record.icao} at row {row_number}"
                )
            if record.icao:
                by_icao[record.icao] = record
            records.append(record)
    return records


def load_airport_name_index(path: str | Path) -> dict[str, str]:
    """Load the IATA-to-name fields needed by passenger-facing views."""

    source = Path(path)
    with source.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {"name", "iata_code"}
        missing = required.difference(reader.fieldnames or ())
        if missing:
            raise AirportMetadataError(
                f"OurAirports CSV is missing columns: {', '.join(sorted(missing))}"
            )
        names: dict[str, str] = {}
        for row_number, row in enumerate(reader, start=2):
            iata = _optional(row.get("iata_code"))
            name = _optional(row.get("name"))
            if not iata or not name:
                continue
            iata = iata.upper()
            if not re.fullmatch(r"[A-Z]{3}", iata):
                continue
            if iata in names and names[iata] != name:
                raise DuplicateAirportError(
                    f"conflicting duplicate IATA code {iata} at row {row_number}"
                )
            names[iata] = name
    return names


def write_icao_iata_mapping(airports: list[AirportMetadata], output: str | Path) -> int:
    """Write the exact two-column mapping expected by ADRR ingestion."""

    mappings = sorted(
        ((airport.icao, airport.iata) for airport in airports if airport.icao and airport.iata),
        key=lambda item: item[0],
    )
    target = Path(output)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["icao_code", "iata_code"])
        writer.writeheader()
        writer.writerows(
            {"icao_code": icao, "iata_code": iata} for icao, iata in mappings
        )
    return len(mappings)
