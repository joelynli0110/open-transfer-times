"use strict";

// The "docs" baseline: the same airport data the engine uses, given to the model
// as reference text instead of through tools. Comparing it with the MCP run shows
// what the engine adds beyond the data itself (arithmetic, conditions, explicit
// uncertainty), not only what the data adds.

const core = require("../../packages/core");

function airportsInCase(testCase) {
  const codes = new Set();
  for (const call of testCase.expect?.calls || []) {
    const legs = call.leg ? [call.leg] : call.options || [];
    for (const leg of legs) {
      for (const key of ["via", "airport"]) {
        const values = Array.isArray(leg[key]) ? leg[key] : [leg[key]];
        for (const value of values) if (typeof value === "string" && /^[A-Z]{3}$/.test(value)) codes.add(value);
      }
    }
  }
  return [...codes];
}

function describeRoutes(routes) {
  return routes.map((route) => Object.entries(route).map(([key, value]) => {
    const [side, kind] = key.split("_");
    const what = kind === "schengen" ? (value ? "a Schengen country" : "outside Schengen") : Array.isArray(value) ? value.join(", ") : value;
    return `${side} ${kind === "schengen" ? "" : `${kind} `}${what}`.replace(/\s+/g, " ");
  }).join(" and ")).join("; or ");
}

function describeAirport(iata) {
  const profile = core.getAirportProfile(iata);
  const name = core.nameForAirport?.(iata) || profile?.name || iata;
  const zone = core.travelZone(iata);
  const lines = [`## ${name} (${iata})`, `Schengen area: ${zone === "unknown" ? "unknown" : zone === "schengen" ? "yes" : "no"}.`];
  if (!profile) {
    lines.push("No airport-specific transfer data. Generic estimates: about 35 min to move through the airport, 20 min for passport control when crossing the Schengen border.");
    return lines.join("\n");
  }
  const allowances = profile.allowances;
  const show = (label, allowance) => `- ${label}: ${allowance.minutes} min (${allowance.basis === "heuristic" ? "estimate" : allowance.basis})`;
  lines.push("Transfer time allowances:",
    show("Moving through the airport", allowances.baseTransfer),
    show("Passport control when crossing the Schengen border", allowances.passportControl),
    show("Terminal change, if needed", allowances.terminalChange),
    show("Another security check", allowances.securityRescreening));
  if (allowances.securityRescreening.appliesWhen) {
    lines.push(`  The security check applies to every trip except: ${describeRoutes(allowances.securityRescreening.appliesWhen.unless_route_any || [])}.`);
  }
  if (profile.facts.length) {
    lines.push("Facts from official sources:");
    for (const fact of profile.facts) {
      const source = profile.sources[fact.source];
      lines.push(`- ${fact.claim}${fact.scope ? ` (only for: ${fact.scope})` : ""}${source ? ` [${source.publisher}: ${source.url}]` : ""}`);
    }
  }
  return lines.join("\n");
}

function docsPrompt(testCase) {
  const airports = airportsInCase(testCase);
  if (!airports.length) return "";
  return ["# Reference: airport transfer information", ...airports.map(describeAirport)].join("\n\n");
}

module.exports = { docsPrompt, airportsInCase, describeAirport };
