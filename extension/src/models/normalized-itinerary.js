(function exposeNormalizedItinerary(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ConnectionQualityModels = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createModels() {
  "use strict";

  const IATA_PATTERN = /^[A-Z]{3}$/;

  function normalizeAirport(value) {
    const airport = String(value || "").trim().toUpperCase();
    return IATA_PATTERN.test(airport) ? airport : null;
  }

  function normalizeSegment(segment) {
    const origin = normalizeAirport(segment?.origin);
    const destination = normalizeAirport(segment?.destination);
    if (!origin || !destination) return null;
    return {
      flightNumber: segment.flightNumber ? String(segment.flightNumber).replace(/[\s-]+/g, "").toUpperCase() : undefined,
      origin,
      destination,
      departureTime: segment.departureTime || undefined,
      arrivalTime: segment.arrivalTime || undefined,
      originName: segment.originName ? String(segment.originName).trim() : undefined,
      destinationName: segment.destinationName ? String(segment.destinationName).trim() : undefined,
      departureTerminal: segment.departureTerminal ? String(segment.departureTerminal).trim() : undefined,
      arrivalTerminal: segment.arrivalTerminal ? String(segment.arrivalTerminal).trim() : undefined,
      departureGate: segment.departureGate ? String(segment.departureGate).trim() : undefined,
      arrivalGate: segment.arrivalGate ? String(segment.arrivalGate).trim() : undefined,
      airline: segment.airline || undefined
    };
  }

  function createNormalizedItinerary(input) {
    const segments = Array.isArray(input?.segments) ? input.segments.map(normalizeSegment) : [];
    if (segments.length < 2 || segments.some((segment) => !segment)) {
      return { ok: false, code: "INVALID_SEGMENTS", message: "At least two valid flight segments are required." };
    }
    for (let index = 0; index < segments.length - 1; index += 1) {
      if (segments[index].destination !== segments[index + 1].origin) {
        return { ok: false, code: "DISCONNECTED_SEGMENTS", message: "The detected flight segments do not form one connection." };
      }
    }
    return {
      ok: true,
      itinerary: {
        segments,
        price: Number.isFinite(input.price) ? input.price : undefined,
        currency: input.currency || undefined,
        source: input.source ? String(input.source) : "unknown",
        ticketStatusHint: ["protected", "separate", "unknown"].includes(input.ticketStatusHint)
          ? input.ticketStatusHint
          : "unknown",
        ticketStatusConfidence: ["high", "medium", "low"].includes(input.ticketStatusConfidence)
          ? input.ticketStatusConfidence
          : "low",
        ticketStatusBasis: input.ticketStatusBasis ? String(input.ticketStatusBasis) : undefined,
        baggageEvidence: {
          recheckRequired: typeof input.baggageEvidence?.recheckRequired === "boolean"
            ? input.baggageEvidence.recheckRequired
            : undefined,
          throughChecked: typeof input.baggageEvidence?.throughChecked === "boolean"
            ? input.baggageEvidence.throughChecked
            : undefined,
          confidence: ["high", "medium", "low"].includes(input.baggageEvidence?.confidence)
            ? input.baggageEvidence.confidence
            : "low",
          evidence: Array.isArray(input.baggageEvidence?.evidence)
            ? input.baggageEvidence.evidence.map(String)
            : []
        },
        baggageRecheckRequired: input.baggageRecheckRequired === true
      }
    };
  }

  return { createNormalizedItinerary, normalizeAirport, normalizeSegment };
});
