#!/usr/bin/env node
/**
 * The "Known issues" page (plan W13.D6), built from two sources:
 *   - GitHub issues labelled `known-issue` (read only, REST: gh api), each
 *     with the workaround its body gives under a "Workaround" / "עקיפה"
 *     heading or line;
 *   - eval/failures.md: the AI agents no measured model passes yet.
 * Writes docs/src/content/docs/project/known-issues.md and its Hebrew twin.
 *
 *   node scripts/known-issues.mjs                    fetch the issues, write both pages, keep a cache
 *   node scripts/known-issues.mjs --from <file.json> no network: the issues from a cached list
 *   node scripts/known-issues.mjs --check            fail when the pages differ from what the cache gives
 *
 * The cache (docs/src/data/known-issues.json) is what --check and the tests
 * read, so the page builds offline; the fetch refreshes it.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NOTHING_MEASURED } from "./lib/evalIngest.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const CACHE = "docs/src/data/known-issues.json";
export const PAGES = { en: "docs/src/content/docs/project/known-issues.md", he: "docs/src/content/docs/he/project/known-issues.md" };
export const LABEL = "known-issue";

/** The workaround an issue body gives: the text under a "Workaround" (or "עקיפה") heading or after such a label. */
export function workaroundOf(body) {
  const text = String(body ?? "").replace(/\r\n?/g, "\n");
  const m = /^(?:#{1,4}[ \t]*)?(?:\*\*)?(?:workaround|עקיפה|פתרון עוקף)(?:\*\*)?[ \t]*[:：]?[ \t]*(?:\*\*)?[ \t]*(.*)$/im.exec(text);
  if (!m) return null;
  let out = m[1].trim();
  if (!out) {
    const rest = text.slice(m.index + m[0].length).split("\n");
    const para = [];
    for (const l of rest) {
      if (/^#{1,4}\s/.test(l) || (!l.trim() && para.length)) break;
      if (l.trim()) para.push(l.trim());
    }
    out = para.join(" ");
  }
  return out || null;
}

/** Issues (GitHub REST rows) → the page's entries: open, labelled, not pull requests. */
export function issueEntries(rows) {
  return rows
    .filter((r) => !r.pull_request && r.state === "open" && (r.labels ?? []).some((l) => (typeof l === "string" ? l : l.name) === LABEL))
    .map((r) => ({ n: r.number, title: r.title, url: r.html_url, workaround: workaroundOf(r.body) }))
    .sort((a, b) => a.n - b.n);
}

/** eval/failures.md → the agents that no model passes yet. */
export function failureEntries(md) {
  const out = [];
  for (const m of String(md ?? "").matchAll(/^## (.+)\n+Threshold ([^\n]+)/gm)) out.push({ agent: m[1].trim(), threshold: m[2].trim().replace(/\.$/, "") });
  return out;
}

const T = {
  en: {
    title: "Known issues",
    description: "What does not work yet, and how to get around it — built from the issues labelled known-issue and the AI evaluation's failures.",
    intro: "This page is built from the [issues labelled `known-issue`](https://github.com/talstilkol/lumen-md/issues?q=is%3Aissue+is%3Aopen+label%3Aknown-issue) and from `eval/failures.md`. When an issue is fixed and closed, it leaves the page the next time it is built.",
    issues: "Open issues",
    none: "No open issue is labelled `known-issue` right now.",
    wa: "Workaround",
    noWa: "No workaround yet — follow the issue for news.",
    ai: "AI agents that no tested model passes yet",
    aiIntro: "For these agents no local model has passed the evaluation. They still run, but check what they suggest closely; a better model or prompt is being looked for.",
    aiNone: "Every AI agent that was measured has a model that passes.",
    aiUnmeasured: "No AI agent has been measured yet: eval/results/ holds no accepted real run. Until one is, no agent is known to pass; check what they suggest closely.",
    threshold: "needs",
  },
  he: {
    title: "בעיות ידועות",
    description: "מה עוד לא עובד, ואיך עוקפים את זה — נבנה מה-issues שמסומנים known-issue ומהכשלים בהערכת ה-AI.",
    intro: "העמוד נבנה מה-[issues שמסומנים `known-issue`](https://github.com/talstilkol/lumen-md/issues?q=is%3Aissue+is%3Aopen+label%3Aknown-issue) ומ-`eval/failures.md`. כש-issue מתוקן ונסגר, הוא יורד מהעמוד בבנייה הבאה.",
    issues: "בעיות פתוחות",
    none: "כרגע אין issue פתוח שמסומן `known-issue`.",
    wa: "עקיפה",
    noWa: "עוד אין עקיפה — עקבו אחרי ה-issue לעדכונים.",
    ai: "סוכני AI שאף מודל שנבדק עוד לא עובר",
    aiIntro: "לסוכנים האלה אף מודל מקומי עוד לא עבר את ההערכה. הם עדיין רצים, אבל כדאי לבדוק היטב את מה שהם מציעים; מחפשים מודל או הנחיה טובים יותר.",
    aiNone: "לכל סוכן AI שנמדד יש מודל שעובר.",
    aiUnmeasured: "עוד לא נמדד אף סוכן AI: ב-eval/results/ אין הרצה אמיתית שהתקבלה. עד שתהיה, לא ידוע על אף סוכן שהוא עובר; כדאי לבדוק היטב את מה שהם מציעים.",
    threshold: "סף",
  },
};

/** The page in one language. */
export function renderPage(lang, issues, failures, measured = true) {
  const t = T[lang];
  const lines = ["---", `title: ${JSON.stringify(t.title)}`, `description: ${JSON.stringify(t.description)}`, "type: reference", "---", "", "<!-- Generated by scripts/known-issues.mjs — do not edit by hand. -->", "", t.intro, "", `## ${t.issues}`, ""];
  if (!issues.length) lines.push(t.none, "");
  for (const i of issues) {
    lines.push(`### #${i.n} ${i.title.replace(/[<>]/g, "")}`, "", `[#${i.n}](${i.url})`, "", i.workaround ? `**${t.wa}:** ${i.workaround}` : t.noWa, "");
  }
  lines.push(`## ${t.ai}`, "");
  // Review 14 Low 5: with nothing measured, "every measured agent passes" is vacuously true and misleading.
  if (!measured) lines.push(t.aiUnmeasured, "");
  else if (!failures.length) lines.push(t.aiNone, "");
  else {
    lines.push(t.aiIntro, "");
    for (const f of failures) lines.push(`- \`${f.agent}\` — ${t.threshold} ${f.threshold}`);
    lines.push("");
  }
  return lines.join("\n");
}

function fetchIssues(repo) {
  const rows = [];
  for (let page = 1; page < 20; page++) {
    const part = JSON.parse(execFileSync("gh", ["api", `repos/${repo}/issues?labels=${LABEL}&state=open&per_page=100&page=${page}`], { encoding: "utf8" }));
    rows.push(...part);
    if (part.length < 100) break;
  }
  return rows.map((r) => ({ number: r.number, title: r.title, html_url: r.html_url, state: r.state, body: r.body, labels: (r.labels ?? []).map((l) => l.name ?? l), pull_request: r.pull_request ? true : undefined }));
}

export function build(rows, failuresMd) {
  const issues = issueEntries(rows);
  const failures = failureEntries(failuresMd);
  const measured = !String(failuresMd ?? "").includes(NOTHING_MEASURED) && String(failuresMd ?? "").trim() !== "";
  return { en: renderPage("en", issues, failures, measured), he: renderPage("he", issues, failures, measured) };
}

function main(argv) {
  const opt = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const failuresMd = existsSync(join(ROOT, "eval/failures.md")) ? readFileSync(join(ROOT, "eval/failures.md"), "utf8") : "";
  let rows;
  if (opt("--from")) rows = JSON.parse(readFileSync(opt("--from"), "utf8"));
  else if (argv.includes("--check")) rows = JSON.parse(readFileSync(join(ROOT, CACHE), "utf8"));
  else {
    rows = fetchIssues(opt("--repo") ?? "talstilkol/lumen-md");
    writeFileSync(join(ROOT, CACHE), JSON.stringify(rows, null, 2) + "\n");
  }
  const pages = build(rows, failuresMd);
  if (argv.includes("--check")) {
    const stale = Object.entries(PAGES).filter(([lang, p]) => !existsSync(join(ROOT, p)) || readFileSync(join(ROOT, p), "utf8") !== pages[lang]);
    if (stale.length) {
      console.error(`✗ known-issues: ${stale.map(([, p]) => p).join(", ")} out of date — run node scripts/known-issues.mjs`);
      return 1;
    }
    console.log("✓ known-issues: the page matches the cached issues and eval/failures.md");
    return 0;
  }
  for (const [lang, p] of Object.entries(PAGES)) writeFileSync(join(ROOT, p), pages[lang]);
  console.log(`known-issues: ${issueEntries(rows).length} issue(s), ${failureEntries(failuresMd).length} AI agent(s) → ${Object.values(PAGES).join(", ")}`);
  return 0;
}

if (import.meta.url.startsWith("file:") && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
