#!/usr/bin/env node
/**
 * Wave g6 lane L8 — the export checks that need a real office suite or
 * typesetter, in one command (plan W12.F3, W12.F2):
 *
 *   node scripts/mac-pack/L8-office-check.mjs [--odt] [--typst] [--out reports/mac-pack/L8/office-check.json]
 *
 * --odt    (W12.F3, "ODT opens in LibreOffice with the right direction"):
 *          10 Hebrew and mixed notes → the app's ODT writer (src/storage/exportOdt.ts)
 *          → LibreOffice opens and saves each one again (`soffice --headless
 *          --convert-to odt`) → for every paragraph and heading of the saved
 *          file, the writing mode its style resolves to must match the
 *          paragraph's first strong character (rl-tb for Hebrew, lr-tb for
 *          Latin), and a table whose cells are Hebrew must stay rl-tb.
 * --typst  (W12.F2, "10 Hebrew notes compile to PDF without an error, in the
 *          right order"): the same notes → the app's Typst writer
 *          (src/storage/exportTypst.ts) → `typst compile` → `pdftotext` → every
 *          paragraph's words must be found in the PDF's text, in order.
 *
 * Both by default. Needs LibreOffice (`soffice`) for --odt, and `typst` plus
 * poppler's `pdftotext` for --typst (macOS: brew install --cask libreoffice;
 * brew install typst poppler). The app's TypeScript is loaded through tsx (a
 * devDependency). Writes a JSON report (numbers and pass/fail only, the notes
 * are made up here). Exit 0 when every requested check passed, 1 when one
 * failed, 3 when a tool is missing.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const wantOdt = args.includes("--odt") || !args.includes("--typst");
const wantTypst = args.includes("--typst") || !args.includes("--odt");
const outFile = opt("--out", "reports/mac-pack/L8/office-check.json");

async function load(rel) {
  try {
    const { tsImport } = await import("tsx/esm/api");
    return await tsImport(rel, import.meta.url);
  } catch (e) {
    if (e?.code !== "ERR_MODULE_NOT_FOUND" && e?.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw e;
    return import(new URL(rel, import.meta.url).href);
  }
}

/** Ten notes: Hebrew prose, mixed paragraphs, an RTL table, lists, a quote, code, and one English control. */
export const NOTES = [
  "# סיכום הפגישה\n\nדנה פתחה את הפגישה בעשר בבוקר.\n\nהוחלט להעביר את התקציב לוועדה.",
  "# רשימת קניות\n\n- לחם מחיטה מלאה\n- חלב וגבינה\n- עגבניות ומלפפונים",
  "# טבלת ציונים\n\n| שם | ציון |\n|---|---|\n| דנה | תשעים |\n| יוסי | שמונים |",
  "# פסקה מעורבת\n\nהספרייה React משמשת לבניית ממשקים.\n\nThe next paragraph starts in English and stays left to right.",
  "# ציטוט\n\n> אם תרצו אין זו אגדה.\n\nכך כתב הרצל בספרו.",
  "# קוד\n\nהפקודה הבאה מריצה את הבדיקות:\n\n```sh\nnpm test\n```\n\nאחריה בודקים את התוצאה.",
  "# משימות\n\n1. לכתוב את הטיוטה\n2. לשלוח לעריכה\n3. לפרסם באתר",
  "# מספרים ותאריכים\n\nהפגישה נדחתה ל-12 במרץ 2026 בשעה 14:30.\n\nמחיר הכרטיס הוא 45 ש״ח.",
  "# כותרת משנה\n\n## חלק ראשון\n\nתוכן החלק הראשון.\n\n## חלק שני\n\nתוכן החלק השני.",
  "# English control\n\nThis note is entirely in English and must stay left to right.",
];

const HEBREW = /[֐-׿]/;
const LATIN = /[A-Za-z]/;
const firstStrong = (s) => {
  for (const ch of s) {
    if (HEBREW.test(ch)) return "rtl";
    if (LATIN.test(ch)) return "ltr";
  }
  return null;
};
const has = (cmd) => spawnSync(cmd, ["--version"], { encoding: "utf8" }).status === 0;
const unzipText = (file, entry) => spawnSync("unzip", ["-p", file, entry], { encoding: "utf8", maxBuffer: 64 << 20 }).stdout ?? "";
const decode = (s) => s.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** style name → { mode, parent } from every <style:style> in an ODF XML part. */
function styleTable(xml) {
  const t = new Map();
  for (const m of xml.matchAll(/<style:style\b([^>]*?)(\/>|>([\s\S]*?)<\/style:style>)/g)) {
    const name = /style:name="([^"]+)"/.exec(m[1])?.[1];
    if (!name) continue;
    const parent = /style:parent-style-name="([^"]+)"/.exec(m[1])?.[1] ?? null;
    const mode = /<style:(?:paragraph|table)-properties\b[^>]*style:writing-mode="([a-z-]+)"/.exec(m[3] ?? "")?.[1] ?? null;
    t.set(name, { mode, parent });
  }
  return t;
}
function modeOf(name, tables) {
  for (let n = name, hops = 0; n && hops < 20; hops++) {
    const s = tables.map((t) => t.get(n)).find(Boolean);
    if (!s) return null;
    if (s.mode && s.mode !== "page") return s.mode;
    n = s.parent;
  }
  return null;
}

/** Every paragraph / heading of a saved ODT: its text, the writing mode its style gives, and the tables' modes. */
export function odtDirections(contentXml, stylesXml) {
  const tables = [styleTable(contentXml), styleTable(stylesXml)];
  const body = contentXml.slice(contentXml.indexOf("<office:body"));
  const paragraphs = [];
  for (const m of body.matchAll(/<text:(p|h)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/text:\1>)/g)) {
    const text = decode(m[3] ?? "").trim();
    if (!text) continue;
    const style = /text:style-name="([^"]+)"/.exec(m[2])?.[1] ?? null;
    paragraphs.push({ text, want: firstStrong(text), mode: style ? modeOf(style, tables) : null });
  }
  const tablesOut = [];
  for (const m of body.matchAll(/<table:table\b([^>]*)>([\s\S]*?)<\/table:table>/g)) {
    const style = /table:style-name="([^"]+)"/.exec(m[1])?.[1] ?? null;
    const cells = decode(m[2]);
    tablesOut.push({ want: firstStrong(cells), mode: style ? modeOf(style, tables) : null });
  }
  return { paragraphs, tables: tablesOut };
}

const report = { generatedAt: new Date().toISOString(), notes: NOTES.length };
let failed = false;
let missing = false;
const work = mkdtempSync(join(tmpdir(), "lumen-office-check-"));

if (wantOdt) {
  if (!has("soffice")) {
    report.odt = { status: "tool-missing", need: "soffice (LibreOffice)" };
    missing = true;
  } else {
    const { markdownToOdtBytes } = await load("../../src/storage/exportOdt.ts");
    const dir = join(work, "odt");
    const saved = join(dir, "saved");
    mkdirSync(saved, { recursive: true });
    const files = [];
    for (const [i, md] of NOTES.entries()) {
      const f = join(dir, `note-${i + 1}.odt`);
      writeFileSync(f, await markdownToOdtBytes(md, { title: `note ${i + 1}` }));
      files.push(f);
    }
    // A private profile, so a running LibreOffice or the user's settings change nothing.
    const profile = `-env:UserInstallation=file://${join(work, "lo-profile")}`;
    const lo = spawnSync("soffice", [profile, "--headless", "--convert-to", "odt", "--outdir", saved, ...files], { encoding: "utf8", timeout: 300_000 });
    const per = [];
    for (const [i] of NOTES.entries()) {
      const f = join(saved, `note-${i + 1}.odt`);
      if (!existsSync(f)) {
        per.push({ note: i + 1, opened: false });
        continue;
      }
      const d = odtDirections(unzipText(f, "content.xml"), unzipText(f, "styles.xml"));
      const wrong = d.paragraphs.filter((p) => p.want && p.mode !== (p.want === "rtl" ? "rl-tb" : "lr-tb")).length;
      const wrongTables = d.tables.filter((t) => t.want === "rtl" && t.mode !== "rl-tb").length;
      per.push({ note: i + 1, opened: true, paragraphs: d.paragraphs.length, rtlParagraphs: d.paragraphs.filter((p) => p.want === "rtl").length, wrong, tables: d.tables.length, wrongTables });
    }
    const ok = per.filter((p) => p.opened && p.wrong === 0 && p.wrongTables === 0).length;
    report.odt = {
      status: ok === NOTES.length ? "pass" : "fail",
      libreoffice: spawnSync("soffice", ["--version"], { encoding: "utf8" }).stdout.trim(),
      exit: lo.status,
      opened: per.filter((p) => p.opened).length,
      ok,
      paragraphs: per.reduce((n, p) => n + (p.paragraphs ?? 0), 0),
      wrongParagraphs: per.reduce((n, p) => n + (p.wrong ?? 0), 0),
      rtlTables: per.reduce((n, p) => n + (p.tables ?? 0), 0),
      wrongTables: per.reduce((n, p) => n + (p.wrongTables ?? 0), 0),
      perNote: per,
    };
    if (report.odt.status !== "pass") failed = true;
  }
}

if (wantTypst) {
  if (!has("typst") || spawnSync("pdftotext", ["-v"], { encoding: "utf8" }).error) {
    report.typst = { status: "tool-missing", need: "typst and pdftotext (poppler)" };
    missing = true;
  } else {
    const { markdownToTypst } = await load("../../src/storage/exportTypst.ts");
    const dir = join(work, "typst");
    mkdirSync(dir, { recursive: true });
    const per = [];
    for (const [i, md] of NOTES.entries()) {
      const typ = join(dir, `note-${i + 1}.typ`);
      const pdf = join(dir, `note-${i + 1}.pdf`);
      writeFileSync(typ, markdownToTypst(md, { title: `note ${i + 1}` }));
      const c = spawnSync("typst", ["compile", typ, pdf], { encoding: "utf8", timeout: 120_000 });
      if (c.status !== 0) {
        per.push({ note: i + 1, compiled: false, error: (c.stderr || "").split("\n")[0].slice(0, 200) });
        continue;
      }
      const text = (spawnSync("pdftotext", ["-enc", "UTF-8", pdf, "-"], { encoding: "utf8" }).stdout ?? "").normalize("NFC").replace(/\s+/g, " ");
      // Every prose line's words, in order: a reversed or scrambled line fails.
      const lines = md.split("\n").map((l) => l.replace(/^(#+|>|-|\d+\.)\s*/, "").replace(/[|*`]/g, " ").trim()).filter((l) => l && !/^-+$|^```/.test(l) && !/^[\s|-]+$/.test(l));
      let inOrder = 0;
      for (const l of lines) {
        const words = l.split(/\s+/).filter((w) => w.length > 1);
        let at = 0;
        const okLine = words.every((w) => {
          const k = text.indexOf(w, at);
          if (k < 0) return false;
          at = k + w.length;
          return true;
        });
        if (okLine) inOrder++;
      }
      per.push({ note: i + 1, compiled: true, lines: lines.length, inOrder });
    }
    const ok = per.filter((p) => p.compiled && p.inOrder === p.lines).length;
    report.typst = { status: ok === NOTES.length ? "pass" : "fail", typst: spawnSync("typst", ["--version"], { encoding: "utf8" }).stdout.trim(), compiled: per.filter((p) => p.compiled).length, ok, perNote: per };
    if (report.typst.status !== "pass") failed = true;
  }
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ odt: report.odt && { status: report.odt.status, ok: report.odt.ok, wrongParagraphs: report.odt.wrongParagraphs, wrongTables: report.odt.wrongTables }, typst: report.typst && { status: report.typst.status, ok: report.typst.ok } }, null, 2));
process.exit(failed ? 1 : missing ? 3 : 0);
