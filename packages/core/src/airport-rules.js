(function exposeAirportRules(root, factory) {
  const data = typeof module === "object" && module.exports
    ? require("./data/airport-data.generated.js")
    : root.ConnectionQualityAirportData;
  const api = factory(data);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ConnectionQualityAirportRules = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createAirportRules(data) {
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
  const SCHENGEN_AIRPORTS = new Set(data.schengen.airports);
  const NON_SCHENGEN_AIRPORTS = new Set(data.schengen.nonSchengenAirports);

  function travelZone(airport) {
    if (SCHENGEN_AIRPORTS.has(airport)) return "schengen";
    if (NON_SCHENGEN_AIRPORTS.has(airport)) return "non-schengen";
    return "unknown";
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
    SCHENGEN_AIRPORTS,
    NON_SCHENGEN_AIRPORTS,
    travelZone,
    getAirportProfile,
    listAirportProfiles
  };
});
