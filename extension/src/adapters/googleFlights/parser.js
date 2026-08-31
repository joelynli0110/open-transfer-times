(function exposeParser(root, factory) {
  const parser = factory();
  if (typeof module === "object" && module.exports) module.exports = parser;
  root.GoogleFlightsParser = parser;
  root.ConnectionRiskParser = parser; // Legacy diagnostic-page compatibility.
})(typeof globalThis !== "undefined" ? globalThis : this, function createParser() {
  "use strict";

  const MONTHS = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
    apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
    aug: 7, august: 7, sep: 8, sept: 8, september: 8,
    oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11
  };
  const CONNECTION_PATTERN = /\b(?:layover|change planes|stop(?:over)? in|one stop|1 stop|zwischenstopp|umstieg|aufenthalt)\b|(?:中转|转机|停留)/i;

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function dateString(year, month, day) {
    return `${year}-${pad(month + 1)}-${pad(day)}`;
  }

  function addDays(value, days) {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + days));
    return dateString(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  }

  function extractDate(text, now = new Date()) {
    const match = text.match(
      /\b(?:Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)?[,]?\s*(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:[,]?\s+(\d{4}))?\b/i
    );
    if (!match) return null;
    const month = MONTHS[match[1].toLowerCase()];
    const day = Number(match[2]);
    let year = match[3] ? Number(match[3]) : now.getFullYear();
    let candidate = new Date(year, month, day);
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
    if (!match[3] && candidate < sixMonthsAgo) {
      year += 1;
      candidate = new Date(year, month, day);
    }
    if (
      candidate.getFullYear() !== year ||
      candidate.getMonth() !== month ||
      candidate.getDate() !== day
    ) return null;
    return dateString(year, month, day);
  }

  function decodeBookingBytes(url) {
    try {
      const encoded = new URL(url).searchParams.get("tfs");
      if (!encoded) return null;
      let normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
      normalized += "=".repeat((4 - (normalized.length % 4)) % 4);
      const decoded = typeof atob === "function"
        ? atob(normalized)
        : Buffer.from(normalized, "base64").toString("latin1");
      return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
    } catch {
      return null;
    }
  }

  function bytesToLatin1(bytes) {
    let value = "";
    for (const byte of bytes) value += String.fromCharCode(byte);
    return value;
  }

  function readVarint(bytes, start, end) {
    let value = 0;
    let multiplier = 1;
    let index = start;
    while (index < end && index - start < 10) {
      const byte = bytes[index];
      index += 1;
      value += (byte & 0x7f) * multiplier;
      if ((byte & 0x80) === 0) return { value, index };
      multiplier *= 128;
    }
    return null;
  }

  function scanProtobufMessage(bytes, start, end, segments, depth = 0) {
    if (depth > 8 || start >= end) return;
    const strings = {};
    let index = start;
    while (index < end) {
      const key = readVarint(bytes, index, end);
      if (!key) return;
      index = key.index;
      const field = Math.floor(key.value / 8);
      const wireType = key.value & 7;
      if (field === 0) return;
      if (wireType === 0) {
        const value = readVarint(bytes, index, end);
        if (!value) return;
        index = value.index;
      } else if (wireType === 1) {
        index += 8;
      } else if (wireType === 2) {
        const length = readVarint(bytes, index, end);
        if (!length) return;
        const valueStart = length.index;
        const valueEnd = valueStart + length.value;
        if (valueEnd > end) return;
        const value = bytesToLatin1(bytes.slice(valueStart, valueEnd));
        if (/^[\x20-\x7e]{1,32}$/.test(value)) strings[field] = value;
        scanProtobufMessage(bytes, valueStart, valueEnd, segments, depth + 1);
        index = valueEnd;
      } else if (wireType === 5) {
        index += 4;
      } else {
        return;
      }
      if (index > end) return;
    }

    if (
      /^[A-Z]{3}$/.test(strings[1] || "")
      && /^20\d{2}-\d{2}-\d{2}$/.test(strings[2] || "")
      && /^[A-Z]{3}$/.test(strings[3] || "")
      && /^[A-Z0-9]{2,3}$/.test(strings[5] || "")
      && /^[A-Z0-9]{1,8}$/.test(strings[6] || "")
    ) {
      const segment = {
        origin: strings[1],
        travelDate: strings[2],
        destination: strings[3],
        flightNumber: `${strings[5]}${strings[6]}`
      };
      if (!segments.some((item) => JSON.stringify(item) === JSON.stringify(segment))) {
        segments.push(segment);
      }
    }
  }

  function extractBookingItinerary(url) {
    const bytes = decodeBookingBytes(url);
    if (!bytes) return null;
    const segments = [];
    scanProtobufMessage(bytes, 0, bytes.length, segments);
    for (let index = 0; index < segments.length - 1; index += 1) {
      if (segments[index].destination === segments[index + 1].origin) {
        return {
          travelDate: segments[index].travelDate,
          segments: [segments[index], segments[index + 1]]
        };
      }
    }
    return null;
  }

  function extractDateFromBookingUrl(url) {
    const itinerary = extractBookingItinerary(url);
    if (itinerary) return itinerary.travelDate;
    const bytes = decodeBookingBytes(url);
    if (!bytes) return null;
    return bytesToLatin1(bytes).match(/\b20\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])\b/)?.[0] || null;
  }

  function extractRoutes(text) {
    const routes = [];
    const pattern = /\b([A-Z]{3})\s*(?:–|—|-|→|\bto\b)\s*([A-Z]{3})\b/gi;
    for (const match of text.matchAll(pattern)) {
      const route = { origin: match[1].toUpperCase(), destination: match[2].toUpperCase() };
      const last = routes[routes.length - 1];
      if (!last || last.origin !== route.origin || last.destination !== route.destination) {
        routes.push(route);
      }
    }
    if (connectedRoutePair(routes)) return routes;

    // Expanded Google Flights details often expose airport codes beside full
    // airport names rather than as a compact BER–BUD route.
    const airportSequence = [];
    for (const match of text.matchAll(/\(([A-Z]{3})\)/g)) {
      const airport = match[1];
      if (airportSequence[airportSequence.length - 1] !== airport) {
        airportSequence.push(airport);
      }
    }
    for (let index = 0; index < airportSequence.length - 1; index += 1) {
      routes.push({ origin: airportSequence[index], destination: airportSequence[index + 1] });
    }
    return routes;
  }

  function connectedRoutePair(routes) {
    return connectedRoutePairs(routes)[0] || null;
  }

  function connectedRoutePairs(routes) {
    const pairs = [];
    const seen = new Set();
    for (let index = 0; index < routes.length - 1; index += 1) {
      if (routes[index].destination === routes[index + 1].origin) {
        const pair = [routes[index], routes[index + 1]];
        const key = `${pair[0].origin}|${pair[0].destination}|${pair[1].destination}`;
        if (!seen.has(key)) {
          seen.add(key);
          pairs.push(pair);
        }
      }
    }
    return pairs;
  }

  function extractFlights(text) {
    const flights = [];
    const pattern = /\b(?:Flight\s+)?([A-Z0-9]{2})\s*[- ]?\s*(\d{2,4})\b/gi;
    const excluded = new Set(["AM", "PM", "HR"]);
    for (const match of text.matchAll(pattern)) {
      const carrier = match[1].toUpperCase();
      if (excluded.has(carrier) || !/[A-Z]/.test(carrier)) continue;
      const flight = `${carrier}${match[2]}`;
      if (!flights.includes(flight)) flights.push(flight);
    }
    return flights;
  }

  function extractTimes(text) {
    const times = [];
    // Google Flights innerText can concatenate a time and airport name
    // (for example "08:55Berlin") without whitespace.
    const pattern = /\b(\d{1,2}):(\d{2})(?:\s*(AM|PM))?(?:\s*\+(\d))?(?!\d)/gi;
    for (const match of text.matchAll(pattern)) {
      let hour = Number(match[1]);
      const minute = Number(match[2]);
      const period = match[3]?.toUpperCase() || null;
      if (minute > 59 || (period && (hour < 1 || hour > 12)) || (!period && hour > 23)) continue;
      if (period) {
        if (hour === 12) hour = 0;
        if (period === "PM") hour += 12;
      }
      times.push({ hour, minute, dayOffset: match[4] ? Number(match[4]) : null });
    }
    return times;
  }

  function isoLocal(date, time) {
    return `${date}T${pad(time.hour)}:${pad(time.minute)}:00`;
  }

  function minutesOfDay(time) {
    return time.hour * 60 + time.minute;
  }

  function failure(code, message, details = {}) {
    return { ok: false, code, message, ...details };
  }

  function detectTicketStatus(text, options = {}) {
    const source = String(text || "").replace(/\u00a0/g, " ");
    const separate = /\b(?:separate tickets?|self[- ]transfer|booked separately|separate booking)\b/i.test(source);
    const protectedBooking = /\b(?:one ticket|single ticket|one booking|protected connection)\b/i.test(source);
    if (separate && protectedBooking) {
      return {
        status: "unknown",
        confidence: "low",
        basis: "The selected itinerary contains conflicting ticket-status wording."
      };
    }
    if (separate) {
      return {
        status: "separate",
        confidence: "high",
        basis: "The selected itinerary shows a separate-ticket or self-transfer warning."
      };
    }
    if (protectedBooking) {
      return {
        status: "protected",
        confidence: "high",
        basis: "The itinerary text explicitly indicates one protected booking."
      };
    }
    if ((options.bookingSegments || []).length >= 2) {
      return {
        status: "unknown",
        confidence: "medium",
        basis: "Both segments appear together, but ticket protection is not stated."
      };
    }
    return {
      status: "unknown",
      confidence: "low",
      basis: "The visible itinerary does not state the ticket protection."
    };
  }

  function detectBaggageEvidence(text) {
    const source = String(text || "").replace(/\u00a0/g, " ");
    const recheckRequired = /\b(?:collect (?:and )?recheck bags?|recheck (?:your )?bags?)\b/i.test(source);
    const throughChecked = /\b(?:bags? (?:is |are )?checked through|baggage (?:is |will be )?transferred)\b/i.test(source);
    const evidence = [];
    if (recheckRequired) evidence.push("The selected itinerary says baggage must be collected and rechecked.");
    if (throughChecked) evidence.push("The selected itinerary says baggage is checked through.");
    if (recheckRequired && throughChecked) {
      return { confidence: "low", evidence };
    }
    if (recheckRequired) {
      return { recheckRequired: true, throughChecked: false, confidence: "high", evidence };
    }
    if (throughChecked) {
      return { recheckRequired: false, throughChecked: true, confidence: "high", evidence };
    }
    return { confidence: "low", evidence };
  }

  function parseGoogleFlightsText(text, options = {}) {
    const source = String(text || "").replace(/\u00a0/g, " ");
    const bookingSegments = options.bookingSegments || [];
    if (!CONNECTION_PATTERN.test(source) && bookingSegments.length < 2) {
      return failure("NO_CONNECTION", "Open the details for a one-stop itinerary.");
    }

    const travelDate = options.travelDate || extractDate(source, options.now || new Date());
    if (!travelDate) {
      return failure("MISSING_DATE", "Open the full itinerary to show the travel date.");
    }

    const routePair = bookingSegments.length >= 2
      ? [
          { origin: bookingSegments[0].origin, destination: bookingSegments[0].destination },
          { origin: bookingSegments[1].origin, destination: bookingSegments[1].destination }
        ]
      : connectedRoutePair(extractRoutes(source));
    if (!routePair) {
      return failure("MISSING_ROUTE", "Open both flight segments to show the full route.");
    }

    const flights = bookingSegments.length >= 2
      ? bookingSegments.map((segment) => segment.flightNumber)
      : extractFlights(source);
    if (flights.length < 2) {
      return failure("MISSING_FLIGHTS", "Open both flight segments to show the flight numbers.");
    }

    const times = extractTimes(source);
    if (times.length < 4) {
      return failure("MISSING_TIMES", "Open both flight segments to show arrival and departure times.");
    }

    const inboundDeparture = times[0];
    const inboundArrival = times[1];
    const outboundDeparture = times[2];
    let arrivalOffset = inboundArrival.dayOffset ?? 0;
    if (inboundArrival.dayOffset === null && minutesOfDay(inboundArrival) < minutesOfDay(inboundDeparture)) {
      arrivalOffset = 1;
    }
    let departureOffset = outboundDeparture.dayOffset ?? arrivalOffset;
    if (
      outboundDeparture.dayOffset === null &&
      minutesOfDay(outboundDeparture) <= minutesOfDay(inboundArrival)
    ) departureOffset = arrivalOffset + 1;

    const selfTransferDetected = detectTicketStatus(source).status === "separate";
    const itinerary = {
      travelDate,
      origin: routePair[0].origin,
      connectionAirport: routePair[0].destination,
      destination: routePair[1].destination,
      inboundFlight: flights[0],
      outboundFlight: flights[1],
      scheduledArrival: isoLocal(addDays(travelDate, arrivalOffset), inboundArrival),
      scheduledDeparture: isoLocal(addDays(travelDate, departureOffset), outboundDeparture),
      selfTransferDetected
    };
    const fingerprint = [
      itinerary.inboundFlight, itinerary.outboundFlight,
      itinerary.scheduledArrival, itinerary.scheduledDeparture,
      String(itinerary.selfTransferDetected)
    ].join("|");
    return { ok: true, itinerary, fingerprint };
  }

  function toApiPayload(itinerary, settings = {}) {
    return {
      connection_airport: itinerary.connectionAirport,
      inbound: {
        flight_number: itinerary.inboundFlight,
        origin: itinerary.origin,
        scheduled_arrival: itinerary.scheduledArrival
      },
      outbound: {
        flight_number: itinerary.outboundFlight,
        destination: itinerary.destination,
        scheduled_departure: itinerary.scheduledDeparture
      },
      checked_baggage: Boolean(settings.checkedBaggage),
      self_transfer: Boolean(settings.selfTransfer || itinerary.selfTransferDetected),
      terminal_change: Boolean(settings.terminalChange),
      transfer_context: {
        schengen_to_non_schengen: Boolean(settings.schengenToNonSchengen)
      }
    };
  }

  const CANDIDATE_GROUPS = [
    { selectors: '[role="dialog"],[aria-modal="true"],[role="dialog"] div,[aria-modal="true"] div', evidence: "active-dialog", rank: 80 },
    { selectors: '[aria-selected="true"],[data-selected="true"]', evidence: "selected", rank: 70 },
    { selectors: '[aria-expanded="true"],[aria-expanded="true"] ~ div,[aria-expanded="true"] div', evidence: "expanded", rank: 60 },
    { selectors: 'article,li[role="listitem"]', evidence: "candidate-card", rank: 20 }
  ];

  function candidateContexts(documentObject, bookingItinerary = null) {
    const candidates = new Map();

    function consider(element, selectionEvidence, selectionRank, ticketScopeReliable, maximumLength = 8000) {
      const text = element?.innerText || "";
      const normalizedText = text.replace(/\s+/g, " ").trim();
      if (!normalizedText || text.length < 80 || text.length > maximumLength) return;
      const compactText = text.toUpperCase().replace(/[^A-Z0-9]/g, "");
      const matchesBooking = Boolean(bookingItinerary) && bookingItinerary.segments.every(
        (segment) => compactText.includes(segment.flightNumber)
      );
      const routePairs = connectedRoutePairs(extractRoutes(text));
      const hasCompleteSegments = extractFlights(text).length >= 2
        && extractTimes(text).length >= 4
        && routePairs.length >= 1;
      if (extractTimes(text).length < 4 || !((CONNECTION_PATTERN.test(text) && hasCompleteSegments) || matchesBooking)) return;

      const existing = candidates.get(normalizedText);
      const context = {
        candidateText: text,
        sourceElement: element,
        matchesBooking,
        ticketScopeReliable,
        selectionEvidence,
        selectionRank,
        routeVariants: routePairs.length
      };
      if (!existing || context.selectionRank > existing.selectionRank) candidates.set(normalizedText, context);
      else if (existing) existing.matchesBooking = existing.matchesBooking || matchesBooking;
    }

    for (const group of CANDIDATE_GROUPS) {
      for (const element of documentObject.querySelectorAll(group.selectors)) {
        consider(element, group.evidence, group.rank, true);
      }
    }
    if (candidates.size === 0) {
      const broadCandidates = documentObject.querySelectorAll("main div, main section");
      for (let index = 0; index < Math.min(broadCandidates.length, 1500); index += 1) {
        consider(broadCandidates[index], "generic-container", 0, false);
      }
    }
    if (candidates.size === 0 && documentObject.body) {
      consider(documentObject.body, "page-accessibility-text", 0, false, 50000);
    }
    return [...candidates.values()];
  }

  function itineraryIdentity(itinerary) {
    return [
      itinerary.origin, itinerary.connectionAirport, itinerary.destination,
      itinerary.inboundFlight, itinerary.outboundFlight,
      itinerary.scheduledArrival, itinerary.scheduledDeparture
    ].join("|");
  }

  function resolveCandidate(documentObject, bookingItinerary, parseOptions) {
    const contexts = candidateContexts(documentObject, bookingItinerary);
    if (contexts.length === 0) {
      return failure("NO_RELIABLE_CANDIDATE", "We couldn't reliably detect this itinerary. Open one complete itinerary and try again.");
    }
    const resolvableContexts = contexts.filter(
      (context) => context.routeVariants === 1 || (context.matchesBooking && context.routeVariants === 0)
    );
    if (resolvableContexts.length === 0) {
      const candidatesFound = Math.max(...contexts.map((context) => context.routeVariants));
      return failure(
        "AMBIGUOUS_ITINERARY",
        "We couldn't reliably identify which itinerary is currently selected. Open or expand one itinerary and try again.",
        { candidatesFound }
      );
    }

    const identities = new Map();
    for (const context of resolvableContexts) {
      const parsed = parseGoogleFlightsText(context.candidateText, {
        ...parseOptions,
        bookingSegments: context.matchesBooking ? bookingItinerary?.segments || [] : []
      });
      if (!parsed.ok) continue;
      const key = itineraryIdentity(parsed.itinerary);
      const existing = identities.get(key);
      if (existing) {
        existing.contexts.push(context);
        existing.matchesBooking = existing.matchesBooking || context.matchesBooking;
        existing.selectionRank = Math.max(existing.selectionRank, context.selectionRank);
      } else {
        identities.set(key, {
          parsed,
          contexts: [context],
          matchesBooking: context.matchesBooking,
          selectionRank: context.selectionRank
        });
      }
    }

    const viable = [...identities.values()];
    if (viable.length === 0) {
      return failure("NO_RELIABLE_CANDIDATE", "We couldn't reliably detect this itinerary. Open one complete itinerary and try again.");
    }
    if (viable.length === 1) return { ok: true, candidate: viable[0] };

    const bookingMatches = viable.filter((candidate) => candidate.matchesBooking);
    if (bookingMatches.length === 1) return { ok: true, candidate: bookingMatches[0] };
    if (bookingMatches.length > 1) {
      return failure("AMBIGUOUS_ITINERARY", "More than one itinerary matches the booking context. Open one itinerary and try again.", { candidatesFound: bookingMatches.length });
    }

    const strongestRank = Math.max(...viable.map((candidate) => candidate.selectionRank));
    const strongest = viable.filter((candidate) => candidate.selectionRank === strongestRank);
    if (strongestRank >= 60 && strongest.length === 1) return { ok: true, candidate: strongest[0] };

    return failure(
      "AMBIGUOUS_ITINERARY",
      "We couldn't reliably identify which itinerary is currently selected. Open or expand one itinerary and try again.",
      { candidatesFound: viable.length }
    );
  }

  function evidenceContexts(candidate) {
    const strongestRank = Math.max(...candidate.contexts.map((context) => context.selectionRank));
    return candidate.contexts.filter(
      (context) => context.ticketScopeReliable && context.selectionRank === strongestRank
    );
  }

  function combinedTicketEvidence(candidate, bookingItinerary) {
    const contexts = evidenceContexts(candidate);
    const detections = contexts.map((context) => detectTicketStatus(context.candidateText, {
      bookingSegments: bookingItinerary?.segments || []
    }));
    const explicit = new Set(detections.filter((item) => item.status !== "unknown").map((item) => item.status));
    if (explicit.size > 1) {
      return { status: "unknown", confidence: "low", basis: "Candidate contexts contain conflicting ticket-status wording." };
    }
    if (explicit.size === 1) return detections.find((item) => item.status === [...explicit][0]);
    return detectTicketStatus("", { bookingSegments: candidate.matchesBooking ? bookingItinerary?.segments || [] : [] });
  }

  function combinedBaggageEvidence(candidate) {
    const detections = evidenceContexts(candidate).map((context) => detectBaggageEvidence(context.candidateText));
    const recheck = detections.some((item) => item.recheckRequired === true);
    const throughChecked = detections.some((item) => item.throughChecked === true);
    const evidence = detections.flatMap((item) => item.evidence);
    if (recheck && throughChecked) return { confidence: "low", evidence };
    if (recheck) return { recheckRequired: true, throughChecked: false, confidence: "high", evidence };
    if (throughChecked) return { recheckRequired: false, throughChecked: true, confidence: "high", evidence };
    return { confidence: "low", evidence: [] };
  }

  function parseGoogleFlightsDocument(documentObject, options = {}) {
    const pageText = documentObject.body?.innerText || "";
    const pageUrl = documentObject.location?.href || (typeof location !== "undefined" ? location.href : "");
    const bookingItinerary = extractBookingItinerary(pageUrl);
    const travelDate = bookingItinerary?.travelDate
      || extractDate(pageText, options.now || new Date())
      || extractDateFromBookingUrl(pageUrl);
    const resolution = resolveCandidate(documentObject, bookingItinerary, {
      ...options,
      travelDate
    });
    if (!resolution.ok) return resolution;
    const candidate = resolution.candidate;
    const result = candidate.parsed;
    result.ticketEvidence = combinedTicketEvidence(candidate, bookingItinerary);
    result.baggageEvidence = combinedBaggageEvidence(candidate);
    const reliableContext = evidenceContexts(candidate).length > 0;
    result.confidence = candidate.matchesBooking && reliableContext ? "high" : "confirm";
    result.fingerprint = [
      result.fingerprint,
      result.ticketEvidence.status,
      String(result.baggageEvidence.recheckRequired === true),
      result.confidence
    ].join("|");
    return result;
  }

  return {
    extractDate,
    extractDateFromBookingUrl,
    extractBookingItinerary,
    extractFlights,
    extractRoutes,
    extractTimes,
    detectTicketStatus,
    detectBaggageEvidence,
    parseGoogleFlightsDocument,
    parseGoogleFlightsText,
    toApiPayload
  };
});
