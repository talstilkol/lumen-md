/**
 * The recorded public RTL test (plan W13.H6): 12 Hebrew scenarios × 5 apps,
 * each cell a screen recording with the app's version and the date
 * (docs/rtl-benchmark.md is the script). The ledger is
 * launch/rtl-benchmark.json; the W11.H13 page shows only what was recorded,
 * every claim linked to its video, and `npm run docs:audit` fails until all
 * 60 cells are there.
 */

export const RTL_APPS = ["lumen", "obsidian", "notion", "bear", "apple-notes"] as const;
export type RtlApp = (typeof RTL_APPS)[number];

export const RTL_APP_NAMES: Record<RtlApp, string> = { lumen: "Lumen", obsidian: "Obsidian", notion: "Notion", bear: "Bear", "apple-notes": "Apple Notes" };

export const RTL_SCENARIOS: ReadonlyArray<{ id: string; en: string; he: string }> = [
  { id: "home-end-latin-start", en: "Home/End on a Hebrew line that starts with an English word", he: "Home/End בשורה עברית שמתחילה במילה באנגלית" },
  { id: "numbers-in-hebrew", en: "Numbers inside a Hebrew sentence", he: "מספרים בתוך משפט עברי" },
  { id: "paste-from-word", en: "Paste a Hebrew paragraph from Word", he: "הדבקת פסקה עברית מ-Word" },
  { id: "table", en: "A table with Hebrew and English cells", he: "טבלה עם תאים בעברית ובאנגלית" },
  { id: "list", en: "A numbered and a bulleted Hebrew list", he: "רשימה ממוספרת ורשימת תבליטים בעברית" },
  { id: "inline-code", en: "Inline code in a Hebrew line", he: "קוד בשורה בתוך שורה עברית" },
  { id: "link", en: "A link with a Hebrew label", he: "קישור עם תווית בעברית" },
  { id: "formula", en: "A formula in a Hebrew paragraph", he: "נוסחה בתוך פסקה עברית" },
  { id: "search-niqqud", en: "Search for a word that is written with niqqud", he: "חיפוש מילה שכתובה בניקוד" },
  { id: "export-pdf", en: "Export a Hebrew note to PDF", he: "ייצוא פתק עברי ל-PDF" },
  { id: "footnote", en: "A footnote in a Hebrew paragraph", he: "הערת שוליים בפסקה עברית" },
  { id: "callout", en: "A callout with a Hebrew title", he: "תיבת הדגשה (callout) עם כותרת בעברית" },
];

export interface RtlCell {
  scenario: string;
  app: RtlApp;
  /** The app's version as it shows it (About box). */
  version: string;
  /** The day of the recording, YYYY-MM-DD. */
  date: string;
  /** The recording, relative to docs/public (e.g. rtl-benchmark/table-obsidian-1.15.1-2026-11-20.mp4). */
  video: string;
  result: "pass" | "fail" | "partial";
  note?: string;
}

export interface RtlLedger {
  $comment?: string;
  cells: RtlCell[];
}

/** What is wrong with the ledger (every cell must name a known scenario and app, a version, a date and an existing video). */
export function rtlProblems(ledger: RtlLedger, videoExists: (path: string) => boolean): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const c of ledger.cells) {
    const at = `${c.scenario} × ${c.app}`;
    if (!RTL_SCENARIOS.some((s) => s.id === c.scenario)) problems.push(`${at}: unknown scenario`);
    if (!(RTL_APPS as readonly string[]).includes(c.app)) problems.push(`${at}: unknown app`);
    if (!c.version?.trim()) problems.push(`${at}: no version`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.date ?? "")) problems.push(`${at}: no date (YYYY-MM-DD)`);
    if (!c.video?.trim()) problems.push(`${at}: no video`);
    else if (!videoExists(c.video)) problems.push(`${at}: the video ${c.video} is not in docs/public`);
    if (!["pass", "fail", "partial"].includes(c.result)) problems.push(`${at}: result is pass, fail or partial`);
    if (seen.has(at)) problems.push(`${at}: recorded twice`);
    seen.add(at);
  }
  return problems;
}

/** The cells not recorded yet: "scenario × app". */
export function rtlMissing(ledger: RtlLedger): string[] {
  const have = new Set(ledger.cells.map((c) => `${c.scenario} × ${c.app}`));
  return RTL_SCENARIOS.flatMap((s) => RTL_APPS.map((a) => `${s.id} × ${a}`)).filter((k) => !have.has(k));
}

const RESULT = { en: { pass: "✓ works", fail: "✗ broken", partial: "◐ partly" }, he: { pass: "✓ עובד", fail: "✗ שבור", partial: "◐ חלקית" } };
const TEXT = {
  en: { title: "Recorded: 12 Hebrew scenarios in five apps", intro: "Each cell is a screen recording, with the app's version and the day it was made (the script: docs/rtl-benchmark.md). Only what was recorded is shown.", scenario: "Scenario", none: "No recordings yet." },
  he: { title: "מוקלט: 12 תרחישי עברית בחמש אפליקציות", intro: "כל תא הוא הקלטת מסך, עם גרסת האפליקציה והיום שבו הוקלט (התסריט: docs/rtl-benchmark.md). מוצג רק מה שהוקלט.", scenario: "תרחיש", none: "עדיין אין הקלטות." },
};

/** The section for the W11.H13 page: recorded cells only, each linked to its video. */
export function renderRtlSection(ledger: RtlLedger | null, lang: "en" | "he"): string[] {
  const t = TEXT[lang];
  const cells = ledger?.cells ?? [];
  const L = [`## ${t.title}`, "", t.intro, ""];
  const apps = RTL_APPS.filter((a) => cells.some((c) => c.app === a));
  const rows = RTL_SCENARIOS.filter((s) => cells.some((c) => c.scenario === s.id));
  if (!apps.length) return [...L, t.none, ""];
  L.push(`| ${t.scenario} | ${apps.map((a) => RTL_APP_NAMES[a]).join(" | ")} |`, `|---|${apps.map(() => "---").join("|")}|`);
  for (const s of rows) {
    const row = apps.map((a) => {
      const c = cells.find((x) => x.scenario === s.id && x.app === a);
      return c ? `[${RESULT[lang][c.result]}](/${c.video}) (${c.version}, ${c.date})` : "—";
    });
    L.push(`| ${s[lang]} | ${row.join(" | ")} |`);
  }
  L.push("");
  return L;
}
