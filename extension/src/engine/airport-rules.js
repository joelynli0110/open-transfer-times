(function exposeAirportRules(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ConnectionQualityAirportRules = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createAirportRules() {
  "use strict";

  const AIRPORT_RULES = Object.freeze({
    FRA: { name: "Frankfurt", baseTransferMinutes: 35, passportMinutes: 20, terminalChangeMinutes: 15, securityMinutes: 0 },
    MUC: { name: "Munich", baseTransferMinutes: 30, passportMinutes: 20, terminalChangeMinutes: 12, securityMinutes: 0 },
    AMS: { name: "Amsterdam Schiphol", baseTransferMinutes: 30, passportMinutes: 20, terminalChangeMinutes: 0, securityMinutes: 0 },
    CDG: { name: "Paris Charles de Gaulle", baseTransferMinutes: 40, passportMinutes: 25, terminalChangeMinutes: 20, securityMinutes: 10 },
    LHR: { name: "London Heathrow", baseTransferMinutes: 40, passportMinutes: 0, terminalChangeMinutes: 25, securityMinutes: 15 },
    IST: { name: "Istanbul", baseTransferMinutes: 35, passportMinutes: 0, terminalChangeMinutes: 10, securityMinutes: 10 },
    DOH: { name: "Doha Hamad", baseTransferMinutes: 30, passportMinutes: 0, terminalChangeMinutes: 0, securityMinutes: 10 },
    DXB: { name: "Dubai", baseTransferMinutes: 35, passportMinutes: 0, terminalChangeMinutes: 20, securityMinutes: 10 },
    SIN: { name: "Singapore Changi", baseTransferMinutes: 30, passportMinutes: 0, terminalChangeMinutes: 15, securityMinutes: 10 },
    HKG: { name: "Hong Kong", baseTransferMinutes: 30, passportMinutes: 0, terminalChangeMinutes: 10, securityMinutes: 10 },
    NRT: { name: "Tokyo Narita", baseTransferMinutes: 35, passportMinutes: 0, terminalChangeMinutes: 20, securityMinutes: 10 },
    HND: { name: "Tokyo Haneda", baseTransferMinutes: 35, passportMinutes: 0, terminalChangeMinutes: 20, securityMinutes: 10 },
    ICN: { name: "Seoul Incheon", baseTransferMinutes: 30, passportMinutes: 0, terminalChangeMinutes: 15, securityMinutes: 10 }
  });

  const SCHENGEN_AIRPORTS = new Set([
    "AMS", "ARN", "ATH", "BCN", "BER", "BLL", "BRU", "BUD", "CDG", "CPH", "DUS", "FCO", "FRA", "GVA", "HAM", "HEL", "KEF", "LIS", "LYS", "MAD", "MUC", "MXP", "NAP", "NCE", "OSL", "PRG", "RIX", "STR", "TLL", "VCE", "VIE", "WAW", "ZRH"
  ]);
  const NON_SCHENGEN_AIRPORTS = new Set([
    "ATL", "BKK", "BOS", "DEL", "DOH", "DXB", "EWR", "HKG", "HND", "ICN", "IST", "JFK", "LAX", "LHR", "NRT", "ORD", "PEK", "PVG", "SEA", "SIN", "SFO", "SYD", "YYZ"
  ]);

  function travelZone(airport) {
    if (SCHENGEN_AIRPORTS.has(airport)) return "schengen";
    if (NON_SCHENGEN_AIRPORTS.has(airport)) return "non-schengen";
    return "unknown";
  }

  return { AIRPORT_RULES, SCHENGEN_AIRPORTS, NON_SCHENGEN_AIRPORTS, travelZone };
});
