(function exposeAssessmentFlow(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ConnectionQualityFlow = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createAssessmentFlow() {
  "use strict";

  function hasCriticalFields(itinerary) {
    const segments = itinerary?.segments || [];
    if (segments.length < 2) return false;
    const inbound = segments[0];
    const outbound = segments[1];
    return Boolean(
      inbound.origin && inbound.destination && outbound.origin && outbound.destination &&
      inbound.destination === outbound.origin &&
      inbound.arrivalTime && outbound.departureTime
    );
  }

  function actionForExtraction(result) {
    if (!result?.ok || !hasCriticalFields(result.itinerary)) return "invalid";
    if (result.confidence === "high" && result.itinerary.ticketStatusHint !== "unknown") return "assess";
    return "confirm";
  }

  function failurePresentation(result) {
    if (result?.code === "AMBIGUOUS_ITINERARY") {
      return {
        title: "We couldn't identify the selected itinerary.",
        detail: "Open or expand one itinerary and try again."
      };
    }
    return {
      title: "We couldn't reliably detect this itinerary.",
      detail: result?.message || "Open one complete itinerary and try again."
    };
  }

  return { actionForExtraction, failurePresentation, hasCriticalFields };
});
