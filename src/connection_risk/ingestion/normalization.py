"""Small, provider-independent normalization helpers."""

import re


def normalize_airport_code(value: object) -> str:
    normalized = str(value).strip().upper()
    if not re.fullmatch(r"[A-Z]{3}", normalized):
        raise ValueError(f"invalid airport code: {value!r}")
    return normalized


def normalize_flight_number(value: object | None) -> str | None:
    if value is None or str(value).strip() == "":
        return None
    normalized = re.sub(r"[\s-]+", "", str(value)).upper()
    if not re.fullmatch(r"[A-Z0-9]{2,8}", normalized):
        raise ValueError(f"invalid flight number: {value!r}")
    return normalized


def normalize_carrier(value: object | None) -> str | None:
    if value is None or str(value).strip() == "":
        return None
    normalized = str(value).strip().upper()
    if not re.fullmatch(r"[A-Z0-9]{2,3}", normalized):
        raise ValueError(f"invalid carrier code: {value!r}")
    return normalized

