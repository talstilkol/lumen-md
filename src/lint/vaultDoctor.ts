/**
 * Vault Doctor — workspace-wide checks that need no AI (Plan D: D5).
 *
 * Pure: takes the notes' paths and texts, returns findings. Code fences
 * and inline code are ignored everywhere, so examples of `[[links]]` in
 * code don't count.
 *
 * Checks:
 *  - broken wiki links (`[[Note]]` with no such note and no such heading
 *    in the same note), with a "did you mean" when one note is close;
 *  - wiki links to a missing heading of an existing note;
 *  - broken relative Markdown links to `.md` files;
 *  - ambiguous names (two notes share a file name, so `[[name]]` picks one);
 *  - orphans (no other note links to them);
 *  - near-duplicate notes (MinHash over word 5-shingles, LSH banding);
 *  - images without alt text;
 *  - empty notes (nothing but front matter / whitespace).
 */
import GithubSlugger, { slug as headingSlug } from "github-slugger";
import { resolveWikiTarget, splitWikiTarget } from "../renderer/wikiLinks";

export type DoctorKind =
  | "broken-wiki-link"
  | "missing-heading"
  | "broken-md-link"
  | "ambiguous-name"
  | "orphan"
  | "near-duplicate"
  | "missing-alt"
  | "empty-note";

export interface DoctorFinding {
  kind: DoctorKind;
  path: string;
  /** 1-based line, when the finding is at a place in the note. */
  line?: number;
  /** The link target / image / other note involved. */
  detail?: string;
  /** A fix: the wiki target to use instead (broken links only). */
  suggestion?: string;
  /** near-duplicate: estimated Jaccard similarity (0–1). */
  similarity?: number;
}

export interface DoctorNote {
  path: string;
  text: string;
}

const isMd = (p: string) => /\.(md|markdown)$/i.test(p);
const baseName = (p: string) => (p.split("/").pop() ?? p).replace(/\.(md|markdown)$/i, "");
/** Notes that are entry points by convention: never orphans. */
const ENTRY_NAMES = new Set(["index", "readme", "home", "welcome", "start here", "vault doctor report"]);

/** Text with fenced code blocks and inline code blanked (same length, lines kept). */
/** Fenced code blocks blanked (same length, lines kept). A fence closes at a line of at least as many of the same character. */
function blankFences(text: string): string {
  const lines = text.split("\n");
  let open: { ch: string; len: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    // Fences may sit inside block quotes (`> `) and list items (`- `, `1. `,
    // or indented continuation): look past those container prefixes.
    // At the top level a fence may be indented at most 3 spaces (4+ is an
    // indented code block); inside a container its content offset applies.
    const raw = lines[i];
    const quoted = raw.replace(/^(?:[ \t]*>[ ]?)*/, "");
    const listed = quoted.replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/, "");
    const inContainer: boolean = quoted !== raw || listed !== quoted || /^ {2,}\S/.test(raw) && i > 0 && /^\s*([-*+]|\d+[.)])\s/.test(lines.slice(0, i).reverse().find((l) => l.trim()) ?? "");
    const m: RegExpExecArray | null = (inContainer ? /^[ \t]*(`{3,}|~{3,})(.*)$/ : /^ {0,3}(`{3,}|~{3,})(.*)$/).exec(listed);
    if (!open) {
      if (m && !(m[1][0] === "`" && m[2].includes("`"))) {
        open = { ch: m[1][0], len: m[1].length };
        lines[i] = " ".repeat(lines[i].length);
      }
      continue;
    }
    if (m && m[1][0] === open.ch && m[1].length >= open.len && !m[2].trim()) open = null;
    lines[i] = " ".repeat(lines[i].length);
  }
  return lines.join("\n");
}

/**
 * CommonMark code spans blanked: a run of N backticks opens a span that
 * ends at the next run of exactly N backticks (it may cross line endings;
 * a run with no matching closer is literal). Newlines are kept.
 */
function blankCodeSpans(text: string): string {
  const chars = text.split("");
  const runs: Array<{ at: number; len: number }> = [];
  for (let i = 0; i < text.length; ) {
    if (text[i] !== "`" || (i > 0 && text[i - 1] === "\\")) {
      i++;
      continue;
    }
    let j = i;
    while (text[j] === "`") j++;
    runs.push({ at: i, len: j - i });
    i = j;
  }
  for (let r = 0; r < runs.length; r++) {
    const open = runs[r];
    const close = runs.findIndex((x, k) => k > r && x.len === open.len);
    if (close === -1) continue;
    // A blank line ends a paragraph: a span never crosses it.
    const end = runs[close].at + runs[close].len;
    if (/\n[ \t]*\n/.test(text.slice(open.at, end))) continue;
    for (let k = open.at; k < end; k++) if (chars[k] !== "\n") chars[k] = " ";
    r = close;
  }
  return chars.join("");
}

/** Same-length blanking (newlines kept). */
const blank = (m: string) => m.replace(/[^\n]/g, " ");

/**
 * Indented code blocks (4+ spaces or a tab) that follow a blank line (or
 * start the note) and aren't list continuation — blanked line by line.
 */
function blankIndentedCode(text: string): string {
  const lines = text.split("\n");
  let inCode = false;
  let prevBlank = true;
  let inList = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const isBlank = !l.trim();
    const indented = /^( {4}|\t)/.test(l);
    if (/^ {0,3}([-*+]|\d+[.)])\s/.test(l)) inList = true;
    else if (!isBlank && !indented) inList = false;
    if (inCode) {
      if (isBlank || indented) {
        if (!isBlank) lines[i] = blank(l);
        prevBlank = isBlank;
        continue;
      }
      inCode = false;
    }
    if (indented && !isBlank && prevBlank && !inList) {
      inCode = true;
      lines[i] = blank(l);
    }
    prevBlank = isBlank;
  }
  return lines.join("\n");
}

export function stripCode(text: string): string {
  let out = blankFences(text);
  out = blankIndentedCode(out);
  // HTML comments are invisible: their links aren't links.
  // Raw HTML blocks whose content isn't Markdown.
  out = out.replace(/<(pre|script|style|textarea)\b[\s\S]*?(?:<\/\1>|$)/gi, blank);
  // An unterminated comment runs to the end of the note (CommonMark HTML block).
  out = out.replace(/<!--[\s\S]*?(?:-->|$)/g, blank);
  out = blankCodeSpans(out);
  return out;
}

const lineAt = (text: string, index: number) => text.slice(0, index).split("\n").length;

/** A heading's rendered text: inline Markdown (emphasis, code, links, images) reduced to its text. */
function headingText(md: string): string {
  return md
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_m, target: string, label?: string) => label ?? target)
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__|\*|_|~~)(.+?)\1/g, "$2")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function headingsOf(text: string): Set<string> {
  const out = new Set<string>();
  // Inline code in headings matters for the rendered text, so scan only
  // with fenced blocks blanked.
  // Headings inside block quotes render (with ids) too: drop the `>` prefixes.
  const fenced = blankFences(text)
    .replace(/<(pre|script|style|textarea)\b[\s\S]*?(?:<\/\1>|$)/gi, (m) => m.replace(/[^\n]/g, " "))
    .replace(/^(?:[ \t]*>[ ]?)+/gm, "");
  // In document order, with a stateful slugger: a repeated heading gets
  // `-1`, `-2`… like rehype-slug, so `[[Note#setup-1]]` resolves.
  const found: Array<{ at: number; raw: string }> = [];
  for (const m of fenced.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) found.push({ at: m.index ?? 0, raw: m[1] });
  // Setext headings: a text line underlined with === or --- (the line
  // above must be text, not a list item, quote or blank line).
  for (const m of fenced.matchAll(/^(?! {0,3}([-*+>]|\d+[.)])\s)( {0,3}\S[^\n]*)\n {0,3}(=+|-+)[ \t]*$/gm)) found.push({ at: m.index ?? 0, raw: m[2].trim() });
  const slugger = new GithubSlugger();
  for (const h of found.sort((a, b) => a.at - b.at)) {
    const rendered = headingText(h.raw);
    out.add(slugger.slug(rendered));
    out.add(headingSlug(rendered));
    out.add(rendered.toLowerCase());
  }
  return out;
}

const hasHeading = (hs: Set<string> | undefined, h: string) => !!hs && (hs.has(headingSlug(h)) || hs.has(h.trim().toLowerCase()));

function frontMatterless(text: string): string {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\s*/, "");
}

/** Levenshtein distance, capped (returns cap + 1 beyond it). */
function distance(a: string, b: string, cap = 3): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** The one note name close to `target` (normalized, then ≤ 2 edits), or undefined. */
function suggestFor(target: string, names: Map<string, string[]>): string | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, " ").trim();
  const want = norm(target);
  const exact = [...names.keys()].filter((n) => norm(n) === want);
  if (exact.length === 1) return exact[0];
  let best: string[] = [];
  let bestD = 3;
  for (const n of names.keys()) {
    const d = distance(norm(n), want, 2);
    if (d < bestD) {
      bestD = d;
      best = [n];
    } else if (d === bestD) best.push(n);
  }
  return bestD <= 2 && best.length === 1 ? best[0] : undefined;
}

/** A suggestion is only useful when `[[it]]` opens exactly one note. */
const unique = (name: string | undefined, names: Map<string, string[]>) => (name && names.get(name)?.length === 1 ? name : undefined);

/* ─── MinHash near-duplicates ───────────────────────────────────────── */

const HASHES = 64;
const BANDS = 16; // 16 bands × 4 rows: pairs with Jaccard ≳ 0.5 usually collide
const ROWS = HASHES / BANDS;

function fnv1a(s: string, seed: number): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function signature(words: string[]): Uint32Array | null {
  const SHINGLE = 5;
  if (words.length < SHINGLE + 10) return null; // too short to compare meaningfully
  const sig = new Uint32Array(HASHES).fill(0xffffffff);
  for (let i = 0; i + SHINGLE <= words.length; i++) {
    const sh = words.slice(i, i + SHINGLE).join(" ");
    for (let k = 0; k < HASHES; k++) {
      const h = fnv1a(sh, k * 0x9e3779b1);
      if (h < sig[k]) sig[k] = h;
    }
  }
  return sig;
}

function similarity(a: Uint32Array, b: Uint32Array): number {
  let same = 0;
  for (let k = 0; k < HASHES; k++) if (a[k] === b[k]) same++;
  return same / HASHES;
}

/* ─── The check ─────────────────────────────────────────────────────── */

export interface DoctorOptions {
  /** Minimum estimated similarity to report two notes as near-duplicates. */
  duplicateThreshold?: number;
}

export function runVaultDoctor(notes: readonly DoctorNote[], opts: DoctorOptions = {}): DoctorFinding[] {
  const threshold = opts.duplicateThreshold ?? 0.8;
  const md = notes.filter((n) => isMd(n.path));
  const paths = md.map((n) => n.path);
  // Grouped case-insensitively, like resolveWikiTarget; the key is the
  // first spelling seen (used for suggestions).
  const names = new Map<string, string[]>();
  const byLower = new Map<string, string>();
  for (const p of paths) {
    const b = baseName(p);
    const key = byLower.get(b.toLowerCase()) ?? b;
    byLower.set(b.toLowerCase(), key);
    names.set(key, [...(names.get(key) ?? []), p]);
  }
  const headings = new Map(md.map((n) => [n.path, headingsOf(n.text)]));
  const incoming = new Map<string, number>(paths.map((p) => [p, 0]));
  const findings: DoctorFinding[] = [];

  for (const note of md) {
    const text = stripCode(note.text);
    const dir = note.path.includes("/") ? note.path.slice(0, note.path.lastIndexOf("/") + 1) : "";

    // Wiki links: [[target]] / [[target|label]] (not ![[embeds]] of assets).
    // `[[x]]` inside a Markdown link's text (`[see [[x]]](url)`) is link text, not a wiki link.
    const linkTexts = [...text.matchAll(/\[((?:[^\[\]\n]|\[\[[^\]\n]*\]\])*)\]\([^)\n]*\)/g)].map((l) => [l.index ?? 0, (l.index ?? 0) + l[0].length]);
    for (const m of text.matchAll(/(!?)\[\[([^\]|\n]+)(?:\|[^\]\n]*)?\]\]/g)) {
      if (linkTexts.some(([a, b]) => (m.index ?? 0) > a && (m.index ?? 0) < b)) continue;
      const raw = m[2].trim();
      if (m[1] && !isMd(raw) && /\.\w+$/.test(raw)) continue; // embedded image / file
      const { note: target, heading } = splitWikiTarget(raw);
      const line = lineAt(note.text, m.index ?? 0);
      if (!target) {
        if (heading && !hasHeading(headings.get(note.path), heading)) {
          findings.push({ kind: "missing-heading", path: note.path, line, detail: raw });
        }
        continue;
      }
      // `[[Heading]]` to a heading in this same note wins over a note of
      // that name (the preview jumps in-page first).
      if (!heading && hasHeading(headings.get(note.path), target)) continue;
      const resolved = resolveWikiTarget(target, paths);
      if (resolved) {
        if (resolved !== note.path) incoming.set(resolved, (incoming.get(resolved) ?? 0) + 1);
        if (heading && !hasHeading(headings.get(resolved), heading)) {
          findings.push({ kind: "missing-heading", path: note.path, line, detail: raw });
        }
        continue;
      }
      const suggestion = unique(suggestFor(target, names), names);
      findings.push({ kind: "broken-wiki-link", path: note.path, line, detail: raw, ...(suggestion ? { suggestion } : {}) });
    }

    // Relative Markdown links to notes: inline [label](other.md#h) and
    // reference definitions `[id]: ./dir/x.md "title"`.
    const mdLinks = [
      // Destinations may hold one level of balanced parentheses: `Notes_(old).md`.
      ...text.matchAll(/(?<!!)\[[^\]\n]*\]\(\s*((?:[^()\s<>]|\([^()\s]*\))+\.(?:md|markdown))(?:#(?:[^()\s>]|\([^()\s]*\))*)?(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/gi),
      // `[label](<Name with spaces.md>)`: angle brackets allow spaces.
      ...text.matchAll(/(?<!!)\[[^\]\n]*\]\(\s*<([^>\n]+?\.(?:md|markdown))(?:#[^>\n]*)?>(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/gi),
      ...text.matchAll(/^[ \t]{0,3}\[[^\]\n]+\]:[ \t]*(?:<([^>\n]+?\.(?:md|markdown))(?:#[^>\n]*)?>|([^\s<>]+\.(?:md|markdown))(?:#\S*)?)(?:[ \t]+(?:"[^"]*"|'[^']*'|\([^)]*\)))?[ \t]*$/gim),
    ].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    for (const m of mdLinks) {
      const href = m[1] ?? m[2];
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("/")) continue; // absolute / external
      let decoded = href;
      try {
        decoded = decodeURIComponent(href);
      } catch {
        /* keep as written */
      }
      const parts: string[] = [];
      let escapes = false;
      for (const seg of (dir + decoded).split("/")) {
        if (seg === "" || seg === ".") continue;
        if (seg === "..") {
          // More `..` than folders: the link points outside the workspace.
          if (!parts.length) escapes = true;
          parts.pop();
        } else parts.push(seg);
      }
      const target = parts.join("/");
      // Relative links are file paths: case matters (OPFS / most servers).
      if (!escapes && paths.includes(target)) {
        const real = target;
        if (real !== note.path) incoming.set(real, (incoming.get(real) ?? 0) + 1);
      } else {
        findings.push({ kind: "broken-md-link", path: note.path, line: lineAt(note.text, m.index ?? 0), detail: href });
      }
    }

    // Images without alt text: ![](src) and <img> without alt.
    // Reference-style images with empty alt: `![][logo]` / `![ ][logo]`.
    for (const m of text.matchAll(/!\[\s*\]\[([^\]\n]+)\]/g)) {
      findings.push({ kind: "missing-alt", path: note.path, line: lineAt(note.text, m.index ?? 0), detail: `[${m[1]}]` });
    }
    for (const m of text.matchAll(/!\[\s*\]\(([^)\s]+)[^)]*\)/g)) {
      findings.push({ kind: "missing-alt", path: note.path, line: lineAt(note.text, m.index ?? 0), detail: m[1] });
    }
    for (const m of text.matchAll(/<img\b(?![^>]*\balt\s*=\s*(?:"[^"]*\S[^"]*"|'[^']*\S[^']*'|[^\s"'=<>`]+))[^>]*>/gi)) {
      findings.push({ kind: "missing-alt", path: note.path, line: lineAt(note.text, m.index ?? 0), detail: m[0].slice(0, 60) });
    }

    if (!frontMatterless(note.text).trim()) findings.push({ kind: "empty-note", path: note.path });
  }

  for (const [name, ps] of names) {
    if (ps.length > 1) for (const p of ps) findings.push({ kind: "ambiguous-name", path: p, detail: `${name} (${ps.length} notes)` });
  }

  for (const p of paths) {
    if ((incoming.get(p) ?? 0) === 0 && !ENTRY_NAMES.has(baseName(p).toLowerCase())) {
      findings.push({ kind: "orphan", path: p });
    }
  }

  // Near-duplicates via LSH: only notes sharing a band are compared.
  const sigs = md.map((n) => {
    const words = frontMatterless(stripCode(n.text)).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    return signature(words);
  });
  const buckets = new Map<string, number[]>();
  sigs.forEach((sig, i) => {
    if (!sig) return;
    for (let b = 0; b < BANDS; b++) {
      const key = `${b}:${Array.from(sig.subarray(b * ROWS, (b + 1) * ROWS)).join(",")}`;
      const list = buckets.get(key) ?? [];
      list.push(i);
      buckets.set(key, list);
    }
  });
  const seen = new Set<string>();
  for (const list of buckets.values()) {
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const [i, j] = [list[x], list[y]];
        const key = `${i}:${j}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const s = similarity(sigs[i]!, sigs[j]!);
        if (s >= threshold) {
          findings.push({ kind: "near-duplicate", path: md[i].path, detail: md[j].path, similarity: Math.round(s * 100) / 100 });
        }
      }
    }
  }

  return findings;
}

/** Apply suggested wiki-link fixes to one note's text: `[[Old]]` → `[[New]]` (labels and headings kept). */
export function applyLinkFixes(text: string, fixes: ReadonlyArray<{ from: string; to: string }>): string {
  if (!fixes.length) return text;
  const map = new Map(fixes.map((f) => [f.from.trim(), f.to]));
  const code = stripCode(text);
  let out = "";
  let last = 0;
  for (const m of code.matchAll(/\[\[([^\]|\n]+)(\|[^\]\n]*)?\]\]/g)) {
    const raw = m[1].trim();
    const { note, heading } = splitWikiTarget(raw);
    const to = map.get(raw) ?? map.get(note);
    if (!to) continue;
    const start = m.index ?? 0;
    const original = text.slice(start, start + m[0].length);
    const label = original.slice(2 + m[1].length, original.length - 2);
    out += text.slice(last, start) + `[[${to}${heading ? `#${heading}` : ""}${label}]]`;
    last = start + m[0].length;
  }
  return out + text.slice(last);
}

/* ─── Report ────────────────────────────────────────────────────────── */

const TITLES: Record<DoctorKind, string> = {
  "broken-wiki-link": "Broken wiki links",
  "missing-heading": "Links to a missing heading",
  "broken-md-link": "Broken Markdown links",
  "ambiguous-name": "Ambiguous note names",
  "near-duplicate": "Near-duplicate notes",
  "missing-alt": "Images without alt text",
  "empty-note": "Empty notes",
  orphan: "Orphan notes (nothing links to them)",
};
const ORDER: DoctorKind[] = [
  "broken-wiki-link",
  "missing-heading",
  "broken-md-link",
  "ambiguous-name",
  "near-duplicate",
  "missing-alt",
  "empty-note",
  "orphan",
];

/** Markdown report: one section per kind, wiki links to the notes. */
export function formatDoctorReport(findings: readonly DoctorFinding[], noteCount: number, now: Date = new Date()): string {
  const link = (p: string) => `[[${p.replace(/\.(md|markdown)$/i, "")}]]`;
  const esc = (s: string) => s.replace(/([`[\]|])/g, "\\$1");
  const lines = [
    "# Vault Doctor report",
    "",
    `Checked ${noteCount} notes on ${now.toISOString().slice(0, 10)}. ${findings.length ? `${findings.length} findings.` : "Nothing to fix."}`,
    "",
  ];
  const fixable = findings.filter((f) => f.kind === "broken-wiki-link" && f.suggestion).length;
  if (fixable) lines.push(`${fixable} broken links have a suggested fix. Run **Vault Doctor: Apply Suggested Link Fixes** to apply them.`, "");
  for (const kind of ORDER) {
    const group = findings.filter((f) => f.kind === kind);
    if (!group.length) continue;
    lines.push(`## ${TITLES[kind]} (${group.length})`, "");
    for (const f of group.slice(0, 200)) {
      const at = f.line ? ` (line ${f.line})` : "";
      if (kind === "near-duplicate") lines.push(`- ${link(f.path)} ≈ ${link(f.detail!)} — ${Math.round((f.similarity ?? 0) * 100)}% similar`);
      else if (kind === "broken-wiki-link")
        lines.push(`- ${link(f.path)}${at}: \`[[${esc(f.detail ?? "")}]]\`${f.suggestion ? ` → did you mean ${link(f.suggestion)}?` : ""}`);
      else if (f.detail) lines.push(`- ${link(f.path)}${at}: \`${esc(f.detail)}\``);
      else lines.push(`- ${link(f.path)}${at}`);
    }
    if (group.length > 200) lines.push(`- … and ${group.length - 200} more`);
    lines.push("");
  }
  return lines.join("\n");
}
