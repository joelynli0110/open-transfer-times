const test = require("node:test");
const assert = require("node:assert/strict");

globalThis.GoogleFlightsAdapter = { extract: () => ({ ok: true, source: "google" }) };
delete require.cache[require.resolve("../src/adapters/index.js")];
const registry = require("../src/adapters/index.js");

test("registers only Google Flights for the alpha", () => {
  assert.equal(registry.sourceForLocation({ hostname: "www.google.com", pathname: "/travel/flights/search" }).id, "google-flights");
  assert.equal(registry.sourceForLocation({ hostname: "www.skyscanner.de", pathname: "/transport/flights" }), null);
  assert.equal(registry.supports({ hostname: "www.skyscanner.de", pathname: "/transport/flights" }), false);
  assert.equal(registry.supports({ hostname: "example.com", pathname: "/" }), false);
});
