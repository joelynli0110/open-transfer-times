# Suggested Chrome Web Store Privacy Practices answers

These answers describe the shipped `0.1.0` beta package. Re-check them against the
dashboard wording before every submission.

## Single purpose

Provide structural connection-quality guidance for the one-stop flight itinerary
that the user is actively viewing on Google Flights.

## Permission justification — `activeTab`

`activeTab` is used when the user opens the extension toolbar popup on Google
Flights. It allows the popup to identify the active supported tab and exchange
state/open-panel messages with the content script on that tab. It is not used to
access unrelated tabs, browsing history, or pages outside the supported Google
Flights surface.

## Website access and content-script justification

The content script is restricted to `https://www.google.com/travel/flights*`.
Access is required to read the visible one-stop itinerary and display the
connection assessment directly on the same Google Flights page. No unrelated host
access is requested.

## Remote code

No remote code.

All executable JavaScript used by the beta is included in the submitted package.
The production manifest has no remote script references, background service worker,
or remotely hosted dependency.

## Website content / data handling disclosure

The extension processes website content from the actively viewed Google Flights
page. This may include airport codes, flight segments, dates and scheduled times,
connection duration, terminal or gate information when available, and explicit
baggage or ticket-related wording. This processing is necessary for the extension's
single purpose.

The processing occurs locally in the browser. The shipped beta does not transmit
this information to the developer or a third party and does not persist it in
Chrome storage, local storage, or a remote database.

## Analytics

No remote analytics provider is included. Local page events are not transmitted
off the device.

## Selling, sharing and secondary uses

User or itinerary information is not sold, shared, rented, used for advertising,
used for credit decisions, or used for purposes unrelated to connection-quality
guidance.

## Certifications to verify in the dashboard

- Data use is limited to the extension's disclosed single purpose.
- Data is not sold or transferred to third parties.
- Data is not used for advertising or unrelated personalized content.
- Website content is processed locally only for the core user-facing feature.
- The privacy policy URL matches the published `PRIVACY.md` content.

