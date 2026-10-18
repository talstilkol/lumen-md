#!/usr/bin/env node
/**
 * docs-sync (plan 0.18): the docs only describe what exists.
 *
 * 1. Every command-palette command the docs name (`⌘K → Name`, `⌘K → "Name"`,
 *    "Command: `Name`", "run **Name** from the command palette", "Command
 *    palette → **Name**") is the English label of a command that exists.
 * 2. Every `npm run <script>` the docs mention exists in the package.json
 *    the reader would run it from (the repo root, or docs/ for the docs site).
 * 3. README.md carries no hand-typed test or command counts — those go
 *    stale (it said 2196 tests and 992 in the same file). The CI badge says
 *    whether the tests pass.
 *
 * Exits 1 with one line per problem. Run: `npm run docs:sync`.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";


/** Every markdown file the docs site or the repo root publishes. */
function docFiles(ROOT) {
  const out = [join(ROOT, "README.md")];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.mdx?$/.test(name)) out.push(p);
    }
  };
  walk(join(ROOT, "docs/src/content/docs"));
  return out;
}

/** Normalise a label for comparison: case, quotes, emoji, the trailing "…". */
export function norm(s) {
  return s
    .normalize("NFC")
    .replace(/\p{Extended_Pictographic}️?/gu, "")
    .replace(/[“”"`*]/g, "")
    .replace(/(\.\.\.|…)\s*$/u, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * English UI strings, the `en` dictionary in src/i18n/index.ts, as a
 * matcher: a label with a placeholder ("Language: {label}") matches any
 * filling of it, including the docs' own "Language: …".
 */
export function englishStrings(src) {
  const exact = new Set();
  const patterns = [];
  for (const m of src.matchAll(/^\s*"[\w.:-]+":\s*"((?:[^"\\]|\\.)*)",?\s*$/gm)) {
    const value = norm(JSON.parse(`"${m[1]}"`));
    if (!/\{[^}]+\}/.test(value)) {
      exact.add(value);
      continue;
    }
    const body = value
      .split(/\{[^}]+\}/)
      .map((part) => part.replace(/[.*+?^$()|[\]\\]/g, "\\$&"))
      .join("\u0000")
      .replace(/\s*\u0000\s*/g, "\\s*.*?\\s*");
    patterns.push(new RegExp(`^${body}$`));
  }
  return { has: (name) => exact.has(name) || patterns.some((re) => re.test(name)) };
}

/**
 * The command names a doc line refers to (first path segment only: in
 * `⌘K → Research: Settings → SearXNG…` the command is "Research: Settings";
 * what follows is inside its dialog).
 */
export function commandMentions(line) {
  const out = [];
  const take = (s) => {
    const name = s.split(/\s+→\s+/)[0].trim();
    if (name) out.push(name);
  };
  // `⌘K → Name` or ⌘K → "Name" (inside or outside backticks)
  for (const m of line.matchAll(/⌘K`?\s*→\s*(?:\*\*([^*]+)\*\*|"([^"]+)"|`([^`]+)`|([^`"*()\n]+?)(?=`|\)|$|\.\s|,|;))/g)) take(m[1] ?? m[2] ?? m[3] ?? m[4]);
  // Command: `Name` (`⌘K`)
  for (const m of line.matchAll(/Command:\s*`([^`]+)`/g)) take(m[1]);
  // Command palette → **Name**
  for (const m of line.matchAll(/[Cc]ommand palette\s*→\s*\*\*([^*]+)\*\*/g)) take(m[1]);
  // run **Name** from the command palette / palette (…) and run **Name**
  if (/command palette/i.test(line)) for (const m of line.matchAll(/\brun \*\*([^*]+)\*\*/gi)) take(m[1]);
  // command palette ("Name")
  for (const m of line.matchAll(/command palette \("([^"]+)"\)/gi)) take(m[1]);
  return out;
}

/** `npm run <script>` mentions (backticked or in a code block line). */
export function npmRuns(line) {
  return [...line.matchAll(/npm run(?: -s)? ([a-z0-9:_-]+)/gi)].map((m) => m[1]);
}

/**
 * Hand-typed counts that go stale: "992 unit tests", "tests-2196 passing",
 * "e2e-33/33", "100+ commands", "638-key", "595 keys each", "20+ templates",
 * and measured percentages on a coverage line.
 */
export function staleCounts(line) {
  const out = [];
  const COUNT = /\b\d[\d,]*\+?(?:\s+|-)(?:unit |e2e |starter )?(?:tests?|test files|specs?|commands|keys?|templates)\b|\b(?:tests|e2e)-\d+/gi;
  for (const m of line.matchAll(COUNT)) out.push(m[0]);
  if (/coverage/i.test(line)) for (const m of line.matchAll(/\b\d+(?:\.\d+)?\s?%/g)) out.push(m[0]);
  return out;
}

function main() {
  const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const problems = [];
  const en = englishStrings(readFileSync(join(ROOT, "src/i18n/index.ts"), "utf8"));
  const scripts = {
    root: Object.keys(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts ?? {}),
    docs: Object.keys(JSON.parse(readFileSync(join(ROOT, "docs/package.json"), "utf8")).scripts ?? {}),
  };
  let commands = 0;
  for (const file of docFiles(ROOT)) {
    const rel = relative(ROOT, file);
    const lines = readFileSync(file, "utf8").split("\n");
    let fence = false;
    let cwdDocs = false; // a code block that starts with `cd docs`
    lines.forEach((line, i) => {
      const at = `${rel}:${i + 1}`;
      if (/^\s*```/.test(line)) {
        fence = !fence;
        cwdDocs = false;
        return;
      }
      if (fence && /^\s*cd docs\b/.test(line)) cwdDocs = true;
      if (!fence) {
        for (const name of commandMentions(line)) {
          commands++;
          if (!en.has(norm(name))) problems.push(`${at}: no command is labelled “${name}” (rename the doc or the command)`);
        }
      }
      for (const s of npmRuns(line)) {
        const inDocs = cwdDocs || rel.startsWith("docs/");
        const ok = scripts.root.includes(s) || (inDocs && scripts.docs.includes(s));
        if (!ok) problems.push(`${at}: \`npm run ${s}\` — no such script in ${inDocs ? "package.json or docs/package.json" : "package.json"}`);
      }
      if (rel === "README.md") for (const c of staleCounts(line)) problems.push(`${at}: hand-typed count “${c}” — let CI report it (badge) instead`);
    });
  }
  if (problems.length) {
    console.error(problems.join("\n"));
    console.error(`\n✗ docs-sync: ${problems.length} problem(s)`);
    process.exit(1);
  }
  process.stdout.write(`✓ docs-sync: ${commands} command mentions and every npm script exist; README has no hand-typed counts\n`);
}

if (import.meta.url.startsWith("file:") && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
