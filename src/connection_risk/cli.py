"""Command-line interface for offline connection analysis."""

from datetime import datetime, timedelta
import json
from pathlib import Path
from typing import Annotated

import typer

from .backtesting import rolling_backtest
from .airport_metadata import load_ourairports, write_icao_iata_mapping
from .adrr_product_validation import (
    format_adrr_product_validation,
    validate_adrr_for_product,
)
from .benchmarking import BenchmarkConfig, evaluate_benchmark, write_benchmark_outputs
from .engine import RiskEngine
from .ingestion.eurocontrol import (
    format_schema_inspection,
    format_ingestion_statistics,
    ingest_eurocontrol_adrr,
    inspect_adrr_schema,
)
from .models import Connection, FlightLeg, PassengerProfile
from .providers.sample import SampleDelayProvider
from .providers.historical_csv import HistoricalCsvDelayProvider
from .real_run import format_sanity_report, run_first_adrr_workflow

app = typer.Typer(
    help="Estimate the risk of missing a separate-ticket flight connection.",
    no_args_is_help=True,
)


@app.command("build-airport-mapping")
def build_airport_mapping(
    airports: Annotated[
        str, typer.Option(help="Local OurAirports airports.csv file")
    ],
    output: Annotated[
        str, typer.Option(help="Generated ICAO-to-IATA CSV path")
    ] = "data/generated/airport_codes.csv",
) -> None:
    """Build the airport-code mapping consumed by ADRR normalization."""
    records = load_ourairports(airports)
    count = write_icao_iata_mapping(records, output)
    typer.echo(f"Wrote {count:,} ICAO-to-IATA mappings to {output}")


@app.command("validate-adrr-product")
def validate_adrr_product(
    dataset: Annotated[
        str, typer.Option(help="Locally normalized ADRR CSV or Parquet dataset")
    ],
    routes: Annotated[
        str, typer.Option(help="Comma-separated IATA routes, for example BER-IST,BER-BUD")
    ] = "BER-IST,BER-BUD",
    min_samples: Annotated[int, typer.Option(min=1)] = 30,
    lookback_days: Annotated[int, typer.Option(min=1)] = 365,
    json_output: Annotated[
        str | None, typer.Option(help="Optional machine-readable validation report")
    ] = None,
) -> None:
    """Validate ADRR provenance and route-level confidence for product use."""
    parsed_routes: list[tuple[str, str]] = []
    for value in routes.split(","):
        parts = [part.strip().upper() for part in value.split("-")]
        if len(parts) != 2 or any(len(part) != 3 for part in parts):
            raise typer.BadParameter(
                "routes must use ORG-DST pairs separated by commas",
                param_hint="--routes",
            )
        parsed_routes.append((parts[0], parts[1]))
    report = validate_adrr_for_product(
        dataset,
        parsed_routes,
        min_samples=min_samples,
        lookback_days=lookback_days,
    )
    typer.echo(format_adrr_product_validation(report))
    if json_output:
        report.write_json(json_output)


def _parse_datetime(value: str, option_name: str) -> datetime:
    try:
        return datetime.fromisoformat(value)
    except ValueError as exc:
        raise typer.BadParameter(
            "expected an ISO 8601 date/time", param_hint=option_name
        ) from exc


@app.command()
def analyze(
    inbound: Annotated[str, typer.Option(help="Inbound flight number")],
    origin: Annotated[str, typer.Option(help="Inbound origin airport")],
    connection_airport: Annotated[str, typer.Option(help="Connection airport")],
    arrival: Annotated[str, typer.Option(help="Scheduled inbound arrival (ISO 8601)")],
    outbound: Annotated[str, typer.Option(help="Outbound flight number")],
    destination: Annotated[str, typer.Option(help="Final destination airport")],
    departure: Annotated[str, typer.Option(help="Scheduled outbound departure (ISO 8601)")],
    self_transfer: Annotated[bool, typer.Option()] = False,
    checked_baggage: Annotated[bool, typer.Option()] = False,
    schengen_to_non_schengen: Annotated[bool, typer.Option()] = False,
    terminal_change: Annotated[bool, typer.Option()] = False,
    simulations: Annotated[int, typer.Option(min=1)] = 50_000,
    seed: Annotated[int | None, typer.Option()] = None,
) -> None:
    """Analyze one connection using the bundled historical sample data."""
    arrival_at = _parse_datetime(arrival, "--arrival")
    departure_at = _parse_datetime(departure, "--departure")
    connection = Connection(
        inbound=FlightLeg(
            flight_number=inbound,
            origin=origin,
            destination=connection_airport,
            # These times do not affect connection risk; the CLI accepts only the
            # schedule fields relevant to the connection itself.
            scheduled_departure=arrival_at - timedelta(hours=2),
            scheduled_arrival=arrival_at,
        ),
        outbound=FlightLeg(
            flight_number=outbound,
            origin=connection_airport,
            destination=destination,
            scheduled_departure=departure_at,
            scheduled_arrival=departure_at + timedelta(hours=2),
        ),
        passenger=PassengerProfile(
            checked_baggage=checked_baggage,
            self_transfer=self_transfer,
            schengen_to_non_schengen=schengen_to_non_schengen,
            requires_terminal_change=terminal_change,
        ),
    )
    result = RiskEngine(SampleDelayProvider()).analyze(
        connection, n_simulations=simulations, random_seed=seed
    )

    typer.echo(f"Connection: {connection_airport.upper()}")
    typer.echo(f"Scheduled connection: {result.scheduled_connection_minutes:.0f} min")
    typer.echo(
        "Time available until deadline: "
        f"{result.time_available_until_deadline_minutes:.0f} min"
    )
    typer.echo(f"Practical buffer: {result.practical_buffer_minutes:.0f} min\n")
    typer.echo("Estimated transfer")
    typer.echo(f"Median: {result.transfer_median_minutes:.0f} min")
    typer.echo(f"P90: {result.transfer_p90_minutes:.0f} min\n")
    typer.echo(f"Miss probability: {result.miss_probability:.1%}")
    typer.echo(f"Risk: {result.risk_level.upper()}")
    typer.echo(f"Confidence: {result.confidence.upper()}")
    if result.risk_factors:
        typer.echo("\nMain factors:")
        for factor in result.risk_factors:
            typer.echo(f"- {factor}")


@app.command()
def backtest(
    dataset: Annotated[
        str, typer.Option(help="Normalized historical arrivals CSV")
    ],
    threshold: Annotated[float, typer.Option(help="Delay threshold in minutes")] = 30.0,
    min_samples: Annotated[int, typer.Option(min=1)] = 30,
    lookback_days: Annotated[int, typer.Option(min=1)] = 365,
    csv_output: Annotated[str | None, typer.Option(help="Prediction CSV output path")] = None,
    json_output: Annotated[str | None, typer.Option(help="Prediction JSON output path")] = None,
) -> None:
    """Run leakage-safe rolling evaluation of arrival-delay probabilities."""
    provider = HistoricalCsvDelayProvider(
        dataset, min_samples=min_samples, lookback_days=lookback_days
    )
    report = rolling_backtest(provider, threshold_minutes=threshold)
    typer.echo("Arrival Delay Backtest")
    typer.echo("======================")
    typer.echo(
        f"Dataset: {report.dataset_date_start} to {report.dataset_date_end}"
    )
    typer.echo(f"Evaluation period: {report.date_start} to {report.date_end}")
    typer.echo(f"Test observations: {len(report.predictions):,}")
    typer.echo(f"Threshold: {threshold:g} minutes")
    typer.echo(f"Brier score: {report.brier_score:.3f}\n")
    typer.echo("Match levels:")
    for level in ("exact_flight", "carrier_route", "route", "peer_group"):
        count = sum(item.match_level == level for item in report.predictions)
        if count:
            typer.echo(f"{level.replace('_', '-'):18} {count / len(report.predictions):6.1%}")
    typer.echo("\nCalibration:")
    typer.echo(f"{'Predicted':12} {'N':>7} {'Mean pred.':>11} {'Observed':>10}")
    for bucket in report.calibration:
        if bucket.prediction_count:
            label = f"{bucket.lower_bound:.0%}-{bucket.upper_bound:.0%}"
            typer.echo(
                f"{label:12} {bucket.prediction_count:7d} "
                f"{bucket.mean_predicted_probability:11.1%} "
                f"{bucket.observed_frequency:10.1%}"
            )
    if csv_output:
        report.export_csv(csv_output)
    if json_output:
        report.export_json(json_output)


@app.command("ingest-eurocontrol")
def ingest_eurocontrol(
    raw_dataset: Annotated[str, typer.Option(help="EUROCONTROL ADRR Flights CSV")],
    airport_mapping: Annotated[
        str, typer.Option(help="CSV containing icao_code,iata_code")
    ],
    output: Annotated[
        str, typer.Option(help="Normalized .csv or .parquet output")
    ],
    quality_report: Annotated[
        str | None, typer.Option(help="Data-quality JSON output")
    ] = None,
    accept_filed_arrival_proxy: Annotated[
        bool,
        typer.Option(
            "--accept-filed-arrival-proxy",
            help=(
                "Acknowledge that ADRR FILED ARRIVAL TIME is a flight-plan "
                "proxy, not passenger scheduled arrival"
            ),
        ),
    ] = False,
    chunksize: Annotated[int, typer.Option(min=1)] = 100_000,
) -> None:
    """Normalize a locally downloaded EUROCONTROL ADRR Flights file."""
    statistics = ingest_eurocontrol_adrr(
        raw_dataset,
        output,
        airport_mapping=airport_mapping,
        quality_report_path=quality_report,
        accept_filed_arrival_proxy=accept_filed_arrival_proxy,
        chunksize=chunksize,
    )
    typer.echo(format_ingestion_statistics(statistics))


@app.command("inspect-adrr")
def inspect_adrr(
    raw_dataset: Annotated[str, typer.Option(help="EUROCONTROL ADRR Flights file")],
    report: Annotated[
        str | None, typer.Option(help="Optional schema-inspection JSON output")
    ] = None,
) -> None:
    """Strictly inspect a real ADRR file before normalization."""
    inspection = inspect_adrr_schema(raw_dataset, report_path=report)
    typer.echo(format_schema_inspection(inspection))


@app.command("first-adrr-run")
def first_adrr_run(
    raw_dataset: Annotated[str, typer.Option(help="EUROCONTROL ADRR Flights file")],
    airport_mapping: Annotated[
        str, typer.Option(help="CSV containing icao_code,iata_code")
    ],
    normalized_dataset: Annotated[
        str, typer.Option(help="Local normalized CSV or Parquet path")
    ] = "data/processed/adrr_flights.parquet",
    output: Annotated[
        str, typer.Option(help="Benchmark artifact directory")
    ] = "benchmark/output",
    accept_filed_arrival_proxy: Annotated[
        bool,
        typer.Option(
            "--accept-filed-arrival-proxy",
            help=(
                "Acknowledge that ADRR FILED ARRIVAL TIME is a flight-plan "
                "proxy, not passenger scheduled arrival"
            ),
        ),
    ] = False,
) -> None:
    """Run the frozen first ADRR workflow from raw file to benchmark report."""
    outcome = run_first_adrr_workflow(
        raw_dataset,
        airport_mapping,
        normalized_dataset=normalized_dataset,
        benchmark_output=output,
        accept_filed_arrival_proxy=accept_filed_arrival_proxy,
    )
    typer.echo(format_sanity_report(outcome["sanity"]))
    typer.echo(f"Run manifest: {outcome['manifest_path']}")


@app.command()
def benchmark(
    dataset: Annotated[
        str, typer.Option(help="Normalized historical .csv or .parquet dataset")
    ],
    airports: Annotated[
        str, typer.Option(help="Comma-separated IATA airports")
    ] = "BER,FRA,AMS,BUD",
    lookback_days: Annotated[int, typer.Option(min=1)] = 365,
    min_samples: Annotated[int, typer.Option(min=1)] = 30,
    route_min_total: Annotated[int, typer.Option(min=1)] = 200,
    route_min_test: Annotated[int, typer.Option(min=1)] = 50,
    output: Annotated[str, typer.Option(help="Benchmark artifact directory")] = "benchmark/output",
    quality_report: Annotated[
        str | None, typer.Option(help="Optional ingestion quality JSON")
    ] = None,
) -> None:
    """Run the reproducible multi-threshold real-data benchmark."""
    config = BenchmarkConfig(
        airports=tuple(item for item in airports.split(",") if item.strip()),
        lookback_days=lookback_days,
        min_samples=min_samples,
        route_min_total=route_min_total,
        route_min_test=route_min_test,
    )
    provider = HistoricalCsvDelayProvider(
        dataset, min_samples=1, lookback_days=lookback_days
    )
    observations = list(provider.observations)
    result = evaluate_benchmark(observations, config)
    quality = None
    if quality_report:
        quality = json.loads(Path(quality_report).read_text(encoding="utf-8"))
    paths = write_benchmark_outputs(
        result, observations, output, quality=quality
    )
    typer.echo("Connection Risk Real-Data Benchmark")
    typer.echo("===================================")
    typer.echo(f"Eligible target flights: {result.eligible_target_count:,}")
    for threshold in config.thresholds:
        metrics = result.metrics[f"{threshold:g}"]
        typer.echo(
            f"> {threshold:g} min: coverage={metrics['coverage']:.1%}, "
            f"Brier={metrics['model_brier']}, "
            f"BSS vs global={metrics['brier_skill_score_vs_global']}"
        )
    typer.echo(f"Report: {paths['report']}")


if __name__ == "__main__":
    app()
