/**
 * Docs page metadata (plan W13.D1, W13.D2): the Diátaxis type of every page
 * and the plan tasks a feature page documents — read from front matter,
 * checked by docs-audit, and turned into the "beta — not verified" banner.
 *
 *   type:  tutorial | how-to | reference | explanation        (every page)
 *   tasks: [W13.E4, 11.1]                                     (feature pages)
 *   untracked: "<why no plan task>"                           (a feature page that predates the plan)
 *
 * A tutorial must walk through numbered steps (an ordered list of at least
 * three steps). A Hebrew page has its English twin's type and tasks.
 * Feature pages are the pages under the feature sections (FEATURE_SECTIONS).
 *
 * The banner: a task whose `verified` level is below "browser" (unset, node,
 * built) is not verified by a person in a real browser yet; a page that
 * documents only such tasks says so at the top, in its own language.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const TYPES = ["tutorial", "how-to", "reference", "explanation"];
export const FEATURE_SECTIONS = ["editor", "workspace", "ai", "sync", "collab", "blocks", "plugins", "account"];
/** `verified` levels, lowest first. A page is verified from "browser" on. */
export const LEVELS = ["", "node", "built", "browser", "owner", "verified"];

/** Front matter of a Markdown file as { data, start, end } (end = offset after the closing ---), or null. */
export function frontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return null;
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    else v = v.replace(/^["']|["']$/g, "");
    data[kv[1]] = v;
  }
  return { data, raw: m[1], end: m[0].length };
}

/** Every .md / .mdx page under `dir`, as paths relative to it. */
export function pages(dir) {
  const out = [];
  const walk = (d) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.mdx?$/.test(n)) out.push(relative(dir, p));
    }
  };
  walk(dir);
  return out;
}

/** "he/editor/x.md" → "editor/x.md"; null for an English page. */
export const englishTwin = (rel) => (rel.startsWith("he/") ? rel.slice(3) : null);
export const isFeaturePage = (rel) => FEATURE_SECTIONS.includes((englishTwin(rel) ?? rel).split("/")[0]);

/** Numbered steps: at least three items of an ordered list (outside code blocks). */
export function hasNumberedSteps(body) {
  const text = body.replace(/```[\s\S]*?```/g, "");
  return (text.match(/^\s{0,3}\d{1,2}[.)]\s+\S/gm) ?? []).length >= 3;
}

/**
 * A first guess at a page's type, for pages that have none yet (the one-time
 * fill, scripts/docs-meta.mjs --fill). The audit never guesses: it only reads.
 */
export function guessType(rel, data, body) {
  const p = englishTwin(rel) ?? rel;
  const title = `${data.title ?? ""} ${data.description ?? ""}`.toLowerCase();
  if (/^tutorials\/|quickstart|welcome|first-steps|tutorial/.test(p) || /\btutorial\b/.test(title)) return hasNumberedSteps(body) ? "tutorial" : "how-to";
  if (/^contributing\/|^project\/(issue|pr)-triage|^self-hosting\//.test(p)) return "how-to";
  if (/(^|\/)adr\/|threat-model|architecture|explain|why-|^project\/(compare|roadmap|sustainability|pricing|community)|transparency|provenance|privacy-report|known-limit/.test(p) || /\b(why|how .* works|architecture|explained)\b/.test(title)) return "explanation";
  if (/shortcuts|reference|cli|api|syntax|formulas|glossary|matrix|limits|changelog|whats-new|budgets|checks|^plugins\/(sdk|api|permissions)|settings$|settings\.md|formats|keyboard|editing-keys/.test(p) || /\b(reference|every|all the|list of|table of)\b/.test(title)) return "reference";
  return "how-to";
}

/** Task ids named in a commit subject (as plan PR titles name them: in parentheses, or after "plan"; or "W12.F6:" leading). */
export function taskIdsIn(subject, known) {
  const out = [];
  const spots = [...String(subject).matchAll(/\(([^)]*)\)|\bplan\s+([\w. ,+&-]+)|^([A-Z]?\d+\.[A-Z]?\d+(?:\s*\+\s*[A-Z]?\d+)*):/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
  for (const spot of spots) for (const m of spot.matchAll(/\b(?:W\d+\.[A-Z]?\d+[a-z]?|R\d+\.\d+|\d+\.\d+(?:\.\d+)?)\b/g)) if (known.has(m[0]) && !out.includes(m[0])) out.push(m[0]);
  return out;
}

/** Every task of a plan.json by id (first occurrence). */
export function planTaskMap(plan) {
  const seen = new Map();
  const walk = (o) => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === "object") {
      if (typeof o.id === "string" && typeof o.title === "string" && "minutes" in o && !seen.has(o.id)) seen.set(o.id, o);
      Object.values(o).forEach(walk);
    }
  };
  walk(plan);
  return seen;
}

export const levelOf = (task) => Math.max(0, LEVELS.indexOf(String(task?.verified ?? "")));
/** Verified in a real browser (or by the owner) — the bar for a page without the beta banner. */
export const isBrowserVerified = (task) => levelOf(task) >= LEVELS.indexOf("browser");

const BANNER = {
  en: (ids) => `**Beta — not verified yet.** This page describes ${ids.length > 1 ? "features" : "a feature"} (${ids.join(", ")}) that passed the automated checks but has not been verified by a person in a real browser. It may change.`,
  he: (ids) => `**בטא — עוד לא אומת.** העמוד מתאר ${ids.length > 1 ? "יכולות" : "יכולת"} (⁦${ids.join(", ")}⁩) שעברו את הבדיקות האוטומטיות אבל עוד לא נבדקו בידי אדם בדפדפן אמיתי. ייתכנו שינויים.`,
};
/** The marker every banner starts with, so a tool can find (and the test can count) it. */
export const BANNER_MARK = "<!-- lumen:beta-banner -->";

/**
 * The banner for a page that documents `taskIds`, or null when every one of
 * them is verified in a browser (or the page names none). Unknown ids count
 * as unverified.
 */
export function bannerFor(taskIds, tasks, lang = "en") {
  const ids = (taskIds ?? []).filter(Boolean);
  if (!ids.length) return null;
  const pending = ids.filter((id) => !isBrowserVerified(tasks.get(id)));
  if (!pending.length) return null;
  return `${BANNER_MARK}\n:::caution\n${BANNER[lang === "he" ? "he" : "en"](pending)}\n:::\n`;
}

/** The page's body with the banner after its front matter (the docs site and the in-app help use this). */
export function withBanner(text, tasks, lang) {
  const fm = frontMatter(text);
  if (!fm || text.includes(BANNER_MARK)) return text;
  const b = bannerFor(Array.isArray(fm.data.tasks) ? fm.data.tasks : [], tasks, lang);
  return b ? `${text.slice(0, fm.end)}\n${b}${text.slice(fm.end)}` : text;
}

/**
 * The Diátaxis and task checks of docs-audit: one finding per problem.
 * `read(rel)` returns a page's text. `known` is the set of plan task ids.
 */
export function checkPages(rels, read, known) {
  const found = [];
  const meta = new Map();
  for (const rel of rels) {
    const text = read(rel);
    const fm = frontMatter(text);
    const data = fm?.data ?? {};
    meta.set(rel, data);
    const body = fm ? text.slice(fm.end) : text;
    if (!TYPES.includes(data.type)) found.push({ page: rel, problem: data.type ? `type "${data.type}" is not one of ${TYPES.join(", ")}` : "no Diátaxis type (type: tutorial | how-to | reference | explanation)" });
    else if (data.type === "tutorial" && !hasNumberedSteps(body)) found.push({ page: rel, problem: "a tutorial without numbered steps (an ordered list of at least three)" });
    if (isFeaturePage(rel)) {
      const tasks = Array.isArray(data.tasks) ? data.tasks : [];
      if (!tasks.length && !data.untracked) found.push({ page: rel, problem: "a feature page without a task id (tasks: [W…]) — or untracked: \"<why>\"" });
      for (const id of tasks) if (!known.has(id)) found.push({ page: rel, problem: `task ${id} is not in the plan` });
    }
  }
  for (const [rel, data] of meta) {
    const en = englishTwin(rel);
    if (!en || !meta.has(en)) continue;
    const twin = meta.get(en);
    if (data.type !== twin.type) found.push({ page: rel, problem: `type "${data.type}" differs from the English page's "${twin.type}"` });
    if (String(data.tasks ?? "") !== String(twin.tasks ?? "")) found.push({ page: rel, problem: "tasks differ from the English page's" });
  }
  return found;
}
