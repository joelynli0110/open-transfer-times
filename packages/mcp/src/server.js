"use strict";

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const z = require("zod");
const core = require("open-transfer-times");
const { AIRPORT_RULES, FALLBACK_RULE } = require("open-transfer-times/src/airport-rules.js");
const { version } = require("../package.json");

const QUALITY_RANK = { comfortable: 0, reasonable: 1, tight: 2, risky: 3 };
// Equal physical quality: a protected ticket beats an unknown one beats a self-transfer.
const PROTECTION_RANK = { protected: 0, unknown: 1, separate: 2 };
const CONFIDENCE_RANK = { high: 0, medium: 1, low: 2 };
const DECISION_RANK = Object.fromEntries(core.DECISIONS.map((value, index) => [value, index]));
const LOCAL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})?$/;
const DISCLAIMER =
  "Structural estimate from scheduled times and published airport information. " +
  "Not an official minimum connection time and not a delay prediction.";

// ---------------------------------------------------------------------------
// Input schemas

const iata = z.string().trim().regex(/^[A-Za-z]{3}$/, "3-letter IATA airport code").transform((value) => value.toUpperCase());
const localTime = z.string().regex(LOCAL_TIME, "Local time at the connection airport, YYYY-MM-DDTHH:mm, optionally with a UTC offset such as +02:00");

const connectionFields = {
  from: iata.describe("Origin airport of the first flight (IATA), e.g. BER"),
  via: iata.describe("Connection airport (IATA), e.g. IST"),
  to: iata.describe("Destination airport of the second flight (IATA), e.g. PVG"),
  arrival_time: localTime.optional()
    .describe("Scheduled arrival of the first flight at the connection airport, local time, YYYY-MM-DDTHH:mm. Give both times, or layover_minutes instead."),
  departure_time: localTime.optional()
    .describe("Scheduled departure of the second flight from the connection airport, local time, YYYY-MM-DDTHH:mm. Give both times, or layover_minutes instead."),
  layover_minutes: z.number().int().min(1).max(1440).optional()
    .describe("Scheduled time between arrival and departure, in minutes. Use this when the user gives only a layover duration; do not invent dates or clock times."),
  ticket: z.enum(["protected", "separate", "unknown"]).default("unknown")
    .describe("protected = both flights on one ticket/booking; separate = self-transfer on separate tickets; unknown if not stated"),
  arrival_terminal: z.string().trim().min(1).optional().describe("Arrival terminal at the connection airport, if known"),
  departure_terminal: z.string().trim().min(1).optional().describe("Departure terminal at the connection airport, if known"),
  terminal_change: z.boolean().optional().describe("Set true if a terminal change is known but terminals are not given"),
  baggage_recheck: z.boolean().optional()
    .describe("true if checked bags must be collected and checked in again, false if not (hand luggage only, or bags checked through). On separate tickets, leave it out only if unknown: the result then says whether it matters.")
};
const connectionInput = z.object(connectionFields);

// ---------------------------------------------------------------------------
// Output schemas

const sourceOutput = z.object({ title: z.string(), publisher: z.string(), url: z.string() });
const factOutput = z.object({
  id: z.string(),
  claim: z.string(),
  scope: z.string().optional(),
  source: sourceOutput
});
const allowanceOutput = z.object({
  step: z.string(),
  minutes: z.number(),
  basis: z.enum(["heuristic", "sourced"]),
  supporting_facts: z.array(z.string())
});
const stepOutput = z.object({
  code: z.string(),
  label: z.string(),
  minutes: z.number(),
  basis: z.enum(["heuristic", "sourced"]),
  supporting_facts: z.array(z.string())
});
const airportDataOutput = z.object({
  iata: z.string(),
  name: z.string().optional(),
  has_profile: z.boolean(),
  coverage: z.enum(["sourced", "partial", "heuristic", "baseline"]),
  last_reviewed: z.string().optional(),
  allowances: z.array(allowanceOutput),
  facts: z.array(factOutput)
});
const connectionAirportOutput = airportDataOutput.omit({ allowances: true });
const assessmentOutput = z.object({
  route: z.string(),
  layover_source: z.enum(["times", "duration"]),
  decision: z.object({
    value: z.enum(["recommend", "caution", "insufficient_data", "avoid"]),
    reasons: z.array(z.object({ code: z.string(), explanation: z.string() }))
  }).describe("What to do with this connection. insufficient_data means key information is missing: ask the user rather than recommending it."),
  layover_basis: z.enum(["timezone", "offset", "wall_clock", "duration"])
    .describe("How the layover length was computed: the airport's time zone, explicit UTC offsets, plain clock difference, or a given duration."),
  wall_clock_layover_minutes: z.number().optional().describe("Present when clocks change during the layover: what the local clocks show."),
  baggage_recheck: z.enum(["required", "not_required", "unknown"]),
  if_baggage_recheck: z.object({ buffer_minutes: z.number(), quality: z.string() }).optional()
    .describe("Separate tickets with unknown bags: the result if bags must be re-checked."),
  quality: z.enum(["comfortable", "reasonable", "tight", "risky"]),
  verdict: z.string(),
  layover_minutes: z.number(),
  transfer_process_minutes: z.number(),
  buffer_minutes: z.number(),
  steps: z.array(stepOutput),
  factors: z.array(z.object({ code: z.string(), label: z.string(), severity: z.string(), explanation: z.string() })),
  confidence: z.object({
    level: z.enum(["high", "medium", "low"]),
    reasons: z.array(z.object({ code: z.string(), explanation: z.string() }))
  }).describe("How far the estimate can be trusted, independent of the quality rating. Low means key information is missing."),
  ticket: z.object({ status: z.string(), label: z.string(), detail: z.string() }),
  connection_airport: connectionAirportOutput,
  disclaimer: z.string()
});

// ---------------------------------------------------------------------------
// Helpers

const ALLOWANCE_STEPS = {
  baseTransfer: "base_transfer",
  passportControl: "passport_control",
  terminalChange: "terminal_change",
  securityRescreening: "security_rescreening"
};

function describeAirport(code) {
  const profile = core.getAirportProfile(code);
  if (!profile) {
    return {
      iata: code,
      name: core.nameForAirport(code),
      has_profile: false,
      coverage: "baseline",
      allowances: [],
      facts: []
    };
  }
  return {
    iata: profile.iata,
    name: profile.name,
    has_profile: true,
    coverage: profile.coverage,
    last_reviewed: profile.lastReviewed,
    allowances: Object.entries(profile.allowances).map(([key, allowance]) => ({
      step: ALLOWANCE_STEPS[key],
      minutes: allowance.minutes,
      basis: allowance.basis,
      supporting_facts: [...allowance.facts]
    })),
    facts: profile.facts.map((fact) => {
      const source = profile.sources[fact.source];
      return {
        id: fact.id,
        claim: fact.claim,
        ...(fact.scope ? { scope: fact.scope } : {}),
        source: { title: source.title, publisher: source.publisher, url: source.url }
      };
    })
  };
}

// Engine check codes → the airport allowance that supplied their minutes.
const STEP_ALLOWANCES = {
  AIRPORT_TRANSFER: ["baseTransfer", "baseTransferMinutes"],
  SCHENGEN_BORDER_CONTROL: ["passportControl", "passportMinutes"],
  TERMINAL_CHANGE: ["terminalChange", "terminalChangeMinutes"],
  SECURITY_RESCREENING: ["securityRescreening", "securityMinutes"]
};
// Fixed engine allowances that do not come from an airport profile.
const FIXED_STEP_MINUTES = { INTERNATIONAL_TRANSFER: 10, BAGGAGE_RECHECK: 45 };
// Checks the engine reports as "not applicable" rather than as a transfer step.
const NOT_APPLIED_DETAIL = /^Not indicated/;

function appliedSteps(result) {
  const profile = core.getAirportProfile(result.connectionAirport);
  const rule = AIRPORT_RULES[result.connectionAirport] || FALLBACK_RULE;
  return result.checks
    .filter((check) => !NOT_APPLIED_DETAIL.test(check.detail))
    .map((check) => {
      if (Object.hasOwn(FIXED_STEP_MINUTES, check.code)) {
        return { code: check.code, label: check.label, minutes: FIXED_STEP_MINUTES[check.code], basis: "heuristic", supporting_facts: [] };
      }
      const mapping = STEP_ALLOWANCES[check.code];
      if (!mapping) throw new Error(`Unknown engine step ${check.code}`);
      const [allowanceKey, ruleKey] = mapping;
      const allowance = profile?.allowances[allowanceKey];
      return {
        code: check.code,
        label: check.label,
        minutes: rule[ruleKey],
        basis: allowance ? allowance.basis : "heuristic",
        supporting_facts: allowance ? [...allowance.facts] : []
      };
    });
}

// When only a duration is known, use a neutral reference date with explicit
// UTC offsets, so neither the date nor any time zone can affect the result.
const REFERENCE_ARRIVAL = "2000-01-01T00:00Z";

function itineraryTimes(input) {
  const hasArrival = input.arrival_time !== undefined;
  const hasDeparture = input.departure_time !== undefined;
  if (hasArrival !== hasDeparture) {
    throw new Error("Give both arrival_time and departure_time, or give layover_minutes instead.");
  }
  if (hasArrival) {
    let fromTimes = null;
    try {
      fromTimes = core.layoverMinutes(input.arrival_time, input.departure_time, input.via);
    } catch {
      // The assessment reports invalid times with the engine's own message.
    }
    if (input.layover_minutes !== undefined && fromTimes !== null && fromTimes !== input.layover_minutes) {
      throw new Error(`layover_minutes (${input.layover_minutes}) does not match the given times (${fromTimes} min).`);
    }
    return { arrival: input.arrival_time, departure: input.departure_time, source: "times" };
  }
  if (input.layover_minutes === undefined) {
    throw new Error("Give arrival_time and departure_time, or layover_minutes.");
  }
  const departure = `${new Date(Date.UTC(2000, 0, 1, 0, input.layover_minutes)).toISOString().slice(0, 16)}Z`;
  return { arrival: REFERENCE_ARRIVAL, departure, source: "duration" };
}

function assess(input) {
  const times = itineraryTimes(input);
  const itinerary = {
    segments: [
      { origin: input.from, destination: input.via, arrivalTime: times.arrival, arrivalTerminal: input.arrival_terminal },
      { origin: input.via, destination: input.to, departureTime: times.departure, departureTerminal: input.departure_terminal }
    ]
  };
  const result = core.assessConnection(itinerary, {
    ticketStatus: input.ticket,
    terminalChange: input.terminal_change === true,
    baggageRecheck: input.baggage_recheck // true, false, or undefined = unknown
  });
  const steps = appliedSteps(result);
  const stepTotal = steps.reduce((sum, step) => sum + step.minutes, 0);
  if (stepTotal !== result.structuralProcessMinutes) {
    throw new Error(`Internal error: transfer steps (${stepTotal} min) do not add up to ${result.structuralProcessMinutes} min.`);
  }
  const { allowances: _unused, ...connectionAirport } = describeAirport(input.via);
  return {
    route: `${input.from}–${input.via}–${input.to}`,
    layover_source: times.source,
    decision: {
      value: result.decision.value,
      reasons: result.decision.reasons.map(({ code, explanation }) => ({ code, explanation }))
    },
    layover_basis: times.source === "duration" ? "duration" : result.layoverBasis,
    ...(result.wallClockLayoverMinutes !== result.layoverMinutes ? { wall_clock_layover_minutes: result.wallClockLayoverMinutes } : {}),
    baggage_recheck: result.baggageRecheck,
    ...(result.ifBaggageRecheck ? { if_baggage_recheck: { buffer_minutes: result.ifBaggageRecheck.bufferMinutes, quality: result.ifBaggageRecheck.quality } } : {}),
    quality: result.quality,
    verdict: result.verdict,
    layover_minutes: result.layoverMinutes,
    transfer_process_minutes: result.structuralProcessMinutes,
    buffer_minutes: result.structuralBufferMinutes,
    steps,
    factors: result.processFactors.map(({ code, label, severity, explanation }) => ({ code, label, severity, explanation })),
    confidence: {
      level: result.confidence.level,
      reasons: result.confidence.reasons.map(({ code, explanation }) => ({ code, explanation }))
    },
    ticket: { ...result.ticketProtection },
    connection_airport: connectionAirport,
    disclaimer: DISCLAIMER
  };
}

function summarize(assessment) {
  const airport = assessment.connection_airport;
  const dataNote = airport.has_profile
    ? `${airport.name} profile (${airport.coverage}, ${airport.facts.length} cited fact${airport.facts.length === 1 ? "" : "s"})`
    : "standard baseline (no airport-specific profile)";
  // With insufficient data the rating ("comfortable", "healthy margin") is left out of the text: in the agent
  // evaluation, agents repeated it as reassurance even when the decision said it could not be relied on.
  const insufficient = assessment.decision.value === "insufficient_data";
  const confidenceReasons = assessment.confidence.reasons.map((reason) => reason.explanation).join(" ");
  return [
    // The decision leads: agents tend to repeat the first rating they read.
    insufficient
      ? `${assessment.route}: INSUFFICIENT DATA — ${confidenceReasons} The result cannot be relied on.`
      : `${assessment.route}: ${decisionLabel(assessment)} — ${assessment.decision.reasons.map((reason) => reason.explanation).join(" ")}`,
    insufficient
      ? "Do not call this connection safe, fine or comfortable. Tell the user the estimate is unreliable, why, and what would settle it."
      : `Rating: ${assessment.quality.toUpperCase()} — ${assessment.verdict}${RELIABLE[assessment.decision.value] ? "" : " (not a recommendation: see the decision)"}`,
    insufficient
      ? "Confidence: LOW, for the reasons above."
      : `Confidence: ${assessment.confidence.level.toUpperCase()} — ${confidenceReasons}${assessment.confidence.level === "low"
        ? " Tell the user this estimate is less reliable and why." : ""}`,
    `${insufficient ? "Rough estimate only: layover" : "Layover"} ${assessment.layover_minutes} min${assessment.wall_clock_layover_minutes !== undefined
      ? ` (clocks change: local clocks show ${assessment.wall_clock_layover_minutes} min)` : ""}, transfer steps ${assessment.transfer_process_minutes} min, margin ${assessment.buffer_minutes} min.`,
    `Steps counted: ${assessment.steps.map((step) => `${step.label} ${step.minutes} min (${step.basis})`).join("; ")}. No other steps were counted.`,
    ...(insufficient ? [] : [`Factors: ${assessment.factors.map((factor) => factor.label).join("; ")}.`]),
    `Ticket: ${assessment.ticket.label}.`,
    ...(assessment.if_baggage_recheck
      ? [`Bags: not stated. If they must be collected and checked in again, the margin is ${assessment.if_baggage_recheck.buffer_minutes} min (${assessment.if_baggage_recheck.quality}). Ask the user.`]
      : []),
    `Data: ${dataNote}.`,
    "Comparing several options? Send them together to compare_connections, which ranks them.",
    ...(assessment.connection_airport.facts.length
      ? ["Airport facts are context, not extra steps. Apply a fact only where its scope matches this trip:",
        // The scope leads, so a reader cannot miss that the fact is conditional.
        ...assessment.connection_airport.facts.map((fact) => `- ${fact.scope ? `(Only for: ${fact.scope}) ` : ""}${fact.claim}`)]
      : [])
  ].join("\n");
}

// Decisions under which the connection may be presented as fine.
const RELIABLE = { recommend: true, caution: true, insufficient_data: false, avoid: false };

function decisionLabel(assessment) {
  return assessment.decision.value.toUpperCase().replace("_", " ");
}

// Why an option is not recommended, for the compare_connections text.
function concerns(assessment) {
  if (assessment.decision.value === "recommend") return "";
  const reasons = assessment.decision.reasons.map((reason) => reason.explanation);
  if (assessment.confidence.level === "low") reasons.push(...assessment.confidence.reasons.map((reason) => reason.explanation));
  return `\n   Why: ${reasons.join(" ")}`;
}

function errorResult(error) {
  return { isError: true, content: [{ type: "text", text: `Could not assess this connection: ${error.message}` }] };
}

// Sent to clients on connect. Each rule addresses a failure seen when testing
// agents with this server.
const INSTRUCTIONS = [
  "Use these tools to check whether a flight connection leaves enough time to transfer. The tools do the arithmetic; explain their results, do not recompute them.",
  "- Call a tool first with what the user gave. Ticket type and checked bags may be unknown: leave them out and the tool reports what they would change.",
  "- If the user gives only a layover length (\"50 minutes in Frankfurt\"), pass layover_minutes. Never invent dates or clock times.",
  "- Ask before calling a tool only when the connection airport, or both the layover length and the times, are missing.",
  "- When the user compares two or more options, use compare_connections once with all of them, not check_connection for each.",
  "- For an itinerary with several stops, check each connection separately.",
  "- Explain only the transfer steps listed in `steps`; no other steps were counted.",
  "- Report the `decision`. For insufficient_data, say what is missing (from the confidence reasons) and do not present the connection as safe.",
  "- After giving the result: on separate tickets with if_baggage_recheck shown, ask whether bags must be re-checked.",
  "- Airport facts are context. A fact marked \"(Only for: …)\" applies only to those trips; do not apply it to others, and an airline's minimum connection time is not the airport's.",
  "- This is a structural estimate, not an official minimum connection time and not a delay prediction."
].join("\n");

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

// ---------------------------------------------------------------------------
// Server

function createServer() {
  const server = new McpServer({ name: "open-transfer-times", version }, { instructions: INSTRUCTIONS });

  server.registerTool("check_connection", {
    title: "Check a flight connection",
    description:
      "Assess one one-stop flight connection: does the layover leave enough time to transfer? Use it for a single " +
      "itinerary; to compare two or more options, use compare_connections once instead of calling this tool for each. " +
      "Deducts the transfer steps that apply at the connection airport (walking, Schengen passport control, terminal " +
      "change, security re-screening, baggage re-check) from the layover and returns a decision (recommend / caution / " +
      "insufficient_data / avoid), a rating (comfortable / reasonable / tight / risky), confidence with reasons, ticket " +
      "exposure and cited airport facts. Give arrival and departure as local times at the connection airport, or only " +
      "layover_minutes when that is all the user said. Deterministic and offline: no flight data, no delay prediction. " +
      "Explain only the returned steps; airport facts apply only where their scope matches the trip.",
    inputSchema: connectionFields,
    outputSchema: assessmentOutput.shape,
    annotations: { title: "Check a flight connection", ...READ_ONLY }
  }, async (input) => {
    try {
      const assessment = assess(input);
      return { content: [{ type: "text", text: summarize(assessment) }], structuredContent: assessment };
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool("compare_connections", {
    title: "Compare and rank flight connections",
    description:
      "Compare and rank 2–20 one-stop itineraries (for example flight search results, or options the user lists) from " +
      "safest to riskiest connection. Use it whenever the user weighs options; for a single itinerary use check_connection. " +
      "Ranks by decision (recommend, caution, insufficient data, avoid), then transfer quality, then ticket protection " +
      "(one ticket before unknown before self-transfer), then confidence, then remaining margin, and says why each option " +
      "that is not recommended is not. Each option takes times or layover_minutes, like check_connection; the optional " +
      "id maps results back to your own options (e.g. an offer id or price).",
    inputSchema: {
      options: z.array(connectionInput.extend({ id: z.string().optional().describe("Your identifier for this option") }))
        .min(2).max(20).describe("Two to twenty itineraries to compare")
    },
    outputSchema: {
      ranked: z.array(z.object({
        rank: z.number(),
        id: z.string().optional(),
        assessment: assessmentOutput.optional(),
        error: z.string().optional()
      })),
      disclaimer: z.string()
    },
    annotations: { title: "Compare and rank flight connections", ...READ_ONLY }
  }, async ({ options }) => {
    const evaluated = options.map((option, index) => {
      try {
        return { index, id: option.id, assessment: assess(option) };
      } catch (error) {
        return { index, id: option.id, error: error.message };
      }
    });
    evaluated.sort((a, b) => {
      if (a.error || b.error) return (a.error ? 1 : 0) - (b.error ? 1 : 0) || a.index - b.index;
      return DECISION_RANK[a.assessment.decision.value] - DECISION_RANK[b.assessment.decision.value]
        || QUALITY_RANK[a.assessment.quality] - QUALITY_RANK[b.assessment.quality]
        || PROTECTION_RANK[a.assessment.ticket.status] - PROTECTION_RANK[b.assessment.ticket.status]
        || CONFIDENCE_RANK[a.assessment.confidence.level] - CONFIDENCE_RANK[b.assessment.confidence.level]
        || b.assessment.buffer_minutes - a.assessment.buffer_minutes
        || a.index - b.index;
    });
    const ranked = evaluated.map(({ id, assessment, error }, position) => ({
      rank: position + 1,
      ...(id !== undefined ? { id } : {}),
      ...(assessment ? { assessment } : { error })
    }));
    const text = ranked.map((entry) => {
      const label = entry.id ? `${entry.id} ` : "";
      return entry.assessment
        ? `${entry.rank}. ${label}${entry.assessment.route}: ${decisionLabel(entry.assessment)} — ${entry.assessment.decision.value === "insufficient_data" ? "estimate only" : `rated ${entry.assessment.quality}`}, margin ${entry.assessment.buffer_minutes} min, ${entry.assessment.ticket.label.toLowerCase()}, ${entry.assessment.confidence.level} confidence${concerns(entry.assessment)}`
        : `${entry.rank}. ${label}could not be assessed: ${entry.error}`;
    }).join("\n") + "\nOnly RECOMMEND and CAUTION options may be presented as workable; for the others, say why.";
    return { content: [{ type: "text", text }], structuredContent: { ranked, disclaimer: DISCLAIMER } };
  });

  server.registerTool("get_airport_profile", {
    title: "Get an airport's transfer profile",
    description:
      "Return one airport's transfer allowances, whether each is a heuristic estimate or sourced, and the cited facts " +
      "(with official source links) about transferring there. Use it to answer questions about an airport itself or to " +
      "show sources; to judge a specific connection use check_connection, and to see which airports have a profile use " +
      "list_airports. Airports without a profile return the standard baseline.",
    inputSchema: { airport: iata.describe("IATA airport code, e.g. LHR") },
    outputSchema: airportDataOutput.shape,
    annotations: { title: "Get an airport's transfer profile", ...READ_ONLY }
  }, async ({ airport }) => {
    const data = describeAirport(airport);
    const text = data.has_profile
      ? [`${data.name} (${data.iata}) — coverage: ${data.coverage}, last reviewed ${data.last_reviewed}.`,
        ...data.allowances.map((a) => `- ${a.step}: ${a.minutes} min (${a.basis})`),
        ...data.facts.map((f) => `• ${f.claim} [${f.source.publisher}: ${f.source.url}]`)].join("\n")
      : `${data.name ? `${data.name} (${data.iata})` : data.iata} has no airport-specific profile; the standard international-transfer baseline applies.`;
    return { content: [{ type: "text", text }], structuredContent: data };
  });

  server.registerTool("list_airports", {
    title: "List airports with transfer profiles",
    description:
      "List the airports that have their own transfer profile, with how well each is sourced. Use it to tell the user " +
      "where results are better supported; for one airport's allowances and sources use get_airport_profile. Every other " +
      "airport is still accepted by the assessment tools, with the standard baseline and low confidence.",
    inputSchema: {},
    outputSchema: {
      airports: z.array(z.object({ iata: z.string(), name: z.string(), coverage: z.string(), facts: z.number() }))
    },
    annotations: { title: "List airports with transfer profiles", ...READ_ONLY }
  }, async () => {
    const airports = core.listAirportProfiles().map((profile) => ({
      iata: profile.iata,
      name: profile.name,
      coverage: profile.coverage,
      facts: profile.facts.length
    }));
    const text = airports.map((a) => `${a.iata} ${a.name} — ${a.coverage}, ${a.facts} facts`).join("\n");
    return { content: [{ type: "text", text }], structuredContent: { airports } };
  });

  return server;
}

module.exports = { createServer };
