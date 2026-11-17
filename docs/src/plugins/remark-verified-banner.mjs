/**
 * "Only what's verified" (plan W13.D2): a docs page that documents plan
 * tasks (front matter `tasks:`) not yet verified by a person in a real
 * browser — `verified` below "browser" in plan/plan.json — opens with a
 * "Beta — not verified yet" notice, in the page's language. The plan is
 * read when the site builds, so the notice goes away by itself the day the
 * task is verified; nothing is written into the page.
 *
 * The rule and the words are scripts/lib/docsMeta.mjs (`bannerFor`), shared
 * with the audit and the tests.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bannerFor, frontMatter, planTaskMap } from "../../../scripts/lib/docsMeta.mjs";

const PLAN = fileURLToPath(new URL("../../../plan/plan.json", import.meta.url));
let cached = null;
function tasks(planPath) {
  if (!cached || cached.path !== planPath) cached = { path: planPath, map: planTaskMap(JSON.parse(readFileSync(planPath, "utf8"))) };
  return cached.map;
}

const isHebrew = (path) => /[\\/]content[\\/]docs[\\/]he[\\/]/.test(String(path ?? ""));
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The notice as the HTML of a Starlight caution aside (no client script, readable without CSS). */
export function bannerHtml(text, lang) {
  const body = esc(text.replace(/^<!--[^>]*-->\n:::caution\n|\n:::\n$/g, "")).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  const title = lang === "he" ? "בטא" : "Beta";
  return `<aside aria-label="${title}" class="starlight-aside starlight-aside--caution" data-lumen-beta=""><p class="starlight-aside__title">${title}</p><div class="starlight-aside__content"><p>${body}</p></div></aside>`;
}

/** The page's task ids, from Astro's parsed front matter or the raw file. */
function pageTasks(file) {
  const fm = file.data?.astro?.frontmatter;
  if (fm && Array.isArray(fm.tasks)) return fm.tasks.map(String);
  try {
    const raw = file.value ? String(file.value) : readFileSync(file.path, "utf8");
    const t = frontMatter(raw)?.data.tasks;
    return Array.isArray(t) ? t : [];
  } catch {
    return []; // why: no source to read (an in-memory page): no tasks, no notice
  }
}

export default function remarkVerifiedBanner(options = {}) {
  const planPath = options.plan ?? PLAN;
  return (tree, file) => {
    const ids = pageTasks(file);
    if (!ids.length) return;
    const lang = isHebrew(file.path ?? file.history?.[0]) ? "he" : "en";
    const text = bannerFor(ids, tasks(planPath), lang);
    if (!text) return;
    tree.children.unshift({ type: "html", value: bannerHtml(text, lang) });
  };
}
