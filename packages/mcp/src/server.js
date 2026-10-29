"use strict";

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const z = require("zod");
const core = require("open-transfer-times");
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
  arrival_time: localTime.describe("Scheduled arrival of the first flight at the connection airport, local time, YYYY-MM-DDTHH:mm"),
  departure_time: localTime.describe("Scheduled departure of the second flight from the connection airport, local time, YYYY-MM-DDTHH:mm"),
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
const airportDataOutput = z.object({
  iata: z.string(),
  name: z.string().optional(),
  has_profile: z.boolean(),
  coverage: z.enum(["sourced", "partial", "heuristic", "baseline"]),
  last_reviewed: z.string().optional(),
  allowances: z.array(allowanceOutput),
  facts: z.array(factOutput)
});
const assessmentOutput = z.object({
  route: z.string(),
  quality: z.enum(["comfortable", "reasonable", "tight", "risky"]),
  verdict: z.string(),
  layover_minutes: z.number(),
  transfer_process_minutes: z.number(),
  buffer_minutes: z.number(),
  factors: z.array(z.object({ code: z.string(), label: z.string(), severity: z.string(), explanation: z.string() })),
  ticket: z.object({ status: z.string(), label: z.string(), detail: z.string() }),
  connection_airport: airportDataOutput,
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

function assess(input) {
  const itinerary = {
    baggageRecheckRequired: input.baggage_recheck === true,
    segments: [
      { origin: input.from, destination: input.via, arrivalTime: input.arrival_time, arrivalTerminal: input.arrival_terminal },
      { origin: input.via, destination: input.to, departureTime: input.departure_time, departureTerminal: input.departure_terminal }
    ]
  };
  const result = core.assessConnection(itinerary, {
    ticketStatus: input.ticket,
    terminalChange: input.terminal_change === true,
    baggageRecheck: input.baggage_recheck === true
  });
  return {
    route: `${input.from}–${input.via}–${input.to}`,
    quality: result.quality,
    verdict: result.verdict,
    layover_minutes: result.layoverMinutes,
    transfer_process_minutes: result.structuralProcessMinutes,
    buffer_minutes: result.structuralBufferMinutes,
    factors: result.processFactors.map(({ code, label, severity, explanation }) => ({ code, label, severity, explanation })),
    ticket: { ...result.ticketProtection },
    connection_airport: describeAirport(input.via),
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
    `Factors: ${assessment.factors.map((factor) => factor.label).join("; ")}.`,
    `Ticket: ${assessment.ticket.label}.`,
    `Data: ${dataNote}.`
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
      "exposure, and the cited airport facts behind the estimate. Times are local wall-clock times at the connection airport.",
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
      "riskiest connection. Use the optional id to map results back to your own options (e.g. an offer id or price).",
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
