const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const input = path.join(root, "data", "public", "airports.csv");
const output = path.join(root, "extension", "src", "data", "airport-catalog.js");

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else value += character;
  }
  values.push(value);
  return values;
}

const lines = fs.readFileSync(input, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/);
const headers = parseCsvLine(lines.shift());
const column = Object.fromEntries(headers.map((header, index) => [header, index]));
const catalog = {};
for (const line of lines) {
  if (!line) continue;
  const row = parseCsvLine(line);
  const iata = row[column.iata_code];
  const name = row[column.name];
  if (/^[A-Z]{3}$/.test(iata || "") && name && !catalog[iata]) catalog[iata] = name;
}

const source = `(function exposeAirportCatalog(root, factory) {\n` +
  `  const api = factory();\n` +
  `  if (typeof module === "object" && module.exports) module.exports = api;\n` +
  `  root.ConnectionQualityAirportCatalog = api;\n` +
  `})(typeof globalThis !== "undefined" ? globalThis : this, function createAirportCatalog() {\n` +
  `  "use strict";\n` +
  `  // Generated from the public-domain OurAirports airports.csv dataset.\n` +
  `  const AIRPORT_NAMES = Object.freeze(${JSON.stringify(catalog)});\n` +
  `  function nameForAirport(iata) { return AIRPORT_NAMES[String(iata || "").toUpperCase()]; }\n` +
  `  return { AIRPORT_NAMES, nameForAirport };\n` +
  `});\n`;

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, source, "utf8");
console.log(`Generated ${Object.keys(catalog).length} airport names in ${output}`);
