(function exposeAirportRules(root, factory) {
  const data = typeof module === "object" && module.exports
    ? require("./data/airport-data.generated.js")
    : root.ConnectionQualityAirportData;
  const catalog = typeof module === "object" && module.exports
    ? require("./airport-catalog.js")
    : root.ConnectionQualityAirportCatalog;
  const api = factory(data, catalog);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ConnectionQualityAirportRules = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createAirportRules(data, catalog) {
  "use strict";

  // The transfer data lives in airports/*.yaml and regions/schengen.yaml.
  // This module only adapts the generated data to the engine's rule shape.

  function toRule(profile) {
    const { allowances } = profile;
    return Object.freeze({
      name: profile.name,
      baseTransferMinutes: allowances.baseTransfer.minutes,
      passportMinutes: allowances.passportControl.minutes,
      terminalChangeMinutes: allowances.terminalChange.minutes,
      securityMinutes: allowances.securityRescreening.minutes
    });
  }

  const AIRPORT_RULES = Object.freeze(Object.fromEntries(
    Object.entries(data.airports).map(([iata, profile]) => [iata, toRule(profile)])
  ));
  const FALLBACK_RULE = toRule(data.baseline);
  const SCHENGEN_COUNTRIES = new Set(data.schengen.countries);
  const OUTSIDE_SCHENGEN = new Set(data.schengen.outsideSchengen);

  // A profile's country wins; otherwise the catalog (OurAirports) gives it.
  function countryForAirport(airport) {
    const code = String(airport || "").toUpperCase();
    return data.airports[code]?.country || catalog?.countryForAirport(code);
  }

  function continentForAirport(airport) {
    return catalog?.continentForAirport(String(airport || "").toUpperCase());
  }

  function travelZone(airport) {
    const code = String(airport || "").toUpperCase();
    const country = countryForAirport(code);
    if (!country) return "unknown";
    return SCHENGEN_COUNTRIES.has(country) && !OUTSIDE_SCHENGEN.has(code) ? "schengen" : "non-schengen";
  }

  // Full transfer profile including allowance bases, facts and sources,
  // or undefined when the airport has no profile of its own.
  function getAirportProfile(iata) {
    return data.airports[String(iata || "").toUpperCase()];
  }

  function listAirportProfiles() {
    return Object.values(data.airports);
  }

  return {
    AIRPORT_RULES,
    FALLBACK_RULE,
    SCHENGEN_COUNTRIES,
    travelZone,
    countryForAirport,
    continentForAirport,
    getAirportProfile,
    listAirportProfiles
  };
});
