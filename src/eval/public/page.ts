/**
 * The public page "Hebrew in notes, measured" (plan W11.H13), built from
 * eval/results only: every number on it is a committed result with the
 * command that reproduces it, and a competitor's cell shows a number only
 * when launch/hebrew-benchmark.json records a run of theirs with a source and
 * a date — otherwise "not tested". Generated in English and Hebrew by
 * `npm run eval:public -- page --write`; `check` fails when the page is out
 * of date or a claim lacks its source or date.
 */
import { renderRtlSection, type RtlLedger } from "./rtlBenchmark";
import type { PublicResult } from "./gate";
import { latestResults } from "./gate";

export interface Row {
  id: string;
  task: string;
  metric: string;
  en: string;
  he: string;
  /** How the value is shown: a share as a percentage, or a raw number. */
  format: "percent" | "number";
  /** Lower is better (WER, CER). */
  lower: boolean;
}

export const ROWS: readonly Row[] = [
  { id: "bidi", task: "unicode-bidi", metric: "characterTest", en: "Unicode bidi conformance (BidiCharacterTest rows)", he: "התאמה לתקן ה-bidi של Unicode (שורות BidiCharacterTest)", format: "percent", lower: false },
  { id: "wer-whatsapp", task: "asr-ivrit-eval-whatsapp", metric: "wer", en: "Dictation WER — ivrit.ai eval-whatsapp", he: "WER בהכתבה — ivrit.ai eval-whatsapp", format: "percent", lower: true },
  { id: "wer-d1", task: "asr-ivrit-eval-d1", metric: "wer", en: "Dictation WER — ivrit.ai eval-d1", he: "WER בהכתבה — ivrit.ai eval-d1", format: "percent", lower: true },
  { id: "wer-fleurs", task: "asr-fleurs-he", metric: "wer", en: "Dictation WER — FLEURS he_il", he: "WER בהכתבה — FLEURS he_il", format: "percent", lower: true },
  { id: "nikud", task: "nikud-nakdimon-test", metric: "wor", en: "Niqqud word accuracy — Nakdimon test set", he: "דיוק ניקוד למילה — סט המבחן של Nakdimon", format: "percent", lower: false },
  { id: "handwriting", task: "ocr-handwriting-ivrit", metric: "medianCer", en: "Handwriting median CER — ivrit.ai benchmark", he: "CER חציוני בכתב יד — המדד של ivrit.ai", format: "percent", lower: true },
];

export interface CompetitorClaim {
  product: string;
  row: string;
  value: number;
  /** Where the run and its output can be checked. */
  source: string;
  /** ISO date of the run. */
  date: string;
  /** The app's version that was measured. */
  version?: string;
}

export interface CompetitorData {
  competitors: string[];
  names: Record<string, { en: string; he: string }>;
  claims: CompetitorClaim[];
}

export function pageProblems(results: readonly PublicResult[], comp: CompetitorData): string[] {
  const out: string[] = [];
  for (const r of results) if (!r.command?.trim()) out.push(`${r.task} / ${r.model.id}: a number without a reproduction command`);
  for (const c of comp.claims) {
    if (!comp.competitors.includes(c.product)) out.push(`claim for unknown product "${c.product}"`);
    if (!ROWS.some((r) => r.id === c.row)) out.push(`claim for unknown row "${c.row}"`);
    if (!/^https:\/\//.test(c.source ?? "")) out.push(`${c.product} / ${c.row}: a claim without a source`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.date ?? "")) out.push(`${c.product} / ${c.row}: a claim without a date`);
    if (typeof c.value !== "number" || !Number.isFinite(c.value)) out.push(`${c.product} / ${c.row}: not a number`);
  }
  return out;
}

const T = {
  en: {
    title: "Hebrew in notes, measured",
    description: "Lumen on public Hebrew benchmarks — bidi, dictation, niqqud, handwriting — next to Obsidian, Notion and Apple Notes where they were measured too.",
    intro: "Every number here is measured on a public benchmark that anyone can download, and each comes with the command that reproduces it. The other apps get a number only where someone ran the same benchmark on them; otherwise their cell says “not tested”. Nothing is estimated.",
    capability: "Benchmark",
    notMeasured: "not measured yet",
    notTested: "not tested",
    how: "Generated from `eval/results/` and `launch/hebrew-benchmark.json` by `npm run eval:public -- page --write`. The benchmarks' manifests are in `eval/public/`.",
    reproduce: "Reproduce",
    lower: "lower is better",
    higher: "higher is better",
    compare: "The feature comparison: [Lumen, Obsidian, Notion and Google Docs](/project/compare/).",
  },
  he: {
    title: "עברית בפתקים, במדידה",
    description: "Lumen על מדדים ציבוריים לעברית — bidi, הכתבה, ניקוד, כתב יד — לצד Obsidian, ‏Notion ו-Apple Notes במקום שגם הם נמדדו.",
    intro: "כל מספר כאן נמדד על מדד ציבורי שכל אחד יכול להוריד, ולכל אחד הפקודה שמשחזרת אותו. האפליקציות האחרות מקבלות מספר רק במקום שמישהו הריץ עליהן את אותו מדד; אחרת כתוב ״לא נבדק״. שום דבר לא מוערך.",
    capability: "מדד",
    notMeasured: "עוד לא נמדד",
    notTested: "לא נבדק",
    how: "הדף נוצר מ-`eval/results/` ומ-`launch/hebrew-benchmark.json` באמצעות `npm run eval:public -- page --write`. המניפסטים של המדדים נמצאים ב-`eval/public/`.",
    reproduce: "שחזור",
    lower: "נמוך יותר עדיף",
    higher: "גבוה יותר עדיף",
    compare: "השוואת היכולות: [Lumen, ‏Obsidian, ‏Notion ו-Google Docs](/he/project/compare/).",
  },
} as const;

const fmt = (v: number, row: Row) => (row.format === "percent" ? `${(v * 100).toFixed(row.metric === "characterTest" ? 2 : 1)}%` : String(v));

export function renderBenchmarkPage(results: readonly PublicResult[], comp: CompetitorData, lang: "en" | "he", rtl?: RtlLedger | null): string {
  const t = T[lang];
  const latest = latestResults(results.filter((r) => r.synthetic === false));
  const L = ["---", `title: ${t.title}`, `description: ${t.description}`, "---", "", t.intro, ""];
  L.push(`| ${t.capability} | Lumen | ${comp.competitors.map((p) => comp.names[p][lang]).join(" | ")} |`, `|---|---|${comp.competitors.map(() => "---").join("|")}|`);
  const notes: string[] = [];
  for (const row of ROWS) {
    const mine = latest.filter((r) => r.task === row.task && typeof r.metrics[row.metric] === "number");
    const best = mine.sort((a, b) => (row.lower ? a.metrics[row.metric] - b.metrics[row.metric] : b.metrics[row.metric] - a.metrics[row.metric]))[0];
    let lumen: string = t.notMeasured;
    if (best) {
      notes.push(best.command);
      lumen = `${fmt(best.metrics[row.metric], row)} (${best.model.id}, ${best.date.slice(0, 10)}) [${notes.length}]`;
    }
    const cells = comp.competitors.map((p) => {
      const c = comp.claims.find((x) => x.product === p && x.row === row.id);
      return c ? `${fmt(c.value, row)} (<${c.source}>, ${c.date}${c.version ? `, ${c.version}` : ""})` : t.notTested;
    });
    L.push(`| ${row[lang]} (${row.lower ? t.lower : t.higher}) | ${lumen} | ${cells.join(" | ")} |`);
  }
  L.push("");
  if (notes.length) {
    L.push(`### ${t.reproduce}`, "");
    notes.forEach((c, i) => L.push(`${i + 1}. \`${c}\``));
    L.push("");
  }
  // W13.H6: the recorded RTL test, only what was recorded (launch/rtl-benchmark.json).
  if (rtl !== undefined) L.push(...renderRtlSection(rtl, lang));
  L.push(t.compare, "", t.how, "");
  return L.join("\n");
}
