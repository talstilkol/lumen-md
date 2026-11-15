/**
 * The outside reference for the study cycles (plan W12.H4): name matching
 * and the comparison, as pure functions (tested in
 * src/__tests__/learningCycles.test.ts; the fixture is made by
 * reference-from-hebcal-learning.mjs).
 *
 * The fixture holds hebcal-learning's OUTPUT only (dates, names, numbers),
 * generated outside the app: @hebcal/learning depends on @hebcal/core, which
 * is GPL, so neither is a dependency of Lumen and no code of theirs is here.
 *
 * Fixture shape (`version: 1`):
 *   { source, tool, generated, range: [from, to],
 *     dafYomi:      [[iso, name, blatt], …],
 *     mishnaYomi:   [[iso, [[tractate, "chapter:mishnah"], [tractate, "chapter:mishnah"]]], …],
 *     rambam1:      [[iso, name, perek], …],
 *     rambam3:      [[iso, [[name, perek], …]], …] }
 */

/** A name reduced for matching: lower case, letters only, the common transliteration variants folded. */
export function nameKey(name) {
  return String(name)
    .toLowerCase()
    .replace(/^(?:mishnah?|mishneh torah,?|tractate)\s+/, "")
    .replace(/[^a-z]/g, "")
    .replace(/kh/g, "ch")
    .replace(/^baba/, "bava")
    .replace(/(.)\1/g, "$1")
    .replace(/h$/, "");
}

/** Hebcal spellings that the folding above does not join to ours. */
const ALIASES = new Map(
  [
    ["Gitin", "Gittin"],
    ["Midot", "Middot"],
    ["Avot", "Pirkei Avot"],
    ["Pirke Avot", "Pirkei Avot"],
    ["Uktzin", "Oktzin"],
    ["Oktsin", "Oktzin"],
    ["Ohalot", "Oholot"],
    ["Taharot", "Tahorot"],
    ["Maasros", "Maasrot"],
    ["Maaserot", "Maasrot"],
    ["Machshirin", "Makhshirin"],
    ["Kilaim", "Kilayim"],
    ["Shviit", "Sheviit"],
    ["Bikurim", "Bikkurim"],
  ].map(([a, b]) => [nameKey(a), nameKey(b)]),
);
export const sameName = (a, b) => {
  const x = nameKey(a);
  const y = nameKey(b);
  return x === y || ALIASES.get(x) === y || ALIASES.get(y) === x;
};

/**
 * Compare the fixture to ours. `ours` gives, for an ISO day:
 *   dafYomi(iso) → [name, daf] | null
 *   mishnaYomi(iso) → [[name, "c:m"], [name, "c:m"]] | null
 *   rambam(iso, 1 | 3) → { units: [[name, span, intro]] } | null   (span: "3", "4-5", "1-21")
 * Returns, per cycle, the days compared and the differences (each with
 * both sides), and for Rambam whether each difference falls on a day of
 * the introduction.
 */
export function compareLearning(fixture, ours) {
  const out = {};
  if (fixture.dafYomi) {
    const diffs = [];
    for (const [iso, name, blatt] of fixture.dafYomi) {
      const o = ours.dafYomi(iso);
      if (!o || !sameName(o[0], name) || o[1] !== blatt) diffs.push({ iso, theirs: [name, blatt], ours: o });
    }
    out.dafYomi = { days: fixture.dafYomi.length, diffs };
  }
  if (fixture.mishnaYomi) {
    const diffs = [];
    for (const [iso, pair] of fixture.mishnaYomi) {
      const o = ours.mishnaYomi(iso);
      const same = o && o.length === pair.length && o.every(([n, v], i) => sameName(n, pair[i][0]) && v === pair[i][1]);
      if (!same) diffs.push({ iso, theirs: pair, ours: o });
    }
    out.mishnaYomi = { days: fixture.mishnaYomi.length, diffs };
  }
  for (const [key, per] of [["rambam1", 1], ["rambam3", 3]]) {
    if (!fixture[key]) continue;
    const diffs = [];
    for (const row of fixture[key]) {
      const iso = row[0];
      const theirs = per === 1 ? [[row[1], row[2]]] : row[1];
      const o = ours.rambam(iso, per);
      const same = o && o.units.length === theirs.length && o.units.every(([n, c], i) => sameName(n, theirs[i][0]) && String(c) === String(theirs[i][1]));
      if (!same) diffs.push({ iso, theirs, ours: o?.units ?? null, intro: !!o?.units.some((u) => u[2]) });
    }
    out[key] = { days: fixture[key].length, diffs, outsideIntro: diffs.filter((d) => !d.intro).length };
  }
  return out;
}

/** A short report: per cycle, days and differences, and the first few of each. */
export function learningReport(cmp, max = 5) {
  const lines = [];
  for (const [k, v] of Object.entries(cmp)) {
    lines.push(`${k}: ${v.days} days, ${v.diffs.length} differences${"outsideIntro" in v ? ` (${v.outsideIntro} outside the introduction)` : ""}`);
    for (const d of v.diffs.slice(0, max)) lines.push(`  ${d.iso}: theirs ${JSON.stringify(d.theirs)} ours ${JSON.stringify(d.ours)}`);
  }
  return lines.join("\n");
}
