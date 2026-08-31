# Connection Quality for Google Flights

See whether an international flight connection is comfortable, tight, or risky before you book.

Connection Quality is a small Chrome extension that adds structural connection guidance directly to Google Flights. It reads the one-stop itinerary currently open on the page, requires confirmation whenever extraction or ticket status is uncertain, and returns an explainable `Comfortable`, `Reasonable`, `Tight`, or `Risky` assessment.

It evaluates booking-time connection quality from the scheduled itinerary structure.

## MVP experience

1. Open and expand a one-stop itinerary on Google Flights.
2. Select the Connection Quality badge in the lower-right corner.
3. Ticket evidence is read only from explicit ticket wording in the selected itinerary. Baggage wording is recorded separately and never proves whether a booking is protected.
4. If route extraction needs confirmation—or ticket type is unknown—the extension shows the detected route and asks for **One protected ticket**, **Separate tickets**, or **Not sure** before analysis.
5. Results show the scheduled layover, qualitative main factors, ticket protection, and a verdict. Heuristic process allowances are not presented as measured passenger-specific times.

The model is deterministic. Structural feasibility starts with scheduled layover time and accounts for physical airport processes such as Schengen border control at Schengen connection airports, terminal/security steps, and explicit baggage re-check requirements. Ticket protection is evaluated separately as disruption exposure: separate tickets change the warning and verdict, but do not consume physical transfer time by themselves.

## Supported airports

Airport-specific transfer assumptions currently exist for:

- Amsterdam Schiphol (AMS)
- Dubai (DXB)
- Doha Hamad (DOH)
- Frankfurt (FRA)
- Hong Kong (HKG)
- Istanbul (IST)
- London Heathrow (LHR)
- Munich (MUC)
- Paris Charles de Gaulle (CDG)
- Seoul Incheon (ICN)
- Singapore Changi (SIN)
- Tokyo Haneda (HND)
- Tokyo Narita (NRT)

The bundled public airport catalog supplies names for more than 9,000 IATA-coded airports. Airports without a defensible airport-specific transfer rule use a transparent standard international-transfer baseline; name coverage never implies model-specific transfer accuracy.

## Current limitations

- Google Flights has no stable public DOM contract. Detection can require fixture updates when its accessible markup changes.
- The parser targets one expanded, one-stop desktop itinerary on `www.google.com/travel/flights`.
- If only a generic container or page accessibility text is available, the extension may extract the route for confirmation but forces ticket type to `unknown`; it never derives ticket protection from page-wide text and never auto-analyzes that fallback.
- If multiple viable itinerary candidates remain without a unique booking, active-dialog, selected, or expanded signal, detection fails closed and asks the user to open one itinerary.
- Airport-specific rules focus on the hubs above; other airports use the standard international-transfer baseline.
- The small Schengen/non-Schengen region map covers common MVP routes, not every airport.
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
→ NormalizedItinerary
→ deterministic Connection Quality Engine
→ ConnectionAssessment
→ Chrome Extension UI
```

- `extension/src/adapters/googleFlights/` contains all Google Flights parsing and selectors.
- `extension/src/data/airport-catalog.js` is generated from the public-domain OurAirports dataset.
- `extension/src/models/normalized-itinerary.js` owns the stable source-neutral segment model.
- `extension/src/engine/airport-rules.js` contains the extensible public airport assumptions.
- `extension/src/engine/connection-quality.js` contains DOM-free assessment logic.
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

Normal installation and production builds use the committed runtime catalog at `extension/src/data/airport-catalog.js`; they do not require `data/public/` or any local dataset. Developers may optionally refresh that catalog with:

```powershell
npm run airports
```

This maintenance command requires `data/public/airports.csv`. The source CSV is intentionally ignored and is not needed for `npm install`, `npm run check`, or `npm run build`.

Then in Chrome:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose this repository's `dist/` directory.
5. Open or reload Google Flights and expand a one-stop itinerary.

After source changes, run `npm run check`, then select **Reload** on the extension card and reload the Google Flights tab.

## Tests

```powershell
npm run check
```

The release gate runs syntax checks, all extension tests, and the production extension build. The test runner is compatible with the declared Node.js 20+ range and does not depend on newer `node --test` isolation flags.

Run the preserved Python research suite separately if you change legacy code:

```powershell
.\.venv\Scripts\python.exe -m pytest
```

Node tests cover normalized-model validation, selected-itinerary ticket scoping, deterministic structural quality bands, protection exposure, explicit baggage re-check processes, DST-safe wall-clock arithmetic, confirmation gating, unsupported-airport fallback, overnight parsing, localized time formats, booking URL extraction, and defensive parser failures. They use extracted text/DOM stubs and never call live Google Flights.

## Alpha manual checks

Before an alpha session, verify these cases on Google Flights:

1. Open a normal protected connection, then confirm that an unrelated **Separate tickets** warning elsewhere on the results page does not change the selected itinerary's ticket status.
2. Open an explicit self-transfer. Confirm that the physical quality is based on transfer processes while the ticket-protection warning becomes severe.
3. Open an itinerary with no explicit ticket evidence. Confirm that the extension asks for **One protected ticket**, **Separate tickets**, or **Not sure**.
4. Open a search-result itinerary without booking-URL certainty. Confirm that the route screen appears before any quality verdict.
5. Run the extension tests on machines in different timezones. The included DST regression expects `01:30 → 03:30` to remain 120 minutes and `23:30 → 01:00` the next day to remain 90 minutes.
