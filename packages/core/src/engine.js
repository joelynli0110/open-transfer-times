(function exposeConnectionQualityEngine(root, factory) {
  const rules = typeof module === "object" && module.exports
    ? require("./airport-rules.js")
    : root.ConnectionQualityAirportRules;
  const catalog = typeof module === "object" && module.exports
    ? require("./airport-catalog.js")
    : root.ConnectionQualityAirportCatalog;
  const time = typeof module === "object" && module.exports
    ? require("./time.js")
    : root.ConnectionQualityTime;
  const api = factory(rules, catalog, time);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ConnectionQualityEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createEngine(rulesModule, airportCatalog, timeModule) {
  "use strict";

  const { AIRPORT_RULES, FALLBACK_RULE, travelZone } = rulesModule;
  const BAGGAGE_RECHECK_MINUTES = 45;

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
    if (segments.length > 2) {
      throw new Error(`Only one-stop itineraries (two segments) are supported; got ${segments.length} segments. Assess each connection separately.`);
    }
    const inbound = segments[0];
    const outbound = segments[1];
    const connectionAirport = inbound.destination;
    if (connectionAirport !== outbound.origin) throw new Error("The itinerary segments are not connected.");
    const airportProfile = rulesModule.getAirportProfile(connectionAirport);
    // Real elapsed time: uses the airport's time zone (or explicit offsets), so a
    // layover across a daylight-saving change is not off by an hour.
    const layover = timeModule.layover(inbound.arrivalTime, outbound.departureTime, airportProfile?.timezone);
    const layoverMinutes = layover.minutes;

    const airportRule = AIRPORT_RULES[connectionAirport];
    const rule = airportRule || FALLBACK_RULE;
    const ticketStatus = ["protected", "separate", "unknown"].includes(options.ticketStatus)
      ? options.ticketStatus
      : "unknown";
    const processFactors = [];
    const checks = [];
    let deductions = rule.baseTransferMinutes;

    if (layover.minutes !== layover.wallClockMinutes) {
      const shorter = layover.minutes < layover.wallClockMinutes;
      processFactors.push(factor(
        "CLOCK_CHANGE",
        "Clocks change during this layover",
        shorter ? "high" : "low",
        `Local clocks show ${layover.wallClockMinutes} min between the flights, but ${layover.minutes} min actually pass` +
          `${layover.timeZone ? ` (${layover.timeZone})` : ""}.`
      ));
    }

    if (!airportRule) {
      processFactors.push(factor("AIRPORT_TRANSFER", "Airport transfer required", "low", "Rule-of-thumb allowance for walking and normal transfer steps."));
    } else {
      processFactors.push(factor("BASE_TRANSFER", `Transfer through ${airportRule.name}`, rule.baseTransferMinutes >= 40 ? "medium" : "low", "Airport-specific rule-of-thumb transfer allowance."));
    }
    checks.push(check("AIRPORT_TRANSFER", "Move through airport", `${rule.baseTransferMinutes} min estimate`, layoverMinutes >= deductions));

    const inboundZone = travelZone(inbound.origin);
    let routeZoneUnknown = false;
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
      routeZoneUnknown = true;
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
    const baggageRecheckRuledOut = options.baggageRecheck === false
      || itinerary.baggageEvidence?.recheckRequired === false
      || itinerary.baggageEvidence?.throughChecked === true;
    const baggageRecheck = baggageRecheckRequired ? "required" : baggageRecheckRuledOut ? "not_required" : "unknown";
    if (baggageRecheckRequired) {
      deductions += BAGGAGE_RECHECK_MINUTES;
      processFactors.push(factor("BAGGAGE_RECHECK", "Collect bags and check in again", "high", "Baggage collection and re-check are explicit physical transfer steps."));
      checks.push(check("BAGGAGE_RECHECK", "Collect bags and check in again", "Required", layoverMinutes >= deductions));
    }

    const structuralBufferMinutes = layoverMinutes - deductions;
    const quality = qualityForBuffer(structuralBufferMinutes);
    // On separate tickets, bags usually have to be collected and checked in again.
    // When nobody said either way, check whether that would change the rating.
    const baggageWhatIf = ticketStatus === "separate" && baggageRecheck === "unknown"
      ? { bufferMinutes: structuralBufferMinutes - BAGGAGE_RECHECK_MINUTES, quality: qualityForBuffer(structuralBufferMinutes - BAGGAGE_RECHECK_MINUTES) }
      : null;
    // Only matters when a re-check would push the connection into tight or risky.
    const baggageCouldChangeRating = Boolean(baggageWhatIf && baggageWhatIf.quality !== quality
      && (baggageWhatIf.quality === "tight" || baggageWhatIf.quality === "risky"));
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

    // Published minimum connection times (MCT) are a separate question from the structural estimate: whether an
    // airline would sell this connection, not whether the transfer steps fit. Whether a scoped MCT applies to this
    // trip (airline, route type) is not known here, so a layover below one is never treated as a pass.
    const mct = minimumConnectionCheck(airportProfile, layoverMinutes);

    const confidence = assessConfidence({
      airportProfile,
      connectionZone,
      routeZoneUnknown,
      checks,
      dstAmbiguous: layover.ambiguous,
      baggageUnknown: baggageCouldChangeRating ? baggageWhatIf : null,
      belowPublishedMct: mct.status === "below_published"
    });

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
      confidence,
      decision: decide({ quality, confidence, ticketStatus, belowPublishedMct: mct.status === "below_published" }),
      mct,
      layoverBasis: layover.basis,
      wallClockLayoverMinutes: layover.wallClockMinutes,
      ...(layover.timeZone ? { timeZone: layover.timeZone } : {}),
      baggageRecheck,
      ...(baggageWhatIf ? { ifBaggageRecheck: baggageWhatIf } : {}),
      modelVersion: "structural-v3"
    };
  }

  // How much the assessment can be trusted, separate from how good the
  // connection looks. A missing airport profile or an undetermined border
  // situation must never read as "no risk".
  const CONFIDENCE_REASONS = {
    BASELINE_AIRPORT: "No transfer profile for this airport; generic baseline allowances were used.",
    CONNECTION_ZONE_UNKNOWN: "The border situation at this airport is not modelled, so passport control was not counted.",
    ROUTE_ZONE_UNKNOWN: "The origin or destination could not be placed inside or outside Schengen; a generic formalities allowance was used.",
    BAGGAGE_UNKNOWN: "Separate tickets, and it is not known whether bags must be collected and checked in again; a re-check would make this connection tight or risky.",
    DST_AMBIGUOUS: "A time falls in the hour that repeats when clocks go back; the shorter possible layover was used.",
    HEURISTIC_ALLOWANCES: "The transfer-step durations are rule-of-thumb estimates, not sourced figures.",
    BELOW_PUBLISHED_MCT: "The layover is below a minimum connection time published for some connections at this airport; whether it applies to this trip is not known."
  };
  // Reasons that mean key information is missing: confidence is low.
  const LOW_CONFIDENCE_REASONS = new Set(["BASELINE_AIRPORT", "CONNECTION_ZONE_UNKNOWN", "ROUTE_ZONE_UNKNOWN", "BAGGAGE_UNKNOWN"]);

  function assessConfidence({ airportProfile, connectionZone, routeZoneUnknown, checks, dstAmbiguous, baggageUnknown, belowPublishedMct }) {
    const reasons = [];
    if (belowPublishedMct) reasons.push("BELOW_PUBLISHED_MCT");
    if (!airportProfile) reasons.push("BASELINE_AIRPORT");
    if (connectionZone === "unknown") reasons.push("CONNECTION_ZONE_UNKNOWN");
    if (routeZoneUnknown) reasons.push("ROUTE_ZONE_UNKNOWN");
    if (baggageUnknown) reasons.push("BAGGAGE_UNKNOWN");
    if (dstAmbiguous) reasons.push("DST_AMBIGUOUS");
    const stepKeys = {
      AIRPORT_TRANSFER: "baseTransfer",
      SCHENGEN_BORDER_CONTROL: "passportControl",
      TERMINAL_CHANGE: "terminalChange",
      SECURITY_RESCREENING: "securityRescreening"
    };
    const counted = checks.filter((item) => !/^Not indicated/.test(item.detail));
    const allSourced = Boolean(airportProfile) && counted.every((item) => {
      const key = stepKeys[item.code];
      return key && airportProfile.allowances[key].basis === "sourced";
    });
    if (!allSourced && !reasons.some((code) => LOW_CONFIDENCE_REASONS.has(code))) reasons.push("HEURISTIC_ALLOWANCES");
    const level = reasons.some((code) => LOW_CONFIDENCE_REASONS.has(code))
      ? "low"
      : reasons.length ? "medium" : "high";
    return {
      level,
      reasons: reasons.map((code) => {
        let explanation = CONFIDENCE_REASONS[code];
        if (code === "BAGGAGE_UNKNOWN") {
          explanation += ` With a bag re-check the margin would be ${baggageUnknown.bufferMinutes} min (${baggageUnknown.quality}).`;
        }
        return { code, explanation };
      })
    };
  }

  // What to do with the connection, combining the rating, how far it can be
  // trusted, and ticket protection. Missing data never yields "recommend".
  const DECISION_REASONS = {
    RISKY_MARGIN: "The transfer steps take about as long as the layover or longer.",
    LOW_CONFIDENCE: "Key information is missing, so the rating cannot be relied on.",
    TIGHT_MARGIN: "Little time is left after the transfer steps.",
    SELF_TRANSFER: "Separate tickets: a missed connection is not protected.",
    TICKET_UNKNOWN: "Ticket protection is not stated; confirm whether both flights are on one booking.",
    BELOW_PUBLISHED_MCT: "The layover is below a published minimum connection time that may apply; if it does, the airline would not sell this connection, and on separate tickets it is a strong warning.",
    CLEAR: "Enough time after the transfer steps, on a protected ticket, with usable data."
  };
  const DECISIONS = ["recommend", "caution", "insufficient_data", "avoid"];

  function decide({ quality, confidence, ticketStatus, belowPublishedMct }) {
    const reasons = [];
    let value;
    if (quality === "risky") {
      value = "avoid";
      reasons.push("RISKY_MARGIN");
      if (confidence.level === "low") reasons.push("LOW_CONFIDENCE");
      if (belowPublishedMct) reasons.push("BELOW_PUBLISHED_MCT");
    } else if (confidence.level === "low") {
      value = "insufficient_data";
      reasons.push("LOW_CONFIDENCE");
      if (belowPublishedMct) reasons.push("BELOW_PUBLISHED_MCT");
    } else {
      if (quality === "tight") reasons.push("TIGHT_MARGIN");
      if (ticketStatus === "separate") reasons.push("SELF_TRANSFER");
      if (ticketStatus === "unknown") reasons.push("TICKET_UNKNOWN");
      if (belowPublishedMct) reasons.push("BELOW_PUBLISHED_MCT");
      value = reasons.length ? "caution" : "recommend";
      if (!reasons.length) reasons.push("CLEAR");
    }
    return { value, reasons: reasons.map((code) => ({ code, explanation: DECISION_REASONS[code] })) };
  }

  // status: none_published | meets_published | below_published. "meets" means at or above every published
  // minimum, not that the airline's rules were checked.
  function minimumConnectionCheck(airportProfile, layover) {
    const published = (airportProfile?.facts || [])
      .filter((fact) => Number.isInteger(fact.minimumConnectionMinutes))
      .map((fact) => ({ factId: fact.id, minutes: fact.minimumConnectionMinutes, scope: fact.scope }));
    const status = !published.length
      ? "none_published"
      : published.some((entry) => layover < entry.minutes) ? "below_published" : "meets_published";
    return { status, applicability: published.length ? "unknown" : "none", published };
  }

  function layoverMinutes(arrival, departure, connectionAirport) {
    const profile = rulesModule.getAirportProfile(connectionAirport);
    return timeModule.layover(arrival, departure, profile?.timezone).minutes;
  }

  return { assessConnection, minutesBetween, layoverMinutes, qualityForBuffer, CONFIDENCE_REASONS, DECISION_REASONS, DECISIONS };
});
