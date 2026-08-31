# Google Flights extension source

The active Google Flights-only Manifest V3 source is in this directory. Build it from the repository root with `npm run build`, then load `dist/` in Chrome. See the root [README](../README.md) for product scope, architecture, privacy, tests, and installation.

The Skyscanner adapter files are retained only as unregistered experimental code. They are not referenced by the production manifest or copied to `dist/`.

`src/service-worker.js` and the tester files are preserved from the legacy v0.4 localhost-API experiment. They are not referenced by `manifest.json` and are not copied to `dist/`.
