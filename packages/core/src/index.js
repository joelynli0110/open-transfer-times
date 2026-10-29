"use strict";

// Node / bundler entry point for connection-risk-core.
// In a browser without a bundler, load the UMD files directly in this order:
// itinerary.js, airport-catalog.js, data/airport-data.generated.js,
// airport-rules.js, engine.js — they register globals under ConnectionQuality*.

const { assessConnection, minutesBetween, qualityForBuffer } = require("./engine.js");
const { createNormalizedItinerary, normalizeAirport, normalizeSegment } = require("./itinerary.js");
const { travelZone, getAirportProfile, listAirportProfiles } = require("./airport-rules.js");
const { nameForAirport } = require("./airport-catalog.js");

module.exports = {
  assessConnection,
  minutesBetween,
  qualityForBuffer,
  createNormalizedItinerary,
  normalizeAirport,
  normalizeSegment,
  travelZone,
  getAirportProfile,
  listAirportProfiles,
  nameForAirport
};
