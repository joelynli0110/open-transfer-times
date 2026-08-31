from pathlib import Path
from datetime import UTC, datetime, timedelta
import csv

import pytest
from fastapi.testclient import TestClient

from connection_risk.airport_metadata import (
    DuplicateAirportError,
    load_airport_name_index,
    load_ourairports,
    write_icao_iata_mapping,
)
from connection_risk.api.app import create_app
from connection_risk.adrr_product_validation import validate_adrr_for_product


AIRPORT_HEADER = (
    "name,latitude_deg,longitude_deg,elevation_ft,iso_country,iso_region,"
    "icao_code,iata_code\n"
)


def test_ourairports_normalization_and_mapping(tmp_path: Path):
    source = tmp_path / "airports.csv"
    source.write_text(
        AIRPORT_HEADER
        + "Berlin Brandenburg Airport,52.3514,13.4939,157,de,DE-BR,eddB,ber\n"
        + "Istanbul Airport,41.2753,28.7519,,TR,TR-34,LTFM,IST\n",
        encoding="utf-8",
    )
    airports = load_ourairports(source)
    assert airports[0].icao == "EDDB"
    assert airports[0].iata == "BER"
    assert airports[0].country == "DE"
    assert airports[1].elevation_ft is None

    output = tmp_path / "generated" / "airport_codes.csv"
    assert write_icao_iata_mapping(airports, output) == 2
    assert output.read_text(encoding="utf-8").splitlines() == [
        "icao_code,iata_code",
        "EDDB,BER",
        "LTFM,IST",
    ]


def test_ourairports_missing_iata_is_preserved_but_not_mapped(tmp_path: Path):
    source = tmp_path / "airports.csv"
    source.write_text(
        AIRPORT_HEADER + "Research Airfield,50,10,,DE,DE-HE,EDZZ,\n",
        encoding="utf-8",
    )
    airports = load_ourairports(source)
    assert airports[0].iata is None
    assert write_icao_iata_mapping(airports, tmp_path / "mapping.csv") == 0


def test_airport_name_index_uses_iata_codes(tmp_path: Path):
    source = tmp_path / "airports.csv"
    source.write_text(
        AIRPORT_HEADER
        + "Budapest Liszt Ferenc International Airport,47.4,19.2,495,HU,HU-BU,LHBP,BUD\n",
        encoding="utf-8",
    )
    assert load_airport_name_index(source) == {
        "BUD": "Budapest Liszt Ferenc International Airport"
    }


def test_ourairports_exact_duplicate_is_removed_and_conflict_fails(tmp_path: Path):
    row = "Berlin Brandenburg Airport,52.3514,13.4939,157,DE,DE-BR,EDDB,BER\n"
    source = tmp_path / "airports.csv"
    source.write_text(AIRPORT_HEADER + row + row, encoding="utf-8")
    assert len(load_ourairports(source)) == 1

    source.write_text(
        AIRPORT_HEADER
        + row
        + "Wrong Airport,51,12,10,DE,DE-BR,EDDB,XXX\n",
        encoding="utf-8",
    )
    with pytest.raises(DuplicateAirportError, match="EDDB"):
        load_ourairports(source)


def test_demo_page_contains_product_experience_surfaces():
    client = TestClient(create_app())
    page = client.get("/demo")
    assert page.status_code == 200
    for marker in (
        "Choose a flight",
        "data-mode",
        "risk-drawer",
        "drawer-backdrop",
        "study-panel",
        "export-study",
    ):
        assert marker in page.text
    javascript = client.get("/static/demo.js").text
    for marker in (
        "LOW",
        "MODERATE",
        "HIGH",
        "Separate tickets",
        "Compare safer option",
        "How was this estimated?",
        "risk_badge_clicked",
        "safer_option_clicked",
        "study_risk_revealed",
        "study_choice_completed",
        "connection-risk:traveler-study:v1",
        "airline-logo",
        "data-toggle-journey",
        "journey-details",
        "https://www.gstatic.com/flights/airline_logos/70px/",
    ):
        assert marker in javascript
    assert "/static/demo.css?v=0.6.9" in page.text
    assert "/static/demo.js?v=0.6.9" in page.text


def test_demo_api_runs_fixtures_through_real_engine_and_product_layer():
    body = TestClient(create_app()).get("/v1/demo-itineraries").json()
    assert body["data_mode"] == "demonstration"
    assert len(body["items"]) == 5
    by_id = {item["id"]: item for item in body["items"]}
    assert by_id["self-transfer-high"]["separate_tickets"] is True
    assert by_id["self-transfer-high"]["transfer_airport"] == {
        "iata": "BUD",
        "name": "Budapest Liszt Ferenc International Airport",
    }
    assert by_id["self-transfer-high"]["safer_option_id"] == "self-transfer-safer"
    assert (
        by_id["self-transfer-safer"]["assessment"]["risk_score"]
        < by_id["self-transfer-high"]["assessment"]["risk_score"]
    )
    assert by_id["low-confidence"]["assessment"]["confidence"]["delay"] == "low"
    assert by_id["protected-comfortable"]["assessment"]["technical_details"][
        "delay_data_source"
    ] == "bundled_demo_sample"
    assert all(item["transfer_steps"] for item in body["items"])
    assert {item["assessment"]["risk_level"] for item in body["items"]} == {
        "low",
        "moderate",
        "high",
    }


def test_adrr_product_validation_proves_route_level_without_exact_flight_claim(tmp_path: Path):
    dataset = tmp_path / "adrr.csv"
    fields = [
        "flight_number", "carrier", "origin", "destination",
        "scheduled_departure", "scheduled_arrival", "actual_arrival",
        "arrival_delay_minutes", "source",
    ]
    with dataset.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for index in range(35):
            scheduled = datetime(2026, 1, 1, 10, tzinfo=UTC) + timedelta(days=index)
            delay = index % 20
            writer.writerow(
                {
                    "flight_number": "",
                    "carrier": "THY",
                    "origin": "BER",
                    "destination": "IST",
                    "scheduled_departure": "",
                    "scheduled_arrival": scheduled.isoformat(),
                    "actual_arrival": (scheduled + timedelta(minutes=delay)).isoformat(),
                    "arrival_delay_minutes": delay,
                    "source": "eurocontrol_adrr",
                }
            )
    report = validate_adrr_for_product(dataset, [("BER", "IST"), ("BER", "BUD")])
    assert report.passenger_flight_number_count == 0
    assert report.exact_flight_matching_available is False
    assert report.routes[0].supported is True
    assert report.routes[0].match_level == "route"
    assert report.routes[0].confidence == "medium"
    assert report.routes[0].route_level_verified is True
    assert report.routes[1].supported is False
