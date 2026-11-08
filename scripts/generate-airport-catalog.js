const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const input = path.join(root, "data", "public", "airports.csv");
const output = path.join(root, "packages", "core", "src", "airport-catalog.js");

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
  const country = row[column.iso_country];
  const continent = row[column.continent];
  if (/^[A-Z]{3}$/.test(iata || "") && name && !catalog[iata]) {
    // [name, ISO 3166-1 country, OurAirports continent code (EU, AS, NA, SA, AF, OC, AN)]
    catalog[iata] = [name, /^[A-Z]{2}$/.test(country) ? country : "", /^[A-Z]{2}$/.test(continent) ? continent : ""];
  }
}

const source = `(function exposeAirportCatalog(root, factory) {\n` +
  `  const api = factory();\n` +
  `  if (typeof module === "object" && module.exports) module.exports = api;\n` +
  `  root.ConnectionQualityAirportCatalog = api;\n` +
  `})(typeof globalThis !== "undefined" ? globalThis : this, function createAirportCatalog() {\n` +
  `  "use strict";\n` +
  `  // Generated from the public-domain OurAirports airports.csv dataset.\n` +
  `  // Each entry: [name, ISO 3166-1 alpha-2 country, continent code].\n` +
  `  const AIRPORTS = Object.freeze(${JSON.stringify(catalog)});\n` +
  `  const entry = (iata) => AIRPORTS[String(iata || "").toUpperCase()];\n` +
  `  function nameForAirport(iata) { return entry(iata)?.[0]; }\n` +
  `  function countryForAirport(iata) { return entry(iata)?.[1] || undefined; }\n` +
  `  function continentForAirport(iata) { return entry(iata)?.[2] || undefined; }\n` +
  `  return { AIRPORTS, nameForAirport, countryForAirport, continentForAirport };\n` +
  `});\n`;

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, source, "utf8");
console.log(`Generated ${Object.keys(catalog).length} airports (name, country, continent) in ${output}`);
