(function exposeAdapterRegistry(root, factory) {
  const api = factory(root.GoogleFlightsAdapter);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ConnectionQualityAdapters = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createRegistry(googleFlights) {
  "use strict";

  function sourceForLocation(locationObject) {
    const hostname = locationObject?.hostname || "";
    const pathname = locationObject?.pathname || "";
    if (hostname === "www.google.com" && pathname.startsWith("/travel/flights")) {
      return { id: "google-flights", label: "Google Flights", adapter: googleFlights };
    }
    return null;
  }

  function supports(locationObject) {
    return Boolean(sourceForLocation(locationObject)?.adapter);
  }

  function extract(documentObject, locationObject) {
    const source = sourceForLocation(locationObject);
    if (!source?.adapter) return { ok: false, code: "UNSUPPORTED_SITE", message: "This flight site is not supported yet." };
    return source.adapter.extract(documentObject);
  }

  return { sourceForLocation, supports, extract };
});
