# Chrome Web Store Unlisted Beta submission checklist

## Developer account

- [ ] Chrome Web Store developer account created.
- [ ] Developer registration fee handled.
- [ ] Publisher email verified.
- [ ] Google account 2-Step Verification enabled.

## Package

- [ ] Run `npm run check` successfully.
- [ ] Run a clean production build.
- [ ] Run `npm run package:chrome` and keep the reported ZIP and SHA-256.
- [ ] Confirm `manifest.json` is at the ZIP root.
- [ ] Confirm manifest version is `0.1.0` and higher than any previously uploaded version.
- [ ] Confirm 16, 32, 48 and 128 pixel icons are present.
- [ ] Confirm permissions and the Google Flights-only match pattern.
- [ ] Confirm there are no Skyscanner runtime files, remote code, datasets, tests,
  virtual environments or local artifacts in the ZIP.

## Store listing

- [ ] Paste the product name from `LISTING.md`.
- [ ] Paste the short description from `LISTING.md`.
- [ ] Paste and review the detailed description and beta notice.
- [ ] Capture and upload at least one real 1280×800 screenshot.
- [ ] Create and upload the 440×280 small promotional tile.
- [ ] Select the closest appropriate category.
- [ ] Select the listing language.
- [ ] Add the maintainer's support email or support URL.

## Privacy

- [ ] Publish `PRIVACY.md` at a stable public URL.
- [ ] Add that URL to the Store listing and Privacy Practices form.
- [ ] Enter the single-purpose declaration.
- [ ] Enter the `activeTab` and website-access justifications.
- [ ] Disclose local processing of visible Google Flights website content.
- [ ] Declare that the submitted package uses no remote code.
- [ ] Verify that all dashboard answers match `PRIVACY_ANSWERS.md`.

## Distribution

- [ ] Select **Unlisted** for the first beta submission. Do not default to Public.
- [ ] Confirm the dashboard explanation: anyone with the Web Store URL can install
  the extension, but it should not appear in normal Store discovery or search.

## Final submission

- [ ] Upload `release/connection-quality-google-flights-v0.1.0-beta.zip`.
- [ ] Resolve every dashboard validation error.
- [ ] Re-check the package version and listing one final time.
- [ ] Submit for review.
- [ ] Continue Load Unpacked alpha testing while review is pending.

