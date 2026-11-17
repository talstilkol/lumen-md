#!/usr/bin/env node
/**
 * Scanning highlights from a printed page (plan W7.2), measured end to end on
 * this machine: the app's own detection (src/highlights/scan/detect.ts), its
 * passage grouping and clean-up (scan/text.ts, ai/ocr.ts cleanOcrText), and
 * Tesseract 5 on the app's models (public/tesseract/lang) reading only the
 * marked boxes — as ScanHighlights.readPage does with tesseract.js.
 *
 *   node scripts/eval/print-highlights/run.mjs make <dir>
 *       30 book pages (15 Hebrew, 15 English) rendered in Chromium with the
 *       repo's OFL reading fonts, marked with highlighter (yellow, green,
 *       pink, orange; translucent, multiplied over the ink) and pen
 *       underlines, then "photographed" with ImageMagick: a slight
 *       perspective, blur, sensor noise, uneven light and JPEG.
 *   node scripts/eval/print-highlights/run.mjs make <dir> --variant b
 *       The held-out pages: other spans, inks and pen styles (see pageOfB).
 *   node scripts/eval/print-highlights/run.mjs measure <dir> [--json out.json]
 *       Marks found (a gold mark counts when a passage of the same colour
 *       reads within CER 0.5 of it), colour right, CER over the marks found,
 *       passages that match nothing, seconds per page, requests sent (0:
 *       nothing here opens a socket).
 *
 * These are synthetic photographs, not phone photos: the owner's 30 real
 * pages (plan W7.2) remain the acceptance measurement.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const flag = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? dflt : process.argv[i + 1];
};

/* ─── The pages ─────────────────────────────────────────────────────── */

// Sentences written for this harness (no third-party text). [[y:…]] highlighter (y g p o), [[u:…]] pen underline.
const HE = [
  "הספרייה נפתחה בשמונה בבוקר, ו[[y:הקוראים הראשונים כבר חיכו בתור ליד הדלת]]. רובם באו בשביל העיתונים, מעטים בשביל הספרים הישנים שבקומה העליונה.",
  "בפרק השלישי המחבר טוען ש[[g:זיכרון אינו ארכיון אלא סיפור שאנחנו מספרים מחדש]] בכל פעם שאנחנו נזכרים. הטענה פשוטה, אבל ההשלכות שלה רחבות.",
  "המורה ביקשה מהתלמידים לכתוב חיבור קצר על עיר הולדתם. [[u:הכלל היחיד היה לא להשתמש במילה יפה]], וכך נאלצו לחפש מילים אחרות.",
  "הניסוי חזר על עצמו שלוש פעמים. [[p:בכל פעם התוצאה הייתה שונה במעט]], והחוקרים הבינו שהטמפרטורה בחדר משפיעה יותר משחשבו.",
  "בשולי העמוד נכתבה הערה בעיפרון: [[o:לבדוק את התאריך במקור]]. מישהו קרא את הספר לפני, ועצר בדיוק במקום שבו עצרתי גם אני.",
  "הדרך לכפר עוברת בין כרמים ומטעי זיתים. [[y:בחורף השביל הופך לבוץ]], ובקיץ האבק נכנס לכל מקום, אפילו לתוך הכיסים.",
  "לפי התוכנית, הגשר ייבנה בתוך שנתיים. [[u:אבל איש לא שאל את התושבים]] מה הם חושבים על הרעש ועל התנועה שתעבור ליד בתיהם.",
  "הסבתא שמרה את כל המכתבים בקופסת פח. [[g:על המכסה נכתב בכתב יד רועד: לא לזרוק]], ולכן איש מאיתנו לא העז לפתוח אותה.",
  "השיעור עסק בהבדל בין מידע לידע. [[p:מידע אפשר להעתיק, ידע צריך לבנות]], אמר המרצה, ורבים רשמו את המשפט במחברות.",
  "הרכבת האחרונה יוצאת בחצות. [[o:מי שמפספס אותה נשאר בתחנה עד הבוקר]], ולכן כולם ממהרים בדקות האחרונות של הערב.",
  "הסופר כתב כל בוקר שלושה עמודים, גם בימים שבהם לא היה לו מה לומר. [[y:הוא האמין שההרגל חשוב יותר מההשראה]].",
  "בטבלה שבנספח מופיעים נתוני הגשם של עשר השנים האחרונות. [[u:השנה היבשה ביותר הייתה גם החמה ביותר]], אך אין בכך הוכחה לקשר ביניהן.",
  "בשוק של יום שישי אפשר למצוא הכול: ירקות, ספרים משומשים וכלים ישנים. [[g:המוכרים מכירים את הקונים בשמם]] ושואלים על המשפחה.",
  "המכתב הגיע באיחור של חודש. [[p:הבול היה מארץ רחוקה והכתובת נכתבה פעמיים]], כאילו השולח לא היה בטוח שהיא נכונה.",
  "בסוף הספר יש רשימה של מילים שאינן מתורגמות. [[y:כל מילה כזאת היא חלון קטן לתרבות אחרת]], כתבה המתרגמת בהקדמה.",
];
const EN = [
  "The archive opened at nine, and [[y:the first readers were already waiting by the door]]. Most came for the newspapers; a few climbed to the old books upstairs.",
  "In the third chapter the author argues that [[g:memory is not an archive but a story we retell]] each time we remember. The claim is simple; its consequences are not.",
  "The teacher asked for a short essay about a home town. [[u:The only rule was never to use the word nice]], so everyone had to find other words.",
  "The experiment was repeated three times. [[p:Each run gave a slightly different result]], and the team realised the room temperature mattered more than they thought.",
  "In the margin someone had pencilled a note: [[o:check the date in the original]]. Another reader had stopped exactly where I stopped.",
  "The road to the village runs between vineyards and olive groves. [[y:In winter the path turns to mud]], and in summer the dust gets into every pocket.",
  "According to the plan, the bridge will be finished within two years. [[u:Nobody asked the people who live beside it]] what they think about the noise.",
  "Grandmother kept every letter in a tin box. [[g:On the lid, in a shaky hand, it said do not throw away]], so none of us dared to open it.",
  "The lecture was about the difference between information and knowledge. [[p:Information can be copied; knowledge has to be built]], the lecturer said.",
  "The last train leaves at midnight. [[o:Whoever misses it waits on the platform until morning]], which is why everyone hurries in the last minutes of the evening.",
  "The novelist wrote three pages every morning, even on days with nothing to say. [[y:He believed habit mattered more than inspiration]].",
  "The appendix lists rainfall for the last ten years. [[u:The driest year was also the hottest]], though that alone proves no link between them.",
  "At the Friday market you can find anything: vegetables, used books and old tools. [[g:The sellers know their customers by name]] and ask about their families.",
  "The letter arrived a month late. [[p:The stamp was from a distant country and the address was written twice]], as if the sender was not sure of it.",
  "At the end of the book is a list of words left untranslated. [[y:Every such word is a small window into another culture]], wrote the translator.",
];
const INKS = { y: "rgba(255, 230, 0, 0.55)", g: "rgba(120, 230, 100, 0.55)", p: "rgba(255, 110, 180, 0.5)", o: "rgba(255, 160, 40, 0.55)" };
const COLOR = { y: "yellow", g: "green", p: "pink", o: "orange", u: "pen" };

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
function pageOf(lang, i) {
  const src = lang === "he" ? HE : EN;
  // Each page: its own marked paragraph between two plain ones from the same set.
  const paras = [src[(i + 7) % 15].replace(/\[\[\w:([^\]]+)\]\]/g, "$1"), src[i], src[(i + 3) % 15].replace(/\[\[\w:([^\]]+)\]\]/g, "$1")];
  const gold = [];
  const html = paras
    .map((p) => `<p>${esc(p).replace(/\[\[(\w):([^\]]+)\]\]/g, (_m, k, t) => (gold.push({ text: t, color: COLOR[k] }), k === "u" ? `<span class="pen">${t}</span>` : `<mark style="background:${INKS[k]}">${t}</mark>`))}</p>`)
    .join("");
  return { id: `${lang}-page-${i + 1}`, lang, html, gold, number: 40 + i * 3 };
}

/**
 * Variant b (the held-out pages): the same sentences, other spans marked — the
 * first five words of the page's second paragraph's last sentence, and the
 * last four words of its first paragraph — in other inks and pen styles
 * (straight black or red ballpoint, a tighter wave), a smaller font and
 * tighter leading. Written before b was first measured.
 */
const PENS_B = ["solid #111", "solid #b3261e", "wavy #1d3f9a"];
function pageOfB(lang, i0, variant = "b") {
  // Variant c: the same recipe on other paragraphs and another order of pens (a second held-out draw).
  const i = variant === "c" ? (i0 + 7) % 15 : i0;
  const src = lang === "he" ? HE : EN;
  const plain = (t) => t.replace(/\[\[\w:([^\]]+)\]\]/g, "$1");
  const p1 = plain(src[(i + 5) % 15]);
  const p2 = plain(src[(i + 11) % 15]);
  const p3 = plain(src[(i + 2) % 15]);
  const gold = [];
  const kinds = ["y", "g", "p", "o", "u", "u"];
  const mark = (text, k) => {
    gold.push({ text, color: COLOR[k] });
    return k === "u" ? `<span class="pen" style="text-decoration: underline ${PENS_B[(variant === "c" ? i + 1 : i) % 3]}">${text}</span>` : `<mark style="background:${INKS[k]}">${text}</mark>`;
  };
  const w1 = p1.split(" ");
  const a = w1.slice(-4).join(" ").replace(/[.,]$/, "");
  const firstHtml = esc(p1.slice(0, p1.lastIndexOf(a))) + mark(esc(a), kinds[i % 6]) + esc(p1.slice(p1.lastIndexOf(a) + a.length));
  const sentences = p2.split(/(?<=[.:]) /);
  const last = sentences[sentences.length - 1];
  const b = last.split(" ").slice(0, 5).join(" ").replace(/[.,]$/, "");
  const at = p2.lastIndexOf(b);
  const secondHtml = esc(p2.slice(0, at)) + mark(esc(b), kinds[(i + 3) % 6]) + esc(p2.slice(at + b.length));
  return { id: `${lang}-page${variant}-${i0 + 1}`, lang, html: `<p>${firstHtml}</p><p>${secondHtml}</p><p>${esc(p3)}</p>`, gold, number: 112 + i * 2, variant };
}

export function pages(variant = "a") {
  const out = [];
  for (const lang of ["he", "en"]) for (let i = 0; i < 15; i++) out.push(variant === "b" || variant === "c" ? pageOfB(lang, i, variant) : pageOf(lang, i));
  return out;
}

const pageHtml = (p, font) => `<!doctype html><html lang="${p.lang}" dir="${p.lang === "he" ? "rtl" : "ltr"}"><meta charset="utf-8"><style>
@font-face { font-family: Book; src: url(${font}) format("woff2"); }
body { margin: 0; background: #f7f3ea; }
.page { width: 620px; padding: 56px 64px 40px; font: ${p.variant ? "17px/1.5" : "19px/1.7"} Book, serif; color: #1b1a17; }
mark { color: inherit; mix-blend-mode: multiply; padding: 0 1px; }
.pen { text-decoration: underline wavy #1d3f9a; text-decoration-thickness: 2px; text-underline-offset: ${p.variant ? 3 : 4}px; }
.num { text-align: center; font-size: 15px; margin-top: 36px; color: #444; }
</style><div class="page">${p.html}<div class="num">${p.number}</div></div></html>`;

async function make(dir) {
  const require = createRequire(join(ROOT, "package.json"));
  const { chromium } = require("playwright");
  mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 760, height: 1000 } });
  const p = await ctx.newPage();
  await p.route("**/*", (route) => route.abort());
  const fonts = { he: pathToFileURL(join(ROOT, "public/fonts/reading/david-libre-400.woff2")).href, en: pathToFileURL(join(ROOT, "public/fonts/reading/assistant.woff2")).href };
  const list = pages(flag("--variant", "a"));
  for (const [n, pg] of list.entries()) {
    await p.setContent(pageHtml(pg, fonts[pg.lang]), { waitUntil: "load" });
    await p.evaluate(() => document.fonts.ready);
    const flat = join(dir, `${pg.id}.flat.png`);
    await p.locator(".page").screenshot({ path: flat });
    // The "photograph": a few degrees of perspective, soft focus, noise, light falling off to one side, JPEG.
    const k = ((n + ({ a: 0, b: 2, c: 4 }[flag("--variant", "a")] ?? 0)) % 5) - 2;
    const [W, H] = spawnSync("identify", ["-format", "%w %h", flat], { encoding: "utf8" }).stdout.trim().split(" ").map(Number);
    const [X, Y] = [W - 1, H - 1];
    const r = spawnSync("convert", [flat, "-virtual-pixel", "edge", "-distort", "Perspective", `0,0 ${18 + k * 4},${10 - k * 2} ${X},0 ${X - 14 - k * 3},${16 + k * 2} 0,${Y} ${6 + k * 2},${Y - 8 + k} ${X},${Y} ${X - 4 + k},${Y - 18 - k}`,
      "-blur", "0x0.9", "(", "+clone", "-sparse-color", "Barycentric", `0,0 gray(${92 + k}%) %w,%h gray(${78 - k}%)`, ")", "-compose", "Multiply", "-composite",
      "-attenuate", "0.35", "+noise", "Gaussian", "-quality", "82", join(dir, `${pg.id}.jpg`)]);
    if (r.status !== 0) throw new Error(String(r.stderr));
  }
  await browser.close();
  writeFileSync(join(dir, "pages.json"), JSON.stringify(list.map(({ id, lang, gold, number }) => ({ id, lang, gold, number })), null, 1) + "\n");
  console.log(`print-highlights: ${list.length} photographed pages in ${dir}`);
}

/* ─── Measuring ─────────────────────────────────────────────────────── */

function lev(a, b) {
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
const norm = (s) => s.normalize("NFC").replace(/[֑-ׇ]/g, "").replace(/[“”"״]/g, '"').replace(/[‘’'׳]/g, "'").replace(/\s+/g, " ").trim();

async function measure(dir) {
  const { tsImport } = await import("tsx/esm/api");
  const D = await tsImport("../../../src/highlights/scan/detect.ts", import.meta.url);
  const T = await tsImport("../../../src/highlights/scan/text.ts", import.meta.url);
  const O = await tsImport("../../../src/ai/ocr.ts", import.meta.url);
  const tess = mkdtempSync(join(tmpdir(), "hl-tessdata-"));
  for (const l of ["heb", "eng"]) writeFileSync(join(tess, `${l}.traineddata`), gunzipSync(readFileSync(join(ROOT, `public/tesseract/lang/${l}.traineddata.gz`))));
  const work = mkdtempSync(join(tmpdir(), "hl-boxes-"));
  const list = JSON.parse(readFileSync(join(dir, "pages.json"), "utf8"));
  const rows = [];
  for (const pg of list) {
    const t0 = performance.now();
    const file = join(dir, `${pg.id}.jpg`);
    const [W, H] = spawnSync("identify", ["-format", "%w %h", file], { encoding: "utf8" }).stdout.trim().split(" ").map(Number);
    // ScanHighlights.readPage: detection on a copy at most 1400 wide, OCR on the full photo.
    const scale = Math.min(1, 1400 / W);
    const w = Math.round(W * scale);
    const h = Math.round(H * scale);
    const raw = spawnSync("convert", [file, "-resize", `${w}x${h}!`, "-alpha", "on", "rgba:-"], { maxBuffer: 1 << 28 }).stdout;
    const px = { width: w, height: h, data: new Uint8Array(raw) };
    const marks = D.detectMarks(px, { rtl: pg.lang === "he" });
    const texts = [];
    for (const m of marks) {
      const b = D.padBox(m.box, px);
      const box = { x: Math.round(b.x0 / scale), y: Math.round(b.y0 / scale), w: Math.round((b.x1 - b.x0) / scale), h: Math.round((b.y1 - b.y0) / scale) };
      const crop = join(work, "box.png");
      spawnSync("convert", [file, "-crop", `${box.w}x${box.h}+${box.x}+${box.y}`, "+repage", crop]);
      const r = spawnSync("tesseract", [crop, "stdout", "-l", "heb+eng", "--tessdata-dir", tess, "--oem", "1", "--psm", "6"], { encoding: "utf8" });
      texts.push(O.cleanOcrText(r.stdout ?? ""));
    }
    const passages = T.groupPassages(marks.map((m, i) => ({ text: texts[i] ?? "", color: m.color, box: m.box })));
    const used = new Set();
    for (const g of pg.gold) {
      let best = null;
      for (const [k, p] of passages.entries()) {
        const e = lev(norm(g.text), norm(p.text));
        const c = e / Math.max(1, norm(g.text).length);
        if (!best || c < best.cer) best = { k, cer: c, edits: e, color: p.color };
      }
      const found = !!best && best.cer <= 0.5;
      if (found) used.add(best.k);
      rows.push({ page: pg.id, lang: pg.lang, gold: g.text, color: g.color, found, colorRight: found && best.color === g.color, edits: found ? best.edits : null, length: norm(g.text).length, read: found ? passages[best.k].text : null });
    }
    rows.push({ page: pg.id, extra: passages.filter((_, k) => !used.has(k)).length, ms: performance.now() - t0 });
  }
  const marks = rows.filter((r) => r.gold);
  const per = (lang) => {
    const m = marks.filter((r) => r.lang === lang);
    const f = m.filter((r) => r.found);
    return { marks: m.length, found: f.length, colourRight: f.filter((r) => r.colorRight).length, cer: f.reduce((a, r) => a + r.edits, 0) / Math.max(1, f.reduce((a, r) => a + r.length, 0)) };
  };
  const pagesRows = rows.filter((r) => r.ms !== undefined);
  const report = { date: new Date().toISOString().slice(0, 10), pages: list.length, he: per("he"), en: per("en"), extraPassages: pagesRows.reduce((a, r) => a + r.extra, 0), secondsMean: pagesRows.reduce((a, r) => a + r.ms, 0) / pagesRows.length / 1000, networkRequests: 0, rows: marks };
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  for (const l of ["he", "en"]) console.log(`print-highlights ${l}: marks found ${report[l].found}/${report[l].marks} (${pct(report[l].found / report[l].marks)}; target ≥ 90%), colour right ${report[l].colourRight}/${report[l].found}, CER ${pct(report[l].cer)} (target ≤ 6%)`);
  console.log(`print-highlights: ${report.extraPassages} passages matched no mark; ${report.secondsMean.toFixed(2)} s a page (Tesseract CLI here, not a phone); 0 network requests`);
  const out = flag("--json");
  if (out) writeFileSync(out, JSON.stringify(report, null, 1) + "\n");
}

const [cmd, dir] = process.argv.slice(2);
if (cmd === "make" && dir) await make(dir);
else if (cmd === "measure" && dir) await measure(dir);
else {
  console.error("usage: run.mjs make <dir> | measure <dir> [--json out.json]");
  process.exit(2);
}
