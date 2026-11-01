(function exposeTime(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ConnectionQualityTime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createTime() {
  "use strict";

  // Layover length from two local times at the connection airport.
  //
  // Times are "YYYY-MM-DDTHH:mm[:ss]" in the airport's local time, optionally
  // with an explicit offset ("Z", "+02:00"). With an offset the instant is
  // exact. Without one, the airport's IANA time zone (when known) turns the
  // local time into an instant, so a layover across a daylight-saving change
  // has its real length. With neither, the clocks are simply subtracted.
  // Uses only Intl, which Node and browsers ship with full time-zone data.

  const PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?$/;
  const MINUTE = 60000;
  const DAY = 86400000;
  const MAX_LAYOVER_MINUTES = 1440;

  function parse(value) {
    const match = String(value || "").match(PATTERN);
    if (!match) return null;
    const [, y, mo, d, h, mi, s = "0", zone] = match;
    const parts = [y, mo, d, h, mi, s].map(Number);
    const wall = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
    const date = new Date(wall);
    if (date.getUTCFullYear() !== parts[0] || date.getUTCMonth() !== parts[1] - 1 || date.getUTCDate() !== parts[2] ||
        date.getUTCHours() !== parts[3] || date.getUTCMinutes() !== parts[4] || date.getUTCSeconds() !== parts[5]) {
      return null;
    }
    let offsetMinutes = null;
    if (zone === "Z") offsetMinutes = 0;
    else if (zone) {
      const sign = zone[0] === "-" ? -1 : 1;
      const [oh, om] = zone.slice(1).split(":").map(Number);
      if (oh > 14 || om > 59) return null;
      offsetMinutes = sign * (oh * 60 + om);
    }
    return { text: String(value), wall, offsetMinutes };
  }

  const formatters = new Map();
  function formatterFor(timeZone) {
    if (!formatters.has(timeZone)) {
      formatters.set(timeZone, new Intl.DateTimeFormat("en-US", {
        timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit"
      }));
    }
    return formatters.get(timeZone);
  }

  // UTC offset in minutes of `timeZone` at the given instant.
  function offsetAt(instant, timeZone) {
    const fields = {};
    for (const part of formatterFor(timeZone).formatToParts(new Date(instant))) fields[part.type] = Number(part.value);
    const asUtc = Date.UTC(fields.year, fields.month - 1, fields.day, fields.hour, fields.minute, fields.second);
    return Math.round((asUtc - Math.floor(instant / 1000) * 1000) / MINUTE);
  }

  // Every instant at which the local clock in `timeZone` shows `wall`:
  // one normally, none in a skipped hour, two in a repeated hour.
  function instantsFor(wall, timeZone) {
    const candidates = new Set([offsetAt(wall - DAY, timeZone), offsetAt(wall + DAY, timeZone), offsetAt(wall, timeZone)]);
    const instants = [];
    for (const offset of candidates) {
      const instant = wall - offset * MINUTE;
      if (offsetAt(instant, timeZone) === offset) instants.push(instant);
    }
    return [...new Set(instants)].sort((a, b) => a - b);
  }

  function isTimeZone(timeZone) {
    try {
      formatterFor(timeZone);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * @returns {{ minutes: number, wallClockMinutes: number, basis: "offset"|"timezone"|"wall_clock",
   *             ambiguous: boolean, timeZone?: string }}
   * @throws  when a time is malformed, does not exist locally, or the layover is not 1–1440 minutes.
   */
  function layover(arrival, departure, timeZone) {
    const a = parse(arrival);
    const d = parse(departure);
    if (!a || !d) throw new Error("Open both flight segments to show the connection time.");
    const zone = timeZone && isTimeZone(timeZone) ? timeZone : undefined;
    const wallClockMinutes = Math.round((d.wall - a.wall) / MINUTE);

    let basis;
    let ambiguous = false;
    let arrivalInstants;
    let departureInstants;
    const exact = (p) => [p.wall - p.offsetMinutes * MINUTE];

    if (a.offsetMinutes !== null && d.offsetMinutes !== null) {
      basis = "offset";
      arrivalInstants = exact(a);
      departureInstants = exact(d);
    } else if (zone) {
      basis = a.offsetMinutes !== null || d.offsetMinutes !== null ? "offset" : "timezone";
      const resolve = (p) => {
        if (p.offsetMinutes !== null) return exact(p);
        const instants = instantsFor(p.wall, zone);
        if (!instants.length) {
          throw new Error(`${p.text} does not exist in ${zone}: the clocks skip that hour. Check the time.`);
        }
        if (instants.length > 1) ambiguous = true;
        return instants;
      };
      arrivalInstants = resolve(a);
      departureInstants = resolve(d);
    } else {
      // No time zone: assume both clocks share whatever single offset was given, else plain clock arithmetic.
      basis = "wall_clock";
      const shared = a.offsetMinutes !== null ? a.offsetMinutes : d.offsetMinutes !== null ? d.offsetMinutes : 0;
      arrivalInstants = [a.wall - shared * MINUTE];
      departureInstants = [d.wall - shared * MINUTE];
      if (a.offsetMinutes !== null || d.offsetMinutes !== null) basis = "offset";
    }

    // A repeated hour is resolved to the shortest possible layover: the safe reading.
    const minutes = Math.round((Math.min(...departureInstants) - Math.max(...arrivalInstants)) / MINUTE);
    if (!(minutes > 0 && minutes <= MAX_LAYOVER_MINUTES)) {
      throw new Error("Open both flight segments to show the connection time.");
    }
    return { minutes, wallClockMinutes, basis, ambiguous, ...(zone ? { timeZone: zone } : {}) };
  }

  return { layover, parse, instantsFor, offsetAt, isTimeZone };
});
