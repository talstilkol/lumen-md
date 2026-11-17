#!/usr/bin/env node
/**
 * Docs page metadata (plan W13.D1, W13.D2) — see scripts/lib/docsMeta.mjs.
 *
 *   node scripts/docs-meta.mjs --check     the Diátaxis and task checks (docs-audit runs them too)
 *   node scripts/docs-meta.mjs --index     write the four hub pages (by type), English and Hebrew
 *   node scripts/docs-meta.mjs --fill      one-time: give every page without a type a first guess,
 *                                          and every feature page its tasks from the git history
 *                                          of the page (commit subjects naming a plan task);
 *                                          the Hebrew twin gets the English page's values
 *
 * --fill and --index write files; --check only reads (exit 1 on a problem).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TYPES, checkPages, englishTwin, frontMatter, guessType, isFeaturePage, pages, planTaskMap, taskIdsIn } from "./lib/docsMeta.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "docs/src/content/docs");
const read = (rel) => readFileSync(join(DOCS, rel), "utf8");

/** Pages the git history cannot map (the page and its code predate task ids in PR titles), mapped by hand. */
export const MANUAL_TASKS = {
  "editor/hebrew-keyboard.md": ["W2.8"],
  "editor/outline-mode.md": ["W2.13"],
  "editor/hebrew-typography.md": ["W2.9"],
  "editor/reading-views.md": ["W13.R8"],
  "editor/screen-reader-protocol.md": ["W11.Q6"],
  "editor/editing-keys.md": ["W13.E1", "W13.E2", "W13.E5"],
  "workspace/doctor.md": ["7.4"],
  "workspace/contacts.md": ["W12.F6"],
  "workspace/properties.md": ["4.9"],
  "workspace/typst-export.md": ["W12.F2"],
  "workspace/file-viewers.md": ["W12.F4"],
  "workspace/media-transcripts.md": ["W2.7"],
  "workspace/format-roundtrip.md": ["W1.2"],
  "workspace/epub-reader.md": ["W1.14"],
  "workspace/pdf-chat.md": ["6.8"],
  "workspace/ai-autofill.md": ["5.10"],
  "ai/autocomplete.md": ["4.5"],
  "ai/translation-review.md": ["9.4"],
  "ai/summarize.md": ["6.11"],
  "ai/authorship.md": ["5.9"],
  "ai/batch.md": ["5.8"],
  "sync/role-vaults.md": ["W6.22"],
  "blocks/sheet.md": ["W12.X1"],
  "blocks/citations.md": ["W2.16"],
  "plugins/sandbox.md": ["11.2"],
  "collab/persistent.md": ["3.6"],
  "sync/publish.md": ["9.3"],
};
/** Feature pages with no plan task at all: shipped before the plan (Plan D), said so in the page. */
export const UNTRACKED = {
  "editor/smart-insert.md": "shipped before the plan (release 9.4); no plan task covers it",
  "ai/cost.md": "shipped before the plan (Plan D: D3, D4); no plan task covers it",
  "account/sso.md": "shipped before the plan (the organization release); no plan task covers it",
  "account/organization.md": "shipped before the plan (the organization release); no plan task covers it",
  "account/sign-in.md": "shipped before the plan (the organization release); no plan task covers it",
  "plugins/signing.md": "shipped before the plan (plugin signing, release 9.4); no plan task covers it",
};

function setFront(text, values) {
  const fm = frontMatter(text);
  if (!fm) return text;
  let raw = fm.raw;
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) continue;
    // Ids are quoted: YAML would read 11.1 as a number.
    const line = `${k}: ${Array.isArray(v) ? `[${v.map((x) => JSON.stringify(x)).join(", ")}]` : JSON.stringify(v).replace(/^"([\w-]+)"$/, "$1")}`;
    raw = new RegExp(`^${k}:.*$`, "m").test(raw) ? raw.replace(new RegExp(`^${k}:.*$`, "m"), line) : `${raw}\n${line}`;
  }
  return `---\n${raw}\n---\n${text.slice(fm.end)}`;
}

/** Tasks about the docs themselves, never a feature page's task. */
const DOCS_PROCESS = new Set(["13.1", "13.2", "13.3", "W1.28", "W6.7", "W4.34", "W3.7"]);

/** docs/required-pages.json `tasks` (task → page), read the other way: the tasks it names for this page. */
function requiredFor(rel) {
  const req = JSON.parse(readFileSync(join(ROOT, "docs/required-pages.json"), "utf8")).tasks ?? {};
  const page = rel.replace(/\.mdx?$/, "");
  const ids = Object.entries(req).filter(([, p]) => (Array.isArray(p) ? p : [p]).includes(page)).map(([id]) => id);
  return ids.length ? ids : undefined;
}

function fill(known) {
  let changed = 0;
  const english = pages(DOCS).filter((r) => !englishTwin(r));
  for (const rel of english) {
    const text = read(rel);
    const fm = frontMatter(text);
    if (!fm) continue;
    const values = {};
    if (!TYPES.includes(fm.data.type)) values.type = guessType(rel, fm.data, text.slice(fm.end));
    if (isFeaturePage(rel) && !Array.isArray(fm.data.tasks) && !fm.data.untracked) {
      let ids = MANUAL_TASKS[rel] ?? requiredFor(rel) ?? (UNTRACKED[rel] ? [] : undefined);
      if (!ids) {
        const log = execFileSync("git", ["log", "--format=%s", "--", join("docs/src/content/docs", rel)], { cwd: ROOT, encoding: "utf8" });
        ids = [];
        // Not the docs-process tasks (13.1 "every task writes its page" and the like): they wrote pages, they are not features.
        for (const s of log.split("\n")) for (const id of taskIdsIn(s, known)) if (!ids.includes(id) && !DOCS_PROCESS.has(id)) ids.push(id);
        ids = ids.slice(0, 6);
      }
      if (ids.length) values.tasks = ids;
      else if (UNTRACKED[rel]) values.untracked = UNTRACKED[rel];
    }
    if (!Object.keys(values).length) continue;
    writeFileSync(join(DOCS, rel), setFront(text, values));
    changed++;
    const he = `he/${rel}`;
    if (existsSync(join(DOCS, he))) {
      writeFileSync(join(DOCS, he), setFront(read(he), values));
      changed++;
    }
  }
  return changed;
}

const HUB = {
  tutorial: { slug: "tutorials", en: ["Tutorials", "Learn Lumen step by step: short lessons you follow from start to finish."], he: ["מדריכים", "ללמוד את Lumen צעד אחר צעד: שיעורים קצרים שעוברים מההתחלה עד הסוף."] },
  "how-to": { slug: "how-to", en: ["How-to guides", "Recipes for one task each: what to do to get a result."], he: ["איך עושים", "מתכונים, משימה אחת בכל אחד: מה לעשות כדי להגיע לתוצאה."] },
  reference: { slug: "reference", en: ["Reference", "The facts: every key, setting, format, command and API, to look up."], he: ["עיון", "העובדות: כל מקש, הגדרה, פורמט, פקודה ו-API, לחיפוש מהיר."] },
  explanation: { slug: "explanation", en: ["Explanation", "Why Lumen works the way it does: the ideas, trade-offs and decisions."], he: ["הסבר", "למה Lumen עובד כפי שהוא עובד: הרעיונות, הפשרות וההחלטות."] },
};
/** Section folders as the sidebar names them. */
const SECTION = {
  "getting-started": ["Getting started", "צעדים ראשונים"], editor: ["Editor", "עורך"], workspace: ["Workspace", "סביבת עבודה"],
  ai: ["AI", "בינה מלאכותית"], sync: ["Sync and publishing", "סנכרון ופרסום"], collab: ["Collaboration", "עבודה משותפת"],
  blocks: ["Blocks", "בלוקים"], plugins: ["Plugins", "תוספים"], account: ["Account", "חשבון"], security: ["Security and privacy", "אבטחה ופרטיות"],
  "self-hosting": ["Self-hosting", "אירוח עצמי"], contributing: ["Contributing", "תרומה לפרויקט"], project: ["Project", "הפרויקט"], index: ["Home", "בית"],
};
export const HUB_SLUGS = Object.values(HUB).map((h) => `${h.slug}.md`);

function index() {
  // Section front pages (index) are reached from the sidebar's sections, not listed here.
  const all = pages(DOCS).filter((r) => !HUB_SLUGS.includes(englishTwin(r) ?? r) && !/(^|\/)index\.mdx?$/.test(r));
  for (const lang of ["en", "he"]) {
    for (const [type, hub] of Object.entries(HUB)) {
      const [title, description] = hub[lang];
      const rows = all
        .filter((r) => (lang === "he" ? !!englishTwin(r) : !englishTwin(r)))
        .map((r) => ({ r, d: frontMatter(read(r))?.data ?? {} }))
        .filter(({ d }) => d.type === type)
        .sort((a, b) => a.r.localeCompare(b.r));
      const bySection = new Map();
      for (const x of rows) {
        const sec = (englishTwin(x.r) ?? x.r).split("/")[0].replace(/\.mdx?$/, "");
        if (!bySection.has(sec)) bySection.set(sec, []);
        bySection.get(sec).push(x);
      }
      const link = (r) => `/${r.replace(/\.mdx?$/, "").replace(/(^|\/)index$/, "")}/`.replace(/\/\/$/, "/");
      let body = `---\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(description)}\ntype: reference\n---\n\n${description}\n`;
      body += lang === "he" ? `\n${rows.length} עמודים.\n` : `\n${rows.length} pages.\n`;
      for (const [sec, xs] of bySection) {
        body += `\n## ${(SECTION[sec] ?? [sec, sec])[lang === "he" ? 1 : 0]}\n\n`;
        for (const { r, d } of xs) body += `- [${d.title ?? r}](${link(r)})${d.description ? ` — ${d.description}` : ""}\n`;
      }
      const out = join(DOCS, lang === "he" ? "he" : "", `${hub.slug}.md`);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, body);
    }
  }
}

function main(argv) {
  const plan = JSON.parse(readFileSync(join(ROOT, "plan/plan.json"), "utf8"));
  const known = new Set(planTaskMap(plan).keys());
  if (argv.includes("--fill")) console.log(`docs-meta: filled ${fill(known)} page(s)`);
  if (argv.includes("--index")) {
    index();
    console.log("docs-meta: wrote the four hub pages (en, he)");
  }
  if (argv.includes("--check") || argv.length === 0) {
    const found = checkPages(pages(DOCS), read, known);
    for (const f of found) console.error(`${f.page}: ${f.problem}`);
    const n = pages(DOCS).length;
    if (found.length) console.error(`✗ docs-meta: ${found.length} problem(s) in ${n} pages`);
    else console.log(`✓ docs-meta: ${n} pages, every one typed (Diátaxis), every feature page tied to a task`);
    return found.length ? 1 : 0;
  }
  return 0;
}

if (import.meta.url.startsWith("file:") && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
