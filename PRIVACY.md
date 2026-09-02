# Privacy Policy — Connection Quality for Google Flights BETA

Effective date: September 2, 2026

This policy describes the data handling of the current `0.1.0` beta extension.

## Data processed

While the extension is running on a supported Google Flights page, it may inspect
visible page content to identify the one-stop itinerary currently being viewed.
The information used for the assessment may include:

- airport codes and airport names;
- flight segments and travel dates;
- scheduled arrival and departure times;
- connection duration;
- terminal and gate information when published on the page; and
- explicit baggage or ticket-related wording when available.

The extension uses this information only to detect the itinerary and generate the
connection-quality assessment shown to the user.

## Local processing and transmission

The shipped beta performs itinerary detection and assessment locally in the
browser. It does not transmit itinerary information to a developer-operated
backend, an analytics service, or another third party. The production package does
not load or execute remote code.

## Storage

The beta keeps the current detected itinerary and assessment only in the page's
temporary memory. It does not use Chrome storage, local storage, or a remote
database to persist itinerary information. Closing or reloading the page clears
that in-memory state.

## Analytics

The beta has no remote analytics provider. It emits local browser-page events for
extension states such as detection and assessment, but those events are not sent
off the device by the shipped extension.

## Selling or sharing

The developer does not sell, rent, or share user information or itinerary
information. The extension does not use itinerary information for advertising,
credit decisions, or purposes unrelated to its single connection-guidance
function.

## Permissions and page access

- `activeTab` lets the toolbar popup identify the active Google Flights tab and
  exchange state/open-panel messages with the extension running on that tab. It
  is not used to read unrelated tabs or browsing history.
- The content script is restricted to
  `https://www.google.com/travel/flights*` so the extension can inspect the visible
  itinerary and display the assessment directly on Google Flights.

## Future changes

This policy and the Chrome Web Store disclosures will be updated before any future
release introduces server-side processing, remote analytics, additional website
access, or other new data handling. New behavior will not be covered retroactively
by this beta policy.

## Contact

Before Store submission, the maintainer will publish this policy at a stable public
URL and add the support email or support URL used in the Chrome Web Store listing.

