(function exposeSkyscannerAdapter(root, factory) {
  const parser = typeof module === "object" && module.exports
    ? require("./parser.js")
    : root.SkyscannerParser;
  const models = typeof module === "object" && module.exports
    ? require("open-transfer-times/src/itinerary.js")
    : root.ConnectionQualityModels;
  const api = factory(parser, models);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.SkyscannerAdapter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createAdapter(parser, models) {
  "use strict";

  function extract(documentObject, options = {}) {
    const parsed = parser.parseSkyscannerDocument(documentObject, options);
    if (!parsed.ok) return parsed;
    const ticket = parsed.ticketEvidence || { status: "unknown", confidence: "low" };
    const baggage = parsed.baggageEvidence || { confidence: "low", evidence: [] };
    const normalized = models.createNormalizedItinerary({
      source: "skyscanner",
      ticketStatusHint: ticket.status,
      ticketStatusConfidence: ticket.confidence,
      ticketStatusBasis: ticket.basis,
      baggageEvidence: baggage,
      baggageRecheckRequired: baggage.recheckRequired === true,
      segments: [
        {
          flightNumber: parsed.itinerary.inboundFlight,
          origin: parsed.itinerary.origin,
          destination: parsed.itinerary.connectionAirport,
          arrivalTime: parsed.itinerary.scheduledArrival,
          ...parsed.itinerary.inboundDetails
        },
        {
          flightNumber: parsed.itinerary.outboundFlight,
          origin: parsed.itinerary.connectionAirport,
          destination: parsed.itinerary.destination,
          departureTime: parsed.itinerary.scheduledDeparture,
          ...parsed.itinerary.outboundDetails
        }
      ]
    });
    if (!normalized.ok) return normalized;
    return {
      ok: true,
      itinerary: normalized.itinerary,
      fingerprint: parsed.fingerprint,
      confidence: parsed.confidence,
      message: parsed.confidence === "high"
        ? "Itinerary matched the open Skyscanner details."
        : "Confirm the detected route and ticket type before analysis."
    };
  }

  return { extract };
});
