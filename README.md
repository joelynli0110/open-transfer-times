# Open Transfer Times

**Is this flight connection comfortable, tight, or risky?** An open, sourced
dataset of airport transfer rules, a deterministic engine that explains its
verdict, and a Google Flights extension built on top.

Airlines and booking systems decide whether a connection is feasible using
*minimum connection times* (MCT) — commercial data sold by IATA and schedule
providers. Open flight-search tools can find itineraries but cannot say whether
a layover is realistic. This project collects what airports and airlines
publish openly, cites every fact, and marks every estimate as an estimate.

| Part | What it is |
| --- | --- |
| [`airports/`](airports) | One YAML file per airport: transfer allowances, sourced facts, citations. **Contributions welcome.** |
| [`packages/core`](packages/core) | `open-transfer-times`: dependency-free engine that turns an itinerary into an explained assessment. |
| [`extension/`](extension) | Chrome extension that runs the engine on the itinerary open in Google Flights (beta). |

```js
const { assessConnection } = require("open-transfer-times");

assessConnection(
  { segments: [
    { origin: "BER", destination: "LHR", arrivalTime: "2026-09-20T10:00:00" },
    { origin: "LHR", destination: "PVG", departureTime: "2026-09-20T11:30:00" }
  ] },
  { ticketStatus: "protected" }
).quality; // "reasonable" — 90 min layover, 55 min of transfer steps
```

## Airport data

Thirteen hub airports have their own profile; every other airport falls back to
a transparent [standard baseline](airports/_baseline.yaml). Each minute value
carries a `basis`:

- `heuristic` — a rule-of-thumb estimate, not yet backed by a source;
- `sourced` — derived from a cited fact.

Facts confirm transfer steps (for example that Heathrow, Hong Kong, Changi and
Incheon screen transfer passengers again) and link to the official page they
come from. [`airports/COVERAGE.md`](airports/COVERAGE.md) shows how well each
airport is sourced. To add or improve an airport, see
[CONTRIBUTING.md](CONTRIBUTING.md) — no code required.

This is not an official MCT table, and it does not predict delays.

## How the assessment works

The model is deterministic. Structural feasibility starts with the scheduled
layover and deducts the physical transfer steps that apply at the connection
airport: a base transfer allowance, Schengen border control when the transfer
crosses the Schengen border at a Schengen airport, terminal changes when known,
security re-screening, and explicit baggage re-check. The remaining margin maps
to `comfortable` (≥ 45 min), `reasonable` (≥ 25), `tight` (≥ 5) or `risky`.

Ticket protection is evaluated separately as disruption exposure: separate
tickets change the warning and verdict, but do not consume physical transfer
time by themselves.

## Google Flights extension (beta)

Google Flights desktop only. Chrome Web Store listing: **not yet published**.
See the [privacy policy](PRIVACY.md) and
[Chrome Web Store submission materials](docs/chrome-web-store/).

1. Open and expand a one-stop itinerary on Google Flights.
2. Select the Connection Quality badge in the lower-right corner.
3. Ticket evidence is read only from explicit ticket wording in the selected itinerary. Baggage wording is recorded separately and never proves whether a booking is protected.
4. If route extraction needs confirmation—or ticket type is unknown—the extension shows the detected route and asks for **One protected ticket**, **Separate tickets**, or **Not sure** before analysis.
5. Results show the scheduled layover, qualitative main factors, ticket protection, and a verdict. Heuristic process allowances are not presented as measured passenger-specific times.

## Current limitations

- Google Flights has no stable public DOM contract. Detection can require fixture updates when its accessible markup changes.
- The parser targets one expanded, one-stop desktop itinerary on `www.google.com/travel/flights`.
- If only a generic container or page accessibility text is available, the extension may extract the route for confirmation but forces ticket type to `unknown`; it never derives ticket protection from page-wide text and never auto-analyzes that fallback.
- If multiple viable itinerary candidates remain without a unique booking, active-dialog, selected, or expanded signal, detection fails closed and asks the user to open one itinerary.
- Airport-specific rules cover 13 hubs; other airports use the standard international-transfer baseline. Most minute values are still heuristic (see [coverage](airports/COVERAGE.md)).
- The Schengen/non-Schengen airport map in [`regions/schengen.yaml`](regions/schengen.yaml) covers common routes, not every airport.
- Schengen passport-control logic applies only when the connection airport is itself in Schengen; it does not claim to model every jurisdiction's transit-immigration rules.
- Terminal changes are used only when known; the extension does not guess missing terminal data.
- Airport, terminal, and gate values are displayed only when supplied by the open itinerary. Gates are usually assigned near departure, so an absent gate is shown as not published rather than guessed.
- There is no historical delay prediction, calibrated missed-connection probability, live gate feed, weather, rebooking, account, payment, or booking functionality.

## Privacy and permissions

The extension processes the visible itinerary locally in the active Google Flights page. It does not call a backend, store itinerary data, read browsing history, or send arbitrary page content anywhere.

Manifest V3 requests only `activeTab`, used when the user selects the toolbar action to open the page panel. The content script is limited to Google Flights on `www.google.com`; there is no `<all_urls>` access, background service worker, or analytics provider. The analytics abstraction emits local in-page events only and is ready for a privacy-reviewed provider later.

## Architecture

```text
Google Flights
→ site adapter registry
→ NormalizedItinerary                 (packages/core)
→ deterministic Connection Quality Engine  (packages/core, rules from airports/*.yaml)
→ ConnectionAssessment
→ Chrome Extension UI
```

- `extension/src/adapters/googleFlights/` contains all Google Flights parsing and selectors.
- `airports/*.yaml` and `regions/schengen.yaml` are the editable transfer dataset; `npm run airports:build` validates them and generates `packages/core/src/data/airport-data.generated.js`.
- `packages/core/src/airport-catalog.js` is generated from the public-domain OurAirports dataset.
- `packages/core/src/itinerary.js` owns the stable source-neutral segment model.
- `packages/core/src/airport-rules.js` adapts the generated dataset to engine rules.
- `packages/core/src/engine.js` contains DOM-free assessment logic. `npm run build` copies the core files into `dist/core/`, so the extension and the library ship identical code.
- `extension/src/content.js` renders the lightweight badge, confirmation flow, and detail panel.
- `extension/src/analytics.js` defines the provider-free event seam.

The extension contains only public structural rules. A future server-backed implementation can replace the engine behind the same normalized input and assessment output without coupling DOM selectors to commercial logic.

The Skyscanner adapter source remains in `extension/src/adapters/skyscanner/` as unregistered experimental code. It is not referenced by the production manifest, copied into `dist/`, or supported in this alpha.

## Legacy research code

The Python package under `src/connection_risk/`, ADRR ingestion under `src/connection_risk/ingestion/`, historical providers, simulation, calibration/benchmarking tests, datasets, API, and the unused v0.4 extension service worker are preserved as earlier experiments. They are outside the MVP build and runtime path.

`npm run build` copies only the files referenced by the current manifest into `dist/`. It does not package the legacy localhost API service worker or diagnostic pages. No ADRR file, historical dataset, Python service, or delay distribution is required to build or run the MVP.

## Local development

Requirements: Node.js 20+ and Chrome desktop.

```powershell
npm install
npm run build
```

Normal installation and production builds use the committed runtime catalog at `packages/core/src/airport-catalog.js`; they do not require `data/public/` or any local dataset. Developers may optionally refresh that catalog with:

```powershell
npm run airports:catalog
```

This maintenance command requires `data/public/airports.csv`. The source CSV is intentionally ignored and is not needed for `npm install`, `npm run check`, or `npm run build`.

Then in Chrome:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose this repository's `dist/` directory.
5. Open or reload Google Flights and expand a one-stop itinerary.

After source changes, run `npm run check`, then select **Reload** on the extension card and reload the Google Flights tab.

Create the reproducible Chrome Web Store submission package with:

```powershell
npm run package:chrome
```

The generated ZIP is written to `release/` with `manifest.json` at the archive root.

## Tests

```powershell
npm run check
```

The release gate validates the airport dataset (and that generated files are current), runs syntax checks, the core and extension tests, and the production extension build. The test runner is compatible with the declared Node.js 20+ range and does not depend on newer `node --test` isolation flags.

Run the preserved Python research suite separately if you change legacy code:

```powershell
.\.venv\Scripts\python.exe -m pytest
```

Node tests cover airport-dataset validation and provenance, normalized-model validation, selected-itinerary ticket scoping, deterministic structural quality bands, protection exposure, explicit baggage re-check processes, DST-safe wall-clock arithmetic, confirmation gating, unsupported-airport fallback, overnight parsing, localized time formats, booking URL extraction, and defensive parser failures. They use extracted text/DOM stubs and never call live Google Flights.

## Alpha manual checks

Before an alpha session, verify these cases on Google Flights:

1. Open a normal protected connection, then confirm that an unrelated **Separate tickets** warning elsewhere on the results page does not change the selected itinerary's ticket status.
2. Open an explicit self-transfer. Confirm that the physical quality is based on transfer processes while the ticket-protection warning becomes severe.
3. Open an itinerary with no explicit ticket evidence. Confirm that the extension asks for **One protected ticket**, **Separate tickets**, or **Not sure**.
4. Open a search-result itinerary without booking-URL certainty. Confirm that the route screen appears before any quality verdict.
5. Run the extension tests on machines in different timezones. The included DST regression expects `01:30 → 03:30` to remain 120 minutes and `23:30 → 01:00` the next day to remain 90 minutes.
