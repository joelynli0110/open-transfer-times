# Chrome Web Store asset preparation

Use real screenshots captured from the production `dist/` build. Do not fabricate
Google Flights screens, results, gates, or itinerary data. Before capture, use a
test itinerary and remove or crop any personal details, booking references, account
information, or unrelated browser content.

## Extension icons — complete

The package includes PNG derivatives of `assets/icon-source.png` at:

- `extension/icons/icon-16.png` — 16×16
- `extension/icons/icon-32.png` — 32×32
- `extension/icons/icon-48.png` — 48×48
- `extension/icons/icon-128.png` — 128×128

The icon uses a dark navy airplane, a pale-blue connection route and a clock on a
light rounded-square background. It does not use Google Flights, airline, airport,
or third-party logos. The high-resolution source image remains outside the
production extension package.

## Screenshot 1 — Main value proposition (required primary image)

- Dimensions: 1280×800 pixels.
- Show a real Google Flights desktop page with one expanded connection itinerary.
- Open the Connection Quality panel.
- Keep the route, scheduled layover, main factors and one clear Comfortable,
  Reasonable, or Tight result visible.
- Frame the product UI as the focal point while retaining enough Google Flights
  context to make the workflow understandable.
- Suggested filename: `screenshot-1-main-value-1280x800.png`.

## Screenshot 2 — Confirmation and ticket status

- Dimensions: 1280×800 pixels.
- Show the detected itinerary confirmation state.
- Include the One protected ticket, Separate tickets, and Not sure choices.
- Do not imply that the extension detected ticket status if the source evidence is
  actually unknown.
- Suggested filename: `screenshot-2-ticket-confirmation-1280x800.png`.

## Screenshot 3 — Comfortable example (recommended)

- Dimensions: 1280×800 pixels.
- Show a real itinerary with a Comfortable assessment to contrast with the primary
  screenshot.
- Keep the scheduled layover and supporting factors readable.
- Suggested filename: `screenshot-3-comfortable-1280x800.png`.

Chrome Web Store requires at least one 1280×800 screenshot and accepts up to five.
Capture the current production UI only; do not reuse outdated mockups under
`docs/screenshots/` without confirming that they exactly match the beta.

## Small promotional tile — maintainer must create

- Required dimensions: 440×280 pixels.
- Format: PNG or JPEG.
- Use the extension's muted blue icon identity on a clearly defined background.
- Do not use Google Flights branding, Google logos, airline logos, screenshots, or
  misleading flight imagery.
- Keep copy minimal and legible when reduced. Suggested layout:

```text
Connection Quality

Comfortable · Tight · Risky

Before you book.
```

Prefer the icon plus a short value statement rather than dense text. Suggested
filename: `promo-small-440x280.png`.

## Final visual review

- Verify exact pixel dimensions.
- Verify that screenshots reflect `v0.1.0` behavior.
- Verify that no personal or booking information is visible.
- Verify that text remains readable at Store thumbnail size.
- Verify that no asset suggests affiliation with Google or guarantees a connection.
