#!/usr/bin/env node
/**
 * The relay's transparency report (plan W11.S13, research R6.9), in the
 * shape Proton publishes: per half-year, the requests for user data that
 * were received, answered and rejected, by kind, and what the service could
 * hand over at all.
 *
 *   node scripts/privacy/transparency.mjs           write docs .../security/transparency.md (EN, HE)
 *   node scripts/privacy/transparency.mjs --check   exit 1 when a report is invalid, the pages are
 *                                                   out of date, or the newest report is older than
 *                                                   six months (+ a month to write it)
 *
 * The reports are security/transparency/<YYYY>-H<1|2>.json. One is added
 * every six months, even when every number is 0.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DIR = "security/transparency";
export const PAGES = { en: "docs/src/content/docs/security/transparency.md", he: "docs/src/content/docs/he/security/transparency.md" };
export const KINDS = ["government", "court", "foreign", "takedown"];
/** A report is due every six months; a month to write it. */
export const MAX_AGE_DAYS = 183 + 31;

const HALVES = { 1: ["01-01", "06-30"], 2: ["07-01", "12-31"] };

/** Problems with one report (its file name says its half-year). */
export function reportProblems(name, r) {
  const out = [];
  const m = /^(\d{4})-H([12])\.json$/.exec(name);
  if (!m) return [`${name}: name it <YYYY>-H1.json or <YYYY>-H2.json`];
  const [from, to] = HALVES[m[2]].map((d) => `${m[1]}-${d}`);
  if (r?.format !== "lumen-transparency/1") out.push(`${name}: format must be lumen-transparency/1`);
  if (r?.period?.from !== from || r?.period?.to !== to) out.push(`${name}: the period must be ${from} to ${to}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r?.published))) out.push(`${name}: published must be a date`);
  for (const k of KINDS) {
    const c = r?.requests?.[k];
    if (!c || ![c.received, c.answered, c.rejected].every((n) => Number.isInteger(n) && n >= 0)) out.push(`${name}: requests.${k} needs received, answered and rejected (whole numbers)`);
    else if (c.answered + c.rejected > c.received) out.push(`${name}: requests.${k}: answered + rejected is more than received`);
  }
  for (const lang of ["en", "he"]) {
    if (!r?.status?.[lang]?.trim()) out.push(`${name}: status.${lang} is missing`);
    if (!r?.couldHandOver?.[lang]?.trim()) out.push(`${name}: couldHandOver.${lang} is missing`);
  }
  return out;
}

/** The newest report is no older than MAX_AGE_DAYS after its period ended (or the period is still running). */
export function staleness(reports, now = new Date()) {
  const newest = [...reports].sort((a, b) => (a.name < b.name ? 1 : -1))[0];
  if (!newest) return ["no transparency report yet"];
  const ended = Date.parse(`${newest.report.period?.to}T23:59:59Z`);
  const days = (now.getTime() - ended) / 86_400_000;
  return days > MAX_AGE_DAYS ? [`the newest transparency report (${newest.name}) covers a period that ended ${Math.floor(days)} days ago: the next one is due`] : [];
}

const T = {
  en: {
    title: "Transparency report",
    description: "Every six months: the requests for user data the encrypted sync relay and the share server received, answered and rejected, and what they could hand over at all.",
    intro: "Like Proton's, every six months, including when every number is 0. Written from `security/transparency/` by `scripts/privacy/transparency.mjs`; a test fails when this page is out of date, or when a report is more than six months overdue.",
    cols: "| Request | Received | Answered | Rejected |",
    kinds: { government: "Government or police", court: "Court orders", foreign: "Foreign authorities", takedown: "Takedown or removal" },
    hand: "What could be handed over",
  },
  he: {
    title: "דוח שקיפות",
    description: "כל חצי שנה: בקשות למידע של משתמשים שממסר הסנכרון המוצפן ושרת השיתוף קיבלו, ענו עליהן ודחו, ומה הם יכולים למסור בכלל.",
    intro: "כמו אצל Proton: כל חצי שנה, גם כשכל המספרים הם 0. הדף נכתב מ-`security/transparency/` על ידי `scripts/privacy/transparency.mjs`; בדיקה נכשלת כשהדף לא מעודכן, או כשדוח מאחר ביותר מחצי שנה.",
    cols: "| בקשה | התקבלו | נענו | נדחו |",
    kinds: { government: "ממשלה או משטרה", court: "צווי בית משפט", foreign: "רשויות זרות", takedown: "הסרת תוכן" },
    hand: "מה אפשר למסור",
  },
};

export function renderTransparency(reports, lang) {
  const t = T[lang];
  const sorted = [...reports].sort((a, b) => (a.name < b.name ? 1 : -1));
  return [
    "---",
    `title: ${t.title}`,
    `description: ${t.description}`,
    "---",
    "",
    "<!-- Written by scripts/privacy/transparency.mjs from security/transparency/. Do not edit by hand. -->",
    "",
    t.intro,
    "",
    ...sorted.flatMap(({ report: r }) => [
      `## ${r.period.from} – ${r.period.to}`,
      "",
      r.status[lang],
      "",
      t.cols,
      "|---|---|---|---|",
      ...KINDS.map((k) => `| ${t.kinds[k]} | ${r.requests[k].received} | ${r.requests[k].answered} | ${r.requests[k].rejected} |`),
      "",
      `**${t.hand}:** ${r.couldHandOver[lang]}`,
      "",
    ]),
  ].join("\n");
}

export function readReports(root) {
  const dir = join(root, DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .sort()
    .map((name) => ({ name, report: JSON.parse(readFileSync(join(dir, name), "utf8")) }));
}

function main(argv) {
  const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const reports = readReports(root);
  const problems = reports.flatMap(({ name, report }) => reportProblems(name, report));
  if (argv.includes("--check")) {
    const i = argv.indexOf("--now");
    problems.push(...staleness(reports, i >= 0 ? new Date(argv[i + 1]) : new Date()));
    for (const [lang, p] of Object.entries(PAGES)) if (!existsSync(join(root, p)) || readFileSync(join(root, p), "utf8") !== renderTransparency(reports, lang)) problems.push(`${p} is out of date: run node scripts/privacy/transparency.mjs`);
    for (const p of problems) console.error(`✖ ${p}`);
    if (problems.length) return 1;
    console.log(`✓ transparency: ${reports.length} report(s), newest ${reports.at(-1)?.name}; both pages current`);
    return 0;
  }
  if (problems.length) {
    for (const p of problems) console.error(`✖ ${p}`);
    return 1;
  }
  for (const [lang, p] of Object.entries(PAGES)) writeFileSync(join(root, p), renderTransparency(reports, lang));
  console.log(`wrote ${Object.values(PAGES).join(", ")}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
