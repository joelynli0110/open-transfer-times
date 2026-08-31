(function exposeSkyscannerParser(root, factory) {
  const textParser = typeof module === "object" && module.exports
    ? require("../googleFlights/parser.js")
    : root.GoogleFlightsParser;
  const api = factory(textParser);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.SkyscannerParser = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSkyscannerParser(textParser) {
  "use strict";

  const CANDIDATE_GROUPS = [
    { selector: '[role="dialog"],[aria-modal="true"]', rank: 80, confidence: "high" },
    { selector: '[aria-selected="true"],[data-selected="true"]', rank: 70, confidence: "high" },
    { selector: '[aria-expanded="true"]', rank: 60, confidence: "high" },
    { selector: 'article,[data-testid*="itinerary"],[data-testid*="flight-card"]', rank: 20, confidence: "confirm" }
  ];

  function failure(code, message, details = {}) {
    return { ok: false, code, message, ...details };
  }

  function dateFromUrl(value) {
    try {
      const path = new URL(value).pathname;
      const compact = path.match(/\/(\d{2})(0[1-9]|1[0-2])([0-2]\d|3[01])(?:\/|$)/);
      if (!compact) return null;
      return `20${compact[1]}-${compact[2]}-${compact[3]}`;
    } catch {
      return null;
    }
  }

  function airportNames(text) {
    const names = {};
    for (const match of String(text || "").matchAll(/(?:^|\n)\s*([^\n()]{3,80}?)\s*\(([A-Z]{3})\)\s*(?:$|\n)/gm)) {
      names[match[2]] = match[1].trim().replace(/^[·•\-\s]+/, "");
    }
    return names;
  }

  function labeledValues(text, event, field) {
    const values = [];
    const source = String(text || "");
    const label = event === "departure" ? "(?:depart(?:ure|s)?|departs? from)" : "(?:arriv(?:al|es?)|arrives? at)";
    const noun = field === "terminal" ? "terminal" : "gate";
    const pattern = new RegExp(`\\b${label}[^\\n]{0,60}?\\b${noun}\\s*(?::|at|from)?\\s*([A-Z0-9][A-Z0-9-]{0,7})\\b`, "gi");
    for (const match of source.matchAll(pattern)) {
      const value = match[1].toUpperCase();
      if (!["AT", "FROM", "THE", "NOT", "TBD"].includes(value)) values.push(value);
    }
    return values;
  }

  function operationalDetails(text, itinerary) {
    const names = airportNames(text);
    const departureTerminals = labeledValues(text, "departure", "terminal");
    const arrivalTerminals = labeledValues(text, "arrival", "terminal");
    const departureGates = labeledValues(text, "departure", "gate");
    const arrivalGates = labeledValues(text, "arrival", "gate");
    return {
      inboundDetails: {
        originName: names[itinerary.origin],
        destinationName: names[itinerary.connectionAirport],
        departureTerminal: departureTerminals[0],
        arrivalTerminal: arrivalTerminals[0],
        departureGate: departureGates.length > 1 ? departureGates[0] : undefined,
        arrivalGate: arrivalGates[0]
      },
      outboundDetails: {
        originName: names[itinerary.connectionAirport],
        destinationName: names[itinerary.destination],
        departureTerminal: departureTerminals[1],
        arrivalTerminal: arrivalTerminals[1],
        departureGate: departureGates.at(-1),
        arrivalGate: arrivalGates.length > 1 ? arrivalGates.at(-1) : undefined
      }
    };
  }

  function identity(parsed) {
    const item = parsed.itinerary;
    return [item.origin, item.connectionAirport, item.destination, item.inboundFlight,
      item.outboundFlight, item.scheduledArrival, item.scheduledDeparture].join("|");
  }

  function parseCandidate(text, travelDate, now) {
    const result = textParser.parseGoogleFlightsText(text, { travelDate, now });
    if (!result.ok) return result;
    Object.assign(result.itinerary, operationalDetails(text, result.itinerary));
    result.ticketEvidence = textParser.detectTicketStatus(text);
    result.baggageEvidence = textParser.detectBaggageEvidence(text);
    return result;
  }

  function parseSkyscannerDocument(documentObject, options = {}) {
    const href = documentObject.location?.href || (typeof location !== "undefined" ? location.href : "");
    const pageText = documentObject.body?.innerText || "";
    const travelDate = dateFromUrl(href) || textParser.extractDate(pageText, options.now || new Date());
    if (!travelDate) return failure("MISSING_DATE", "Open a dated Skyscanner itinerary.");

    const parsedByIdentity = new Map();
    for (const group of CANDIDATE_GROUPS) {
      for (const element of documentObject.querySelectorAll(group.selector)) {
        const text = element?.innerText || "";
        if (text.length < 80 || text.length > 12000) continue;
        const parsed = parseCandidate(text, travelDate, options.now);
        if (!parsed.ok) continue;
        const key = identity(parsed);
        const existing = parsedByIdentity.get(key);
        if (!existing || group.rank > existing.rank) {
          parsedByIdentity.set(key, { parsed, rank: group.rank, confidence: group.confidence });
        }
      }
    }

    if (parsedByIdentity.size === 0 && pageText.length <= 50000) {
      const parsed = parseCandidate(pageText, travelDate, options.now);
      if (parsed.ok) parsedByIdentity.set(identity(parsed), { parsed, rank: 0, confidence: "confirm" });
    }
    const candidates = [...parsedByIdentity.values()];
    if (candidates.length === 0) {
      return failure("NO_RELIABLE_CANDIDATE", "Open the details for one complete one-stop Skyscanner itinerary.");
    }
    if (candidates.length > 1) {
      const strongestRank = Math.max(...candidates.map((candidate) => candidate.rank));
      const strongest = candidates.filter((candidate) => candidate.rank === strongestRank);
      if (strongestRank < 60 || strongest.length !== 1) {
        return failure("AMBIGUOUS_ITINERARY", "Open or expand one itinerary and try again.", { candidatesFound: candidates.length });
      }
      candidates.splice(0, candidates.length, strongest[0]);
    }

    const selected = candidates[0];
    const result = selected.parsed;
    result.confidence = selected.confidence;
    result.fingerprint = [result.fingerprint, result.ticketEvidence.status,
      String(result.baggageEvidence.recheckRequired === true), result.confidence].join("|");
    return result;
  }

  return { dateFromUrl, airportNames, operationalDetails, parseSkyscannerDocument };
});
