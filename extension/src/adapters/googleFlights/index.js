(function exposeGoogleFlightsAdapter(root, factory) {
  const parser = typeof module === "object" && module.exports
    ? require("./parser.js")
    : root.GoogleFlightsParser;
  const models = typeof module === "object" && module.exports
    ? require("connection-risk-core/src/itinerary.js")
    : root.ConnectionQualityModels;
  const api = factory(parser, models);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.GoogleFlightsAdapter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createAdapter(parser, models) {
  "use strict";

  function fromLegacyItinerary(parsed, ticketDetection = null, baggageDetection = null) {
    const ticket = ticketDetection || {
      status: parsed.selfTransferDetected ? "separate" : "unknown",
      confidence: parsed.selfTransferDetected ? "high" : "low",
      basis: parsed.selfTransferDetected
        ? "Google Flights shows separate-ticket handling."
        : "The visible itinerary does not state the ticket protection."
    };
    const baggage = baggageDetection || { confidence: "low", evidence: [] };
    return models.createNormalizedItinerary({
      source: "google-flights",
      ticketStatusHint: ticket.status,
      ticketStatusConfidence: ticket.confidence,
      ticketStatusBasis: ticket.basis,
      baggageEvidence: baggage,
      baggageRecheckRequired: baggage.recheckRequired === true,
      segments: [
        {
          flightNumber: parsed.inboundFlight,
          origin: parsed.origin,
          destination: parsed.connectionAirport,
          arrivalTime: parsed.scheduledArrival,
          ...parsed.inboundDetails
        },
        {
          flightNumber: parsed.outboundFlight,
          origin: parsed.connectionAirport,
          destination: parsed.destination,
          departureTime: parsed.scheduledDeparture,
          ...parsed.outboundDetails
        }
      ]
    });
  }

  function extract(documentObject, options = {}) {
    const parsed = parser.parseGoogleFlightsDocument(documentObject, options);
    if (!parsed.ok) return parsed;
    const normalized = fromLegacyItinerary(parsed.itinerary, parsed.ticketEvidence, parsed.baggageEvidence);
    if (!normalized.ok) return normalized;
    return {
      ok: true,
      itinerary: normalized.itinerary,
      fingerprint: parsed.fingerprint,
      confidence: parsed.confidence,
      message: parsed.confidence === "high"
        ? "Itinerary matched the selected booking."
        : "Confirm the detected route and ticket type before analysis."
    };
  }

  return { extract, fromLegacyItinerary };
});
