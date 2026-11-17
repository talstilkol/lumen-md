/**
 * Round-trip measurement for the text formats that already have both an
 * importer (markupFormats.ts) and an exporter (exportFormats.ts) — plan W12.F1.
 *
 * For every format X: Markdown → X → Markdown, then both sides are parsed with
 * remark-parse (CommonMark) and compared as trees, positions dropped and runs
 * of whitespace in text collapsed. An example "survives" when the two trees are
 * equal. Nothing here changes a converter; this module only measures them, so
 * the docs can say honestly what each format keeps and loses.
 *
 * Corpus: the 652 examples of the CommonMark 0.31.2 spec (public, CC-BY-SA 4.0,
 * vendored at src/__tests__/fixtures/md-spec/) grouped by the spec section that
 * names their element type, plus sections of the repository's own Hebrew docs.
 */
import { unified } from "unified";
import remarkParse from "remark-parse";
import {
  markdownToAdoc,
  markdownToIpynb,
  markdownToLatex,
  markdownToOpml,
  markdownToOrg,
  markdownToRst,
} from "./exportFormats";
import {
  adocToMarkdown,
  ipynbToMarkdown,
  latexToMarkdown,
  opmlToMarkdown,
  orgToMarkdown,
  rstToMarkdown,
} from "./markupFormats";

export type RoundTripFormat = "org" | "adoc" | "latex" | "opml" | "rst" | "ipynb";

export const ROUND_TRIP_FORMATS: readonly RoundTripFormat[] = ["org", "adoc", "latex", "opml", "rst", "ipynb"];

const OPML_TITLE = "Outline";

/** Markdown → X → Markdown with the app's own converters. */
export function roundTrip(format: RoundTripFormat, md: string): string {
  switch (format) {
    case "org":
      return orgToMarkdown(markdownToOrg(md));
    case "adoc":
      return adocToMarkdown(markdownToAdoc(md));
    case "latex":
      return latexToMarkdown(markdownToLatex(md));
    case "rst":
      return rstToMarkdown(markdownToRst(md));
    case "ipynb":
      return ipynbToMarkdown(markdownToIpynb(md));
    case "opml": {
      // OPML keeps the title in <head>; the importer turns it back into an H1.
      // That H1 is the format's envelope, not content, so it is removed here.
      const back = opmlToMarkdown(markdownToOpml(md, OPML_TITLE));
      return back.replace(new RegExp(`^# ${OPML_TITLE}\\n\\n?`), "");
    }
  }
}

export interface SpecExample {
  /** 1-based number, as in the spec's HTML edition. */
  number: number;
  /** The spec section (element type) the example belongs to, e.g. "Block quotes". */
  section: string;
  markdown: string;
}

const FENCE = "````````````````````````````````";

/**
 * The examples of a CommonMark spec.txt, in the spec's own format: a line of 32
 * backticks plus " example", the Markdown, a line with ".", the HTML, and the
 * closing 32 backticks. "→" stands for a tab, as in the spec's test runner.
 * The section is the nearest heading above the example (levels 1–3).
 */
export function extractSpecExamples(spec: string): SpecExample[] {
  const lines = spec.replace(/\r\n?/g, "\n").split("\n");
  const out: SpecExample[] = [];
  let section = "";
  let inExample = false;
  let inMarkdown = false;
  let buf: string[] = [];
  for (const line of lines) {
    if (!inExample) {
      if (line.startsWith(`${FENCE} example`)) {
        inExample = true;
        inMarkdown = true;
        buf = [];
        continue;
      }
      const h = /^(#{1,3}) +(.+?)\s*$/.exec(line);
      if (h) section = h[2];
      continue;
    }
    if (line === FENCE) {
      inExample = false;
      continue;
    }
    if (inMarkdown && line === ".") {
      out.push({ number: out.length + 1, section, markdown: buf.join("\n").replace(/→/g, "\t") + "\n" });
      inMarkdown = false;
      continue;
    }
    if (inMarkdown) buf.push(line);
  }
  return out;
}

type Tree = { type: string; children?: Tree[]; value?: string; [k: string]: unknown };

function strip(node: Tree): Tree {
  const out: Tree = { type: node.type };
  for (const [k, v] of Object.entries(node)) {
    if (k === "position" || k === "type") continue;
    if (k === "children" && Array.isArray(v)) out.children = (v as Tree[]).map(strip);
    else if (k === "value" && typeof v === "string") out.value = node.type === "code" ? v.replace(/\s+$/, "") : v.replace(/\s+/g, " ").trim();
    else out[k] = v;
  }
  return out;
}

const parser = unified().use(remarkParse);

/** A CommonMark tree of the Markdown, as a canonical string (no positions). */
export function normalizedTree(md: string): string {
  return JSON.stringify(strip(parser.parse(md) as unknown as Tree));
}

export function survives(format: RoundTripFormat, md: string): boolean {
  let back: string;
  try {
    back = roundTrip(format, md);
  } catch {
    return false;
  }
  return normalizedTree(md) === normalizedTree(back);
}

export interface Bucket {
  total: number;
  same: number;
  /** Percent, one decimal. */
  pct: number;
}

export interface FormatReport {
  format: RoundTripFormat;
  overall: Bucket;
  /** By spec section (element type), plus "Hebrew notes". */
  bySection: Record<string, Bucket>;
  /** Spec example numbers that did not survive (for the report). */
  failedExamples: number[];
}

const pct = (same: number, total: number): number => (total ? Math.round((1000 * same) / total) / 10 : 0);

export interface CorpusItem {
  section: string;
  markdown: string;
  /** Spec example number, when the item is one. */
  number?: number;
}

export function measureFormat(format: RoundTripFormat, corpus: readonly CorpusItem[]): FormatReport {
  const bySection: Record<string, { total: number; same: number }> = {};
  const failed: number[] = [];
  let same = 0;
  for (const item of corpus) {
    const ok = survives(format, item.markdown);
    const b = (bySection[item.section] ??= { total: 0, same: 0 });
    b.total++;
    if (ok) {
      b.same++;
      same++;
    } else if (item.number) failed.push(item.number);
  }
  const sections: Record<string, Bucket> = {};
  for (const [k, v] of Object.entries(bySection)) sections[k] = { ...v, pct: pct(v.same, v.total) };
  return {
    format,
    overall: { total: corpus.length, same, pct: pct(same, corpus.length) },
    bySection: sections,
    failedExamples: failed,
  };
}

/**
 * Split Markdown documents at their level-1/2 headings (never inside a code
 * fence) into note-sized pieces; used to take "notes" out of the repo's
 * Hebrew docs.
 */
export function splitAtHeadings(text: string): string[] {
  const parts: string[] = [];
  let cur: string[] = [];
  let fence: string | null = null;
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const f = /^(`{3,}|~{3,})/.exec(line);
    if (fence === null && f) fence = f[1];
    else if (fence !== null && f && f[1][0] === fence[0] && f[1].length >= fence.length && line.trim() === f[1]) fence = null;
    else if (fence === null && /^#{1,2} /.test(line) && cur.join("").trim()) {
      parts.push(cur.join("\n"));
      cur = [];
    }
    cur.push(line);
  }
  if (cur.join("").trim()) parts.push(cur.join("\n"));
  return parts.map((p) => p.trim() + "\n");
}

export const HEBREW_SECTION = "Hebrew notes";

/** Regression gate: a format fails when any bucket drops more than `tolerance` points. */
export function regressions(
  current: Record<string, FormatReport>,
  baseline: Record<string, { overall: number; bySection: Record<string, number> }>,
  tolerance = 1,
): string[] {
  const out: string[] = [];
  for (const [fmt, base] of Object.entries(baseline)) {
    const cur = current[fmt];
    if (!cur) {
      out.push(`${fmt}: not measured`);
      continue;
    }
    if (cur.overall.pct < base.overall - tolerance) out.push(`${fmt} overall: ${cur.overall.pct}% < baseline ${base.overall}%`);
    for (const [sec, b] of Object.entries(base.bySection)) {
      const c = cur.bySection[sec]?.pct ?? 0;
      if (c < b - tolerance) out.push(`${fmt} / ${sec}: ${c}% < baseline ${b}%`);
    }
  }
  return out;
}

/** The report as Markdown: one table of formats × element types. */
export function reportMarkdown(reports: readonly FormatReport[], sources: string): string {
  const sections = Array.from(new Set(reports.flatMap((r) => Object.keys(r.bySection))));
  const head = `| Element (spec section) | n | ${reports.map((r) => r.format).join(" | ")} |`;
  const sep = `|---|---|${reports.map(() => "---").join("|")}|`;
  const rows = sections.map((s) => {
    const n = reports[0].bySection[s]?.total ?? 0;
    return `| ${s} | ${n} | ${reports.map((r) => `${r.bySection[s]?.pct ?? 0}%`).join(" | ")} |`;
  });
  const total = `| **All** | ${reports[0].overall.total} | ${reports.map((r) => `**${r.overall.pct}%**`).join(" | ")} |`;
  return [`# Format round trip (W12.F1)`, "", sources, "", head, sep, ...rows, total, ""].join("\n");
}
