"""FastAPI application exposing the engine through a consumer-safe contract."""

from pathlib import Path
import os

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .. import __version__
from ..airport_metadata import AirportMetadataError, load_airport_name_index
from ..demo import DEMO_ITINERARIES
from ..engine import RiskEngine
from ..flight_data import (
    AviationstackScheduleProvider,
    FlightDataError,
    FlightDataNotConfiguredError,
    FlightNotFoundError,
    InvalidConnectionError,
    resolve_connection,
)
from ..models import Connection, FlightLeg, PassengerProfile
from ..product import ConsumerRiskResponse, interpret_risk_result
from ..providers.sample import SampleDelayProvider
from ..providers.historical_csv import HistoricalCsvDelayProvider
from ..transfer import AirportProfileNotFoundError
from .models import AnalyzeRequest, ErrorResponse, HealthResponse, ItineraryAnalyzeRequest

WEB_DIRECTORY = Path(__file__).resolve().parents[1] / "web"
AIRPORT_DATASET = Path(__file__).resolve().parents[3] / "data" / "public" / "airports.csv"
try:
    AIRPORT_NAMES = load_airport_name_index(AIRPORT_DATASET)
except (OSError, AirportMetadataError):
    AIRPORT_NAMES = {}


def _error(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"error": {"code": code, "message": message}},
    )


def create_app(engine: RiskEngine | None = None, schedule_provider=None) -> FastAPI:
    delay_dataset = os.getenv("CONNECTION_RISK_DELAY_DATASET")
    if engine is None:
        delay_provider = (
            HistoricalCsvDelayProvider(delay_dataset)
            if delay_dataset
            else SampleDelayProvider()
        )
        engine = RiskEngine(delay_provider)
    application = FastAPI(
        title="Connection Risk API",
        version=__version__,
        description=(
            "Experimental consumer API for modeled flight connection risk. "
            "Bundled delay observations are demonstration data."
        ),
    )
    application.state.risk_engine = engine
    application.state.data_mode = "historical" if delay_dataset else "demonstration"
    application.state.schedule_provider = schedule_provider or AviationstackScheduleProvider()
    application.state.demo_engine = RiskEngine(SampleDelayProvider())
    application.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:8000",
            "http://127.0.0.1:8000",
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ],
        allow_origin_regex=r"^chrome-extension://[a-z]{32}$",
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type"],
    )

    @application.exception_handler(RequestValidationError)
    async def validation_error(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        first = exc.errors()[0] if exc.errors() else {}
        location = ".".join(str(item) for item in first.get("loc", ())[1:])
        message = str(first.get("msg", "Invalid request"))
        if location:
            message = f"{location}: {message}"
        return _error(422, "VALIDATION_ERROR", message)

    @application.exception_handler(Exception)
    async def unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        # Do not expose implementation details or request payloads to clients.
        return _error(
            500,
            "INTERNAL_ERROR",
            "The analysis could not be completed. Please try again.",
        )

    @application.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse(
            status="ok",
            service="connection-risk",
            version=__version__,
            data_mode=application.state.data_mode,
        )

    @application.post(
        "/v1/analyze",
        response_model=ConsumerRiskResponse,
        responses={
            404: {"model": ErrorResponse, "description": "Unsupported airport or delay data"},
            422: {"model": ErrorResponse, "description": "Invalid itinerary"},
            500: {"model": ErrorResponse, "description": "Unexpected analysis failure"},
        },
    )
    def analyze(payload: AnalyzeRequest) -> ConsumerRiskResponse | JSONResponse:
        connection = payload.to_connection()
        try:
            # Resolve product support deterministically before delay lookup so an
            # unknown airport is not misreported as missing flight history.
            application.state.risk_engine.transfer_profiles.get_model(
                payload.connection_airport, connection.passenger
            )
        except AirportProfileNotFoundError:
            return _error(
                404,
                "UNSUPPORTED_AIRPORT",
                f"Transfer modeling is not available for {payload.connection_airport}.",
            )
        try:
            result = application.state.risk_engine.analyze(
                connection, n_simulations=50_000, random_seed=42
            )
        except LookupError:
            return _error(
                404,
                "UNSUPPORTED_DELAY_DATA",
                "No bundled delay sample is available for this inbound flight and route.",
            )
        return interpret_risk_result(
            connection,
            result,
            outbound_deadline_minutes=application.state.risk_engine.outbound_deadline_minutes,
        )

    @application.post("/v1/analyze-itinerary", response_model=None)
    def analyze_itinerary(payload: ItineraryAnalyzeRequest):
        try:
            itinerary = resolve_connection(
                application.state.schedule_provider,
                payload.inbound_flight_number,
                payload.outbound_flight_number,
                payload.flight_date,
            )
        except FlightDataNotConfiguredError as exc:
            return _error(503, "FLIGHT_DATA_NOT_CONFIGURED", str(exc))
        except FlightNotFoundError as exc:
            return _error(404, "FLIGHT_NOT_FOUND", str(exc))
        except InvalidConnectionError as exc:
            return _error(422, "INVALID_CONNECTION", str(exc))
        except FlightDataError as exc:
            return _error(502, "FLIGHT_DATA_UNAVAILABLE", str(exc))

        connection = Connection(
            inbound=FlightLeg(
                flight_number=itinerary.inbound.flight_number,
                origin=itinerary.inbound.origin,
                destination=itinerary.inbound.destination,
                scheduled_departure=itinerary.inbound.scheduled_departure,
                scheduled_arrival=itinerary.inbound.scheduled_arrival,
            ),
            outbound=FlightLeg(
                flight_number=itinerary.outbound.flight_number,
                origin=itinerary.outbound.origin,
                destination=itinerary.outbound.destination,
                scheduled_departure=itinerary.outbound.scheduled_departure,
                scheduled_arrival=itinerary.outbound.scheduled_arrival,
            ),
            passenger=PassengerProfile(
                checked_baggage=payload.checked_baggage,
                self_transfer=itinerary.self_transfer,
                schengen_to_non_schengen=payload.schengen_exit_required,
                requires_terminal_change=itinerary.terminal_change,
            ),
        )
        try:
            application.state.risk_engine.transfer_profiles.get_model(
                itinerary.inbound.destination, connection.passenger
            )
            result = application.state.risk_engine.analyze(
                connection, n_simulations=50_000, random_seed=42
            )
        except AirportProfileNotFoundError:
            return _error(
                404,
                "UNSUPPORTED_AIRPORT",
                f"Transfer modeling is not available for {itinerary.inbound.destination}.",
            )
        except LookupError:
            return _error(
                404,
                "UNSUPPORTED_DELAY_DATA",
                "No delay history is available for this inbound flight and route.",
            )

        assessment = interpret_risk_result(
            connection,
            result,
            outbound_deadline_minutes=application.state.risk_engine.outbound_deadline_minutes,
        )
        return {
            "itinerary": {
                "origin": itinerary.inbound.origin,
                "connection_airport": itinerary.inbound.destination,
                "destination": itinerary.outbound.destination,
                "scheduled_arrival": itinerary.inbound.scheduled_arrival.isoformat(),
                "scheduled_departure": itinerary.outbound.scheduled_departure.isoformat(),
                "arrival_terminal": itinerary.inbound.arrival_terminal,
                "departure_terminal": itinerary.outbound.departure_terminal,
                "self_transfer": itinerary.self_transfer,
                "self_transfer_basis": itinerary.self_transfer_basis,
                "terminal_change": itinerary.terminal_change,
                "terminal_change_known": itinerary.terminal_change_known,
                "data_source": "aviationstack",
            },
            "assessment": assessment.model_dump(mode="json"),
        }

    @application.get("/v1/demo-itineraries")
    def demo_itineraries() -> dict:
        items = []
        demo_engine = application.state.demo_engine
        for fixture in DEMO_ITINERARIES:
            connection = fixture.to_connection()
            result = demo_engine.analyze(
                connection, n_simulations=50_000, random_seed=42
            )
            assessment = interpret_risk_result(
                connection,
                result,
                outbound_deadline_minutes=demo_engine.outbound_deadline_minutes,
            )
            transfer_model = demo_engine.transfer_profiles.get_model(
                connection.inbound.destination, connection.passenger
            )
            total_minutes = int(
                round(
                    (
                        connection.outbound.scheduled_arrival
                        - connection.inbound.scheduled_departure
                    ).total_seconds()
                    / 60
                )
            )
            items.append(
                {
                    "id": fixture.id,
                    "scenario": fixture.scenario,
                    "airline": fixture.airline,
                    "price_eur": fixture.price_eur,
                    "featured": fixture.featured,
                    "safer_option_id": fixture.safer_option_id,
                    "separate_tickets": fixture.separate_tickets,
                    "inbound": connection.inbound.model_dump(mode="json"),
                    "outbound": connection.outbound.model_dump(mode="json"),
                    "transfer_airport": {
                        "iata": connection.inbound.destination,
                        "name": AIRPORT_NAMES.get(
                            connection.inbound.destination,
                            connection.inbound.destination,
                        ),
                    },
                    "total_minutes": total_minutes,
                    "transfer_steps": [
                        {
                            "code": component.name,
                            "median_minutes": component.median,
                            "p90_minutes": component.p90,
                        }
                        for component in transfer_model.components
                    ],
                    "assessment": assessment.model_dump(mode="json"),
                }
            )
        return {
            "search": {
                "origin": "Berlin",
                "origin_code": "BER",
                "destination": "Shanghai",
                "destination_code": "PVG",
                "date": "2026-09-20",
                "cabin": "Economy",
                "passengers": 1,
            },
            "data_mode": "demonstration",
            "data_mode_label": "Demo data",
            "items": items,
            "disclaimer": (
                "Connection Risk provides an estimate based on historical data and "
                "modeled transfer conditions. It is not a guarantee that a connection "
                "will or will not be made."
            ),
        }

    if WEB_DIRECTORY.is_dir():
        application.mount(
            "/static", StaticFiles(directory=WEB_DIRECTORY), name="static"
        )

        @application.get("/", include_in_schema=False)
        def checker() -> FileResponse:
            return FileResponse(WEB_DIRECTORY / "index.html")

        @application.get("/demo", include_in_schema=False)
        def demo() -> FileResponse:
            return FileResponse(WEB_DIRECTORY / "demo.html")

    return application


app = create_app()
