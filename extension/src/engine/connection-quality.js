(function exposeConnectionQualityEngine(root, factory) {
  const rules = typeof module === "object" && module.exports
    ? require("./airport-rules.js")
    : root.ConnectionQualityAirportRules;
  const catalog = typeof module === "object" && module.exports
    ? require("../data/airport-catalog.js")
    : root.ConnectionQualityAirportCatalog;
  const api = factory(rules, catalog);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ConnectionQualityEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createEngine(rulesModule, airportCatalog) {
  "use strict";

  const { AIRPORT_RULES, travelZone } = rulesModule;
  const FALLBACK_RULE = Object.freeze({ baseTransferMinutes: 35, passportMinutes: 20, terminalChangeMinutes: 15, securityMinutes: 0 });

  function wallClockTimestamp(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) return null;
    const [, yearText, monthText, dayText, hourText, minuteText, secondText = "0"] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText);
    const timestamp = Date.UTC(year, month - 1, day, hour, minute, second);
    const date = new Date(timestamp);
    if (
      date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day || date.getUTCHours() !== hour ||
      date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second
    ) return null;
    return timestamp;
  }

  function minutesBetween(arrival, departure) {
    // These values are wall-clock times at the same connection airport.
    // Date.UTC is only a timezone-neutral arithmetic container here; it does
    // not claim that either flight event occurred in the UTC timezone.
    const start = wallClockTimestamp(arrival);
    const end = wallClockTimestamp(departure);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    const minutes = Math.round((end - start) / 60000);
    return minutes > 0 && minutes <= 1440 ? minutes : null;
  }

  function factor(code, label, severity, explanation) {
    return { code, label, severity, explanation };
  }

  function check(code, label, detail, passed, group = "steps") {
    return { code, label, detail, passed, group };
  }

  function qualityForBuffer(buffer) {
    if (buffer >= 45) return "comfortable";
    if (buffer >= 25) return "reasonable";
    if (buffer >= 5) return "tight";
    return "risky";
  }

  function verdictFor(quality, ticketStatus) {
    if (ticketStatus === "separate") {
      if (quality === "comfortable") return "Transfer time looks workable, but separate tickets leave you exposed to disruption.";
      if (quality === "risky") return "The transfer is physically difficult and separate tickets leave you unprotected.";
      return "Possible, but not recommended as a self-transfer.";
    }
    if (ticketStatus === "unknown") {
      return quality === "risky"
        ? "Choose a longer connection."
        : "Confirm the ticket terms before booking this connection.";
    }
    if (quality === "risky") return "Choose a longer connection, even on one ticket.";
    if (quality === "tight") return "Bookable on one ticket, but expect a fast transfer.";
    if (quality === "reasonable") return "A practical connection on one ticket.";
    return "Plenty of time for a normal transfer.";
  }

  function assessConnection(itinerary, options = {}) {
    const segments = itinerary?.segments || [];
    if (segments.length < 2) throw new Error("A connecting itinerary requires at least two segments.");
    const inbound = segments[0];
    const outbound = segments[1];
    const connectionAirport = inbound.destination;
    if (connectionAirport !== outbound.origin) throw new Error("The itinerary segments are not connected.");
    const layoverMinutes = minutesBetween(inbound.arrivalTime, outbound.departureTime);
    if (layoverMinutes === null) throw new Error("Open both flight segments to show the connection time.");

    const airportRule = AIRPORT_RULES[connectionAirport];
    const rule = airportRule || FALLBACK_RULE;
    const ticketStatus = ["protected", "separate", "unknown"].includes(options.ticketStatus)
      ? options.ticketStatus
      : "unknown";
    const processFactors = [];
    const checks = [];
    let deductions = rule.baseTransferMinutes;

    if (!airportRule) {
      processFactors.push(factor("AIRPORT_TRANSFER", "Airport transfer required", "low", "Rule-of-thumb allowance for walking and normal transfer steps."));
    } else {
      processFactors.push(factor("BASE_TRANSFER", `Transfer through ${airportRule.name}`, rule.baseTransferMinutes >= 40 ? "medium" : "low", "Airport-specific rule-of-thumb transfer allowance."));
    }
    checks.push(check("AIRPORT_TRANSFER", "Move through airport", `${rule.baseTransferMinutes} min estimate`, layoverMinutes >= deductions));

    const inboundZone = travelZone(inbound.origin);
    const connectionZone = travelZone(connectionAirport);
    const outboundZone = travelZone(outbound.destination);
    const endpointZonesKnown = inboundZone !== "unknown" && outboundZone !== "unknown";
    const crossesSchengenBorder = connectionZone === "schengen" && endpointZonesKnown
      && ((inboundZone === "schengen") !== (outboundZone === "schengen"));
    if (crossesSchengenBorder) {
      deductions += rule.passportMinutes;
      processFactors.push(factor("SCHENGEN_BORDER_CONTROL", "Schengen passport control may apply", "high", "The transfer crosses a Schengen boundary at a Schengen connection airport."));
      checks.push(check("SCHENGEN_BORDER_CONTROL", "Allow for Schengen border control", `${rule.passportMinutes} min estimate`, layoverMinutes >= deductions));
    } else if (connectionZone === "schengen" && !endpointZonesKnown) {
      deductions += 10;
      processFactors.push(factor("INTERNATIONAL_TRANSFER", "International transfer formalities may apply", "medium", "The route zone could not be determined confidently."));
      checks.push(check("INTERNATIONAL_TRANSFER", "Complete transfer formalities", "10 min", layoverMinutes >= deductions));
    } else {
      checks.push(check("SCHENGEN_BORDER_CONTROL", "Schengen border control", "Not indicated for this transfer flow", true));
    }

    const terminalChange = options.terminalChange === true || (
      inbound.arrivalTerminal && outbound.departureTerminal && inbound.arrivalTerminal !== outbound.departureTerminal
    );
    if (terminalChange) {
      deductions += rule.terminalChangeMinutes;
      processFactors.push(factor("TERMINAL_CHANGE", "Terminal transfer required", "medium", "Changing terminals may add walking or transport time."));
      checks.push(check("TERMINAL_CHANGE", "Change terminals", `${rule.terminalChangeMinutes} min`, layoverMinutes >= deductions));
    }
    if (rule.securityMinutes > 0) {
      deductions += rule.securityMinutes;
      processFactors.push(factor("SECURITY_RESCREENING", "Additional security screening may apply", "medium", "The airport transfer rule includes a heuristic allowance for another security check."));
      checks.push(check("SECURITY_RESCREENING", "Allow for another security check", `${rule.securityMinutes} min estimate`, layoverMinutes >= deductions));
    }
    const baggageRecheckRequired = options.baggageRecheck === true || itinerary.baggageRecheckRequired === true;
    if (baggageRecheckRequired) {
      deductions += 45;
      processFactors.push(factor("BAGGAGE_RECHECK", "Collect bags and check in again", "high", "Baggage collection and re-check are explicit physical transfer steps."));
      checks.push(check("BAGGAGE_RECHECK", "Collect bags and check in again", "Required", layoverMinutes >= deductions));
    }

    const structuralBufferMinutes = layoverMinutes - deductions;
    const quality = qualityForBuffer(structuralBufferMinutes);
    const marginFactor = structuralBufferMinutes < 5
      ? factor("STRUCTURAL_MARGIN", "Insufficient transfer margin", "high", "The scheduled layover is shorter than the structural allowance.")
      : structuralBufferMinutes < 25
        ? factor("STRUCTURAL_MARGIN", "Limited transfer margin", "high", "Little room remains for normal variation.")
        : structuralBufferMinutes < 45
          ? factor("STRUCTURAL_MARGIN", "Moderate transfer margin", "medium", "Some room remains after expected transfer steps.")
          : factor("STRUCTURAL_MARGIN", "Healthy transfer margin", "low", "The schedule leaves a larger structural margin.");
    processFactors.push(marginFactor);

    const protectionAssessment = ticketStatus === "protected"
      ? { level: "protected", explanation: "One protected itinerary; the operating carrier may be responsible for rebooking after disruption." }
      : ticketStatus === "separate"
        ? { level: "exposed", explanation: "A delay on the first ticket could cause you to lose the second booking." }
        : { level: "unknown", explanation: "Ticket protection is not stated; confirm the booking terms." };

    const ticketProtection = ticketStatus === "protected"
      ? { status: "protected", label: "Protected itinerary", detail: protectionAssessment.explanation }
      : ticketStatus === "separate"
        ? { status: "separate", label: "High disruption exposure", detail: protectionAssessment.explanation }
        : { status: "unknown", label: "Ticket protection unknown", detail: protectionAssessment.explanation };

    return {
      quality,
      connectionAirport,
      airportName: airportRule?.name || airportCatalog?.nameForAirport(connectionAirport),
      layoverMinutes,
      structuralBufferMinutes,
      structuralProcessMinutes: deductions,
      airportSpecificData: Boolean(airportRule),
      processFactors,
      factors: processFactors,
      checks,
      ticketStatus,
      protectionAssessment,
      ticketProtection,
      verdict: verdictFor(quality, ticketStatus),
      modelVersion: "structural-v2"
    };
  }

  return { assessConnection, minutesBetween, qualityForBuffer };
});
