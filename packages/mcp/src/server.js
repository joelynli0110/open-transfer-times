"use strict";

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const z = require("zod");
const core = require("open-transfer-times");
const { AIRPORT_RULES, FALLBACK_RULE } = require("open-transfer-times/src/airport-rules.js");
const { version } = require("../package.json");

const QUALITY_RANK = { comfortable: 0, reasonable: 1, tight: 2, risky: 3 };
const LOCAL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const DISCLAIMER =
  "Structural estimate from scheduled times and published airport information. " +
  "Not an official minimum connection time and not a delay prediction.";

// ---------------------------------------------------------------------------
// Input schemas

const iata = z.string().trim().regex(/^[A-Za-z]{3}$/, "3-letter IATA airport code").transform((value) => value.toUpperCase());
const localTime = z.string().regex(LOCAL_TIME, "Local wall-clock time at the connection airport, YYYY-MM-DDTHH:mm");

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
  baggage_recheck: z.boolean().optional().describe("Set true if checked bags must be collected and checked in again")
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
  quality: z.enum(["comfortable", "reasonable", "tight", "risky"]),
  verdict: z.string(),
  layover_minutes: z.number(),
  transfer_process_minutes: z.number(),
  buffer_minutes: z.number(),
  steps: z.array(stepOutput),
  factors: z.array(z.object({ code: z.string(), label: z.string(), severity: z.string(), explanation: z.string() })),
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

// The engine works on wall-clock times. When only a duration is known, use a
// neutral reference date; the date never affects the result.
const REFERENCE_ARRIVAL = "2000-01-01T00:00";

function itineraryTimes(input) {
  const hasArrival = input.arrival_time !== undefined;
  const hasDeparture = input.departure_time !== undefined;
  if (hasArrival !== hasDeparture) {
    throw new Error("Give both arrival_time and departure_time, or give layover_minutes instead.");
  }
  if (hasArrival) {
    const fromTimes = core.minutesBetween(input.arrival_time, input.departure_time);
    if (input.layover_minutes !== undefined && fromTimes !== null && fromTimes !== input.layover_minutes) {
      throw new Error(`layover_minutes (${input.layover_minutes}) does not match the given times (${fromTimes} min).`);
    }
    return { arrival: input.arrival_time, departure: input.departure_time, source: "times" };
  }
  if (input.layover_minutes === undefined) {
    throw new Error("Give arrival_time and departure_time, or layover_minutes.");
  }
  const departure = new Date(Date.UTC(2000, 0, 1, 0, input.layover_minutes)).toISOString().slice(0, 16);
  return { arrival: REFERENCE_ARRIVAL, departure, source: "duration" };
}

function assess(input) {
  const times = itineraryTimes(input);
  const itinerary = {
    baggageRecheckRequired: input.baggage_recheck === true,
    segments: [
      { origin: input.from, destination: input.via, arrivalTime: times.arrival, arrivalTerminal: input.arrival_terminal },
      { origin: input.via, destination: input.to, departureTime: times.departure, departureTerminal: input.departure_terminal }
    ]
  };
  const result = core.assessConnection(itinerary, {
    ticketStatus: input.ticket,
    terminalChange: input.terminal_change === true,
    baggageRecheck: input.baggage_recheck === true
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
    quality: result.quality,
    verdict: result.verdict,
    layover_minutes: result.layoverMinutes,
    transfer_process_minutes: result.structuralProcessMinutes,
    buffer_minutes: result.structuralBufferMinutes,
    steps,
    factors: result.processFactors.map(({ code, label, severity, explanation }) => ({ code, label, severity, explanation })),
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
  return [
    `${assessment.route}: ${assessment.quality.toUpperCase()} — ${assessment.verdict}`,
    `Layover ${assessment.layover_minutes} min, transfer steps ${assessment.transfer_process_minutes} min, margin ${assessment.buffer_minutes} min.`,
    `Steps counted: ${assessment.steps.map((step) => `${step.label} ${step.minutes} min (${step.basis})`).join("; ")}. No other steps were counted.`,
    `Factors: ${assessment.factors.map((factor) => factor.label).join("; ")}.`,
    `Ticket: ${assessment.ticket.label}.`,
    `Data: ${dataNote}.`,
    ...(assessment.connection_airport.facts.length
      ? ["Airport facts are context, not extra steps. Apply a fact only where its scope matches this trip:",
        ...assessment.connection_airport.facts.map((fact) => `- ${fact.claim}${fact.scope ? ` [scope: ${fact.scope}]` : ""}`)]
      : [])
  ].join("\n");
}

function errorResult(error) {
  return { isError: true, content: [{ type: "text", text: `Could not assess this connection: ${error.message}` }] };
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

// ---------------------------------------------------------------------------
// Server

function createServer() {
  const server = new McpServer({ name: "open-transfer-times", version });

  server.registerTool("check_connection", {
    title: "Check a flight connection",
    description:
      "Assess whether a one-stop flight connection leaves enough time to transfer. Deducts the transfer steps that apply at " +
      "the connection airport (walking, Schengen passport control, terminal change, security re-screening, baggage re-check) " +
      "from the scheduled layover and returns comfortable / reasonable / tight / risky, the reasons, ticket-protection " +
      "exposure, and the cited airport facts behind the estimate. Give the scheduled arrival and departure as local wall-clock " +
      "times at the connection airport, or only layover_minutes when that is all the user said. Explain the result using " +
      "the returned steps; airport facts are context and only apply where their scope matches the trip.",
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
      "Assess several one-stop itineraries (for example the results of a flight search) and rank them from safest to " +
      "riskiest connection. Each option takes times or layover_minutes, like check_connection. Use the optional id to map " +
      "results back to your own options (e.g. an offer id or price).",
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
      return QUALITY_RANK[a.assessment.quality] - QUALITY_RANK[b.assessment.quality]
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
        ? `${entry.rank}. ${label}${entry.assessment.route}: ${entry.assessment.quality}, margin ${entry.assessment.buffer_minutes} min, ${entry.assessment.ticket.label.toLowerCase()}`
        : `${entry.rank}. ${label}could not be assessed: ${entry.error}`;
    }).join("\n");
    return { content: [{ type: "text", text }], structuredContent: { ranked, disclaimer: DISCLAIMER } };
  });

  server.registerTool("get_airport_profile", {
    title: "Get an airport's transfer profile",
    description:
      "Return the transfer allowances used for an airport, whether each is a heuristic estimate or sourced, and the cited " +
      "facts (with official source links) about transferring there. Airports without a profile use the standard baseline.",
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
    description: "List the airports that have their own transfer profile, with how well each is sourced.",
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
