/**
 * The outside table for Shabbat times (plan W12.H8): its shape and the
 * comparison, as pure functions (tested in src/__tests__/shabbatTimes.test.ts;
 * the table is made by reference-shabbat-table.mjs).
 *
 * Table shape (`version: 1`): times are the local clock in the city's time
 * zone, as the table prints them.
 *   { source, retrieved, settings: { candles: {cityId: minutes}, havdalah: "8.5°" },
 *     rows: [[cityId, "YYYY-MM-DD", "candles" | "havdalah", "HH:MM"], …] }
 *
 * Only the times are kept: data, not anyone's code.
 */

/** "18:42" → 1122. */
export const clockMinutes = (s) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * Compare every row with ours. `ours(cityId, iso, kind)` gives our time as
 * minutes after local midnight, unrounded (or null). The difference is
 * ours minus theirs, in minutes; the table's minute is taken as printed.
 * Returns per city: rows, the largest |difference|, and the rows over `tolerance`.
 */
export function compareTable(table, ours, tolerance = 1) {
  const byCity = {};
  for (const [city, iso, kind, hhmm] of table.rows) {
    const c = (byCity[city] ??= { rows: 0, maxAbs: 0, over: [], missing: [] });
    c.rows++;
    const theirs = clockMinutes(hhmm);
    const o = ours(city, iso, kind);
    if (o === null || theirs === null) {
      c.missing.push([iso, kind, hhmm]);
      continue;
    }
    // A printed minute covers [m, m+1): measure against the nearer edge.
    const d = o < theirs ? o - theirs : o > theirs + 1 ? o - (theirs + 1) : 0;
    c.maxAbs = Math.max(c.maxAbs, Math.abs(d));
    if (Math.abs(d) > tolerance) c.over.push([iso, kind, hhmm, Math.round(o * 10) / 10]);
  }
  return byCity;
}

export function tableReport(cmp) {
  return Object.entries(cmp)
    .map(([c, v]) => `${c}: ${v.rows} rows, max |Δ| ${v.maxAbs.toFixed(2)} min, ${v.over.length} over, ${v.missing.length} missing`)
    .join("\n");
}
