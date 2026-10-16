/**
 * Citation verifier (Plan D: D7): for each footnote that cites a web page,
 * check that the page is reachable and that the quoted passage really
 * appears in it. Works on any note, not only on research output.
 *
 * Footnote forms understood (one per definition line):
 *   [^1]: [Title](https://…) — “exact quote”
 *   [^2]: https://… "exact quote"
 *   [^3]: Some source, https://…            (no quote: reachability only)
 */
import { normaliseForMatch } from "../../edge-workers/research/extract";
import type { ExtractedPage } from "./client";

export interface Citation {
  id: string;
  url: string;
  title?: string;
  quote?: string;
  /** 1-based line of the definition. */
  line: number;
}

export type CitationStatus = "supported" | "approximate" | "quote-not-found" | "reachable" | "dead" | "unreachable";

export interface CitationCheck extends Citation {
  status: CitationStatus;
  /** HTTP status, error code or similarity, for the report. */
  detail?: string;
}

/** `[title](url)` with balanced parentheses in the URL (Wikipedia-style `Foo_(bar)`). */
function markdownLink(s: string): { title: string; url: string } | null {
  const m = /\[([^\]]*)\]\((https?:\/\/)/.exec(s);
  if (!m) return null;
  let i = (m.index ?? 0) + m[0].length;
  let depth = 0;
  const start = i - m[2].length;
  for (; i < s.length; i++) {
    const c = s[i];
    if (/\s/.test(c)) break;
    if (c === "(") depth++;
    else if (c === ")") {
      if (depth === 0) break;
      depth--;
    }
  }
  return { title: m[1], url: s.slice(start, i) };
}

/** A bare URL without an unbalanced trailing `)` (from surrounding prose). */
function trimUrl(u: string): string {
  let out = u;
  while (out.endsWith(")") && (out.match(/\(/g)?.length ?? 0) < (out.match(/\)/g)?.length ?? 0)) out = out.slice(0, -1);
  return out;
}

const QUOTE_RE = /[“"«„]([^”"»]{8,})[”"»]/;

/** Footnote definitions that cite an http(s) URL. Code is ignored. */
export function parseCitations(md: string): Citation[] {
  const out: Citation[] = [];
  let fence: string | null = null;
  md.split("\n").forEach((line, i) => {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      return;
    }
    if (fence) return;
    const m = /^\[\^([^\]\s]+)\]:\s*(.+)$/.exec(line);
    if (!m) return;
    const rest = m[2];
    const link = markdownLink(rest);
    const bare = /(https?:\/\/[^\s>\]"”]+)/.exec(rest);
    const url = link?.url ?? (bare ? trimUrl(bare[1]) : undefined);
    if (!url) return;
    const afterUrl = rest.slice(rest.indexOf(url) + url.length);
    const quote = QUOTE_RE.exec(afterUrl)?.[1]?.trim();
    out.push({ id: m[1], url: url.replace(/[.,;]+$/, ""), title: link?.title || undefined, quote, line: i + 1 });
  });
  return out;
}

const words = (s: string) => normaliseForMatch(s).match(/[\p{L}\p{N}]+/gu) ?? [];

/**
 * How much of `quote` appears in `page`: 1 for a verbatim (normalised)
 * match, else the best share of the quote's words found in order within a
 * window of the page (tolerates small edits, ellipses, punctuation).
 */
export function quoteCoverage(quote: string, page: string): number {
  const q = normaliseForMatch(quote).replace(/\.\.\.|…/g, " ");
  const p = normaliseForMatch(page);
  if (q && p.includes(q)) return 1;
  const qw = words(quote);
  if (qw.length < 3) return 0;
  const pw = words(page);
  const need = new Map<string, number>();
  for (const w of qw) need.set(w, (need.get(w) ?? 0) + 1);
  const win = Math.ceil(qw.length * 1.3);
  let best = 0;
  // Sliding window of page words; count multiset overlap with the quote.
  const have = new Map<string, number>();
  let overlap = 0;
  const add = (w: string, d: 1 | -1) => {
    const n = (have.get(w) ?? 0) + d;
    have.set(w, n);
    const cap = need.get(w) ?? 0;
    if (d === 1 && n <= cap) overlap++;
    if (d === -1 && n < cap) overlap--;
  };
  for (let i = 0; i < pw.length; i++) {
    add(pw[i], 1);
    if (i >= win) add(pw[i - win], -1);
    if (overlap > best) best = overlap;
    if (best === qw.length) break;
  }
  return best / qw.length;
}

export const APPROXIMATE_AT = 0.85;

/** Check every citation; `fetchPage` is the research client's extractPage (injected for tests). */
export async function verifyCitations(
  citations: readonly Citation[],
  fetchPage: (url: string) => Promise<ExtractedPage>,
  opts: { concurrency?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<CitationCheck[]> {
  const out: CitationCheck[] = new Array(citations.length);
  const pages = new Map<string, Promise<ExtractedPage>>();
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < citations.length) {
      const i = next++;
      const c = citations[i];
      let page = pages.get(c.url);
      if (!page) pages.set(c.url, (page = fetchPage(c.url)));
      const p = await page;
      let check: CitationCheck;
      if (p.error === "http-error") check = { ...c, status: "dead", detail: `HTTP ${p.status}` };
      else if (p.error || !p.text) check = { ...c, status: "unreachable", detail: p.error ?? "empty page" };
      else if (!c.quote) check = { ...c, status: "reachable" };
      else {
        const cov = quoteCoverage(c.quote, p.text);
        check =
          cov === 1
            ? { ...c, status: "supported" }
            : cov >= APPROXIMATE_AT
              ? { ...c, status: "approximate", detail: `${Math.round(cov * 100)}% of the words` }
              : { ...c, status: "quote-not-found", detail: `best match ${Math.round(cov * 100)}%` };
      }
      out[i] = check;
      opts.onProgress?.(++done, citations.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 4, citations.length) }, worker));
  return out;
}

const ICON: Record<CitationStatus, string> = {
  supported: "✅",
  approximate: "🟡",
  reachable: "🔗",
  "quote-not-found": "❌",
  dead: "💀",
  unreachable: "⚠️",
};
const LABEL: Record<CitationStatus, string> = {
  supported: "quote found",
  approximate: "quote found approximately",
  reachable: "page reachable (no quote to check)",
  "quote-not-found": "quote NOT found on the page",
  dead: "dead link",
  unreachable: "couldn't read the page",
};

/** Markdown report of a citation check. */
export function formatCitationReport(docName: string, checks: readonly CitationCheck[], now = new Date()): string {
  const count = (s: CitationStatus) => checks.filter((c) => c.status === s).length;
  const problems = count("quote-not-found") + count("dead") + count("unreachable");
  const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const lines = [
    `# Citation check — ${docName}`,
    "",
    `${checks.length} citations checked on ${now.toISOString().slice(0, 10)}: ${count("supported") + count("approximate")} quotes found, ${count("reachable")} reachable without a quote, **${problems} to look at**.`,
    "",
  ];
  if (!checks.length) {
    lines.push("No footnotes with web links found. Footnotes look like `[^1]: [Title](https://…) — “quoted passage”`.");
    return lines.join("\n");
  }
  lines.push("| | Footnote | Line | Source | Result |", "|---|---|---:|---|---|");
  const order: CitationStatus[] = ["quote-not-found", "dead", "unreachable", "approximate", "reachable", "supported"];
  for (const c of [...checks].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status))) {
    const src = `[${esc(c.title || new URL(c.url).hostname)}](${c.url})`;
    lines.push(`| ${ICON[c.status]} | \`[^${esc(c.id)}]\` | ${c.line} | ${src} | ${LABEL[c.status]}${c.detail ? ` (${esc(c.detail)})` : ""} |`);
  }
  return lines.join("\n");
}
