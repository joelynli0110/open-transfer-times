# Connection Quality for Google Flights (beta)

A Chrome extension that runs the [open-transfer-times](../packages/core)
engine on the itinerary open in Google Flights. Desktop Chrome, Google Flights
only. Not yet published in the Chrome Web Store; see the
[privacy policy](../PRIVACY.md) and the [store submission materials](../docs/chrome-web-store/).

## Using it

1. Open and expand a one-stop itinerary on Google Flights.
2. Select the Connection Quality badge in the lower-right corner.
3. Ticket evidence is read only from explicit ticket wording in the selected
   itinerary. Baggage wording is recorded separately and never proves whether
   a booking is protected.
4. If route extraction needs confirmation, or the ticket type is unknown, the
   extension shows the detected route and asks for **One protected ticket**,
   **Separate tickets**, or **Not sure** before analysing.
5. Results show the scheduled layover, the main factors, ticket protection, a
   verdict, and the reason when confidence is low. Heuristic allowances are not
   presented as measured passenger-specific times.

## Privacy and permissions

The extension processes the visible itinerary locally in the active Google
Flights page. It does not call a backend, store itinerary data, read browsing
history, or send page content anywhere.

Manifest V3 requests only `activeTab`, used when the user selects the toolbar
action. The content script is limited to Google Flights on `www.google.com`;
there is no `<all_urls>` access, background service worker, or analytics
provider. The analytics module emits local in-page events only.

## Extension-specific limitations

- Google Flights has no stable public DOM contract; detection can need fixture
  updates when its markup changes.
- The parser targets one expanded, one-stop desktop itinerary on
  `www.google.com/travel/flights`.
- If only a generic container or page accessibility text is available, the
  extension may extract the route for confirmation but forces the ticket type to
  `unknown`; it never derives ticket protection from page-wide text and never
  auto-analyses that fallback.
- If several itinerary candidates remain without a unique booking, dialog,
  selected or expanded signal, detection fails closed and asks the user to open
  one itinerary.
- Terminals, gates and airports are shown only when the open itinerary supplies
  them. An absent gate is shown as not published rather than guessed.

The engine's own limitations are listed in the [main README](../README.md#limitations).

## Architecture

```text
Google Flights
→ site adapter registry          (extension/src/adapters/)
→ NormalizedItinerary             (packages/core/src/itinerary.js)
→ assessment engine               (packages/core/src/engine.js, rules from airports/*.yaml)
→ extension UI                    (extension/src/content.js)
```

- `src/adapters/googleFlights/` holds all Google Flights parsing and selectors.
- `npm run build` copies the core engine files into `dist/core/`, so the
  extension and the npm library ship identical code.
- `src/analytics.js` is a provider-free event seam.
- `src/adapters/skyscanner/` is unregistered experimental code: not in the
  manifest, not copied to `dist/`.
- `src/service-worker.js` and the tester files are left over from the legacy
  localhost-API experiment and are not shipped.

## Development

From the repository root:

```bash
npm install
npm run build
```

Then in Chrome:

1. Open `chrome://extensions` and enable **Developer mode**.
2. Select **Load unpacked** and choose the repository's `dist/` directory.
3. Open or reload Google Flights and expand a one-stop itinerary.

After source changes, run `npm run check`, select **Reload** on the extension
card, and reload the Google Flights tab.

`npm run package:chrome` writes a reproducible Chrome Web Store ZIP to
`release/`, with `manifest.json` at the archive root.

The extension tests use extracted text and DOM stubs and never call live Google
Flights. They cover ticket scoping to the selected itinerary, confirmation
gating, overnight and localized time parsing, booking-URL extraction and
defensive parser failures.

## Manual checks before a test session

1. Open a protected connection, then confirm that an unrelated **Separate
   tickets** warning elsewhere on the results page does not change the selected
   itinerary's ticket status.
2. Open an explicit self-transfer. Confirm that the transfer rating comes from
   transfer steps while the ticket-protection warning becomes severe.
3. Open an itinerary with no explicit ticket evidence. Confirm that the
   extension asks for **One protected ticket**, **Separate tickets**, or
   **Not sure**.
4. Open a search-result itinerary without booking-URL certainty. Confirm that
   the route screen appears before any verdict.

Layovers are computed from local clock times, so results are identical in
every browser time zone. Layovers that span a daylight-saving change are
therefore off by an hour; [RFC 0001](../docs/rfcs/0001-context-dependent-rules.md)
proposes the fix.
