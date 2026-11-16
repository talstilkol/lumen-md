#!/usr/bin/env node
/**
 * W11.Q8 (research R5.9): the CommonMark 0.31.2 conformance numbers, written
 * to eval/results/md-conformance.json with every exception listed.
 *
 *   node scripts/md-conformance.mjs            # the parser and round-trip rows (runs anywhere)
 *   node scripts/md-conformance.mjs --check    # fail if the committed file is not what a run gives now
 *   npm run md:conformance && node scripts/md-conformance.mjs --app test-results/md-conformance/report.json
 *                                              # adds the app renderer's rows (CommonMark and GFM),
 *                                              # from mdConformance.test.ts's report (needs the real packages)
 *
 * Rows, each against the vendored specs (src/__tests__/fixtures/md-spec, CC BY-SA 4.0):
 *   - gfm-parser / gfm-round-trip: the same two on the GFM 0.29 spec, with
 *     micromark-extension-gfm and mdast-util-gfm (what remark-gfm loads);
 *     `disabled` and superseded examples are left out and listed;
 *   - parser: micromark (the parser under remark-parse, the app's version)
 *     straight to HTML, compared byte for byte with the spec's HTML;
 *   - round-trip: Markdown → mdast (mdast-util-from-markdown) → Markdown
 *     (mdast-util-to-markdown, the serializer remark-stringify and Milkdown
 *     use, with the app's round-trip handlers from
 *     src/editor/markdownSerialize.mjs) → HTML, compared with the parser's
 *     HTML for the same input: does saving through the AST keep what the
 *     note means?
 *   - app (with --app): the preview's renderer, from the vitest report.
 *
 * Eval cards (W11.I18, scripts/lib/evalCard.mjs `makeCard`), built from the
 * rows alone (an example scores 1 unless it is listed as an exception):
 *   - parser: tag `public`, the whole published spec (652 examples), and we
 *     did not tune micromark on it;
 *   - round-trip: tag `dev`, because src/editor/markdownSerialize.mjs was fixed on
 *     these very examples (461, 463), so the spec is not held out from it.
 * The report's top-level `card` is the round-trip one: the app's own claim.
 * No card yet for the app rows; they need the Mac run (--app).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { roundTripSafe } from "../src/editor/markdownSerialize.mjs";
import { makeCard } from "./lib/evalCard.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SPEC = "src/__tests__/fixtures/md-spec/commonmark-0.31.2.txt";
export const OUT = "eval/results/md-conformance.json";
export const TARGET = 0.99;

/**
 * Why each round-trip exception happens (mdast-util-to-markdown 2.1.2 with
 * the app's handlers), by example number. 461 and 463 (nested emphasis
 * written as strong) are fixed by src/editor/markdownSerialize.mjs.
 */
export const ROUND_TRIP_EXCEPTIONS = {
  20: "a backslash inside an autolink is escaped again, so the link's URL changes (%5C → %5C%5C)",
  39: "&#10; is decoded to a newline and written raw, so two blank-separated lines become two paragraphs",
  148: "a line ending inside raw HTML is written as a space",
  187: "a soft line break before inline raw HTML is written as a space",
  603: "a backslash inside an autolink is escaped again, so the link's URL changes",
};

export const GFM_SPEC = "src/__tests__/fixtures/md-spec/gfm-0.29.txt";
export const GFM_SOURCE = "https://github.github.com/gfm/";

/**
 * GFM 0.29 examples left out of the GFM rows, with why: the 2 the spec
 * itself marks `disabled`, and the ones CommonMark 0.31.2 superseded (the
 * same Markdown has a different expected HTML in the newer spec, which the
 * parser follows; the CommonMark rows score them).
 */
export const GFM_LEFT_OUT = { disabled: "marked `disabled` in the GFM spec itself (upstream skips them too)", superseded: "CommonMark 0.31.2 changed the expected HTML of this very Markdown; the parser follows the newer spec, scored in the CommonMark rows" };

/**
 * Why micromark + micromark-extension-gfm differs from the GFM 0.29 spec's
 * HTML, by example. Every one is an example in a CORE section that the GFM
 * spec did not update for its own extensions: with the extensions on, its
 * expected HTML is not what GFM (or github.com) renders.
 */
export const GFM_PARSER_EXCEPTIONS = {
  140: "the GFM tag filter (example 652, gfmHtml) escapes <script>; this core example was written without the filter",
  141: "the GFM tag filter (example 652) escapes </style>; this core example was written without the filter",
  145: "the GFM tag filter (example 652) escapes <style>; this core example was written without the filter",
  147: "the GFM tag filter (example 652) escapes <script>; this core example was written without the filter",
  610: "the autolink-literal extension links the bare URL inside; this core example was written without the extension",
  616: "the autolink-literal extension links the bare URL inside; this core example was written without the extension",
  619: "the autolink-literal extension links a bare URL; this core example was written without the extension",
  620: "the autolink-literal extension links a bare email address; this core example was written without the extension",
  628: "ftp:// is not an autolink literal: micromark follows github.com, which dropped it after the 0.29 spec",
};

/** Why the GFM round trip (with mdast-util-gfm) changes the parser's HTML, by example. */
export const GFM_ROUND_TRIP_EXCEPTIONS = {
  118: "a line ending inside raw HTML is written as a space (as CommonMark 148)",
  156: "a soft line break before inline raw HTML is written as a space (as CommonMark 187)",
  204: "a table row with more cells than the header: the extra cell is dropped when rendered but written back as a new column",
  316: "a backslash inside an autolink is escaped again, so the link's URL changes (as CommonMark 20)",
  335: "&#10; is decoded to a newline and written raw, so two blank-separated lines become two paragraphs (as CommonMark 39)",
  611: "a backslash inside an autolink is escaped again, so the link's URL changes (as CommonMark 603)",
  614: "an escaped character in <foo\\+@…> is written unescaped, and the text becomes an email autolink",
};

/** The GFM spec's examples, each with its extension name ("" for core, table, strikethrough, autolink, tagfilter, disabled). */
export function parseGfmSpecText(text) {
  const kinds = [];
  for (const l of text.replace(/\r\n?/g, "\n").split("\n")) {
    const m = /^`{32} example(?: (\w+))?$/.exec(l);
    if (m) kinds.push(m[1] ?? "");
  }
  const examples = parseSpecText(text);
  if (kinds.length !== examples.length) throw new Error(`GFM spec: ${examples.length} examples but ${kinds.length} headers`);
  return examples.map((e, i) => ({ ...e, extension: kinds[i] }));
}

/** The spec's examples: { example, section, markdown, html }, tabs restored (→ is a tab in spec.txt). */
export function parseSpecText(text) {
  const out = [];
  let section = "";
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const h = /^#{1,6} (.+)$/.exec(lines[i]);
    if (h) section = h[1];
    if (!/^`{32} example/.test(lines[i])) continue;
    const md = [];
    const html = [];
    let j = i + 1;
    for (; lines[j] !== "."; j++) md.push(lines[j]);
    for (j++; !/^`{32}$/.test(lines[j]); j++) html.push(lines[j]);
    const tab = (s) => s.replace(/→/g, "\t");
    out.push({ example: out.length + 1, section, markdown: tab(md.length ? `${md.join("\n")}\n` : ""), html: tab(html.length ? `${html.join("\n")}\n` : "") });
    i = j;
  }
  return out;
}

/** The three packages, from the app's node_modules; the serializer with the app's handlers (roundTripSafe). */
export async function loadParsers(root = ROOT) {
  const [{ micromark }, { fromMarkdown }, { toMarkdown }] = await Promise.all([import("micromark"), import("mdast-util-from-markdown"), import("mdast-util-to-markdown")]);
  const version = (n) => JSON.parse(readFileSync(join(root, "node_modules", n, "package.json"), "utf8")).version;
  return { micromark, fromMarkdown, toMarkdown: (tree) => toMarkdown(tree, roundTripSafe()), versions: { micromark: version("micromark"), "mdast-util-from-markdown": version("mdast-util-from-markdown"), "mdast-util-to-markdown": version("mdast-util-to-markdown") } };
}

const OPTS = { allowDangerousHtml: true, allowDangerousProtocol: true };

/**
 * The GFM packages (micromark-extension-gfm, mdast-util-gfm: what remark-gfm
 * loads), or null when they are not installed (an offline runner).
 */
export async function loadGfm(root = ROOT, p) {
  let ext, mdast;
  try {
    [ext, mdast] = await Promise.all([import("micromark-extension-gfm"), import("mdast-util-gfm")]);
    if (typeof ext.gfm !== "function" || typeof mdast.gfmToMarkdown !== "function") return null;
    ext.gfm();
  } catch {
    return null;
  }
  const version = (n) => JSON.parse(readFileSync(join(root, "node_modules", n, "package.json"), "utf8")).version;
  const { fromMarkdown } = await import("mdast-util-from-markdown");
  const { toMarkdown } = await import("mdast-util-to-markdown");
  const options = { allowDangerousHtml: true, allowDangerousProtocol: true, extensions: [ext.gfm()], htmlExtensions: [ext.gfmHtml()] };
  return {
    html: (md) => p.micromark(md, options),
    roundTrip: (md) => {
      const safe = roundTripSafe();
      const tree = fromMarkdown(md, { extensions: [ext.gfm()], mdastExtensions: [mdast.gfmFromMarkdown()] });
      return toMarkdown(tree, { ...safe, extensions: [...(safe.extensions ?? []), mdast.gfmToMarkdown()] });
    },
    versions: { "micromark-extension-gfm": version("micromark-extension-gfm"), "mdast-util-gfm": version("mdast-util-gfm") },
  };
}

/**
 * Score the GFM 0.29 spec: the parser with the GFM extensions against the
 * spec's HTML byte for byte, and the GFM round trip against the parser.
 * `disabled` and superseded examples are left out (counted in `leftOut`).
 */
export function scoreGfm(gfmExamples, cmExamples, g) {
  const cmHtml = new Map(cmExamples.map((e) => [e.markdown, e.html]));
  const leftOut = { disabled: [], superseded: [] };
  const parserFailed = [];
  const roundFailed = [];
  let total = 0;
  for (const e of gfmExamples) {
    if (e.extension === "disabled") {
      leftOut.disabled.push(e.example);
      continue;
    }
    const c = cmHtml.get(e.markdown);
    if (c !== undefined && c !== e.html) {
      leftOut.superseded.push(e.example);
      continue;
    }
    total++;
    const html = g.html(e.markdown);
    if (html !== e.html) parserFailed.push({ example: e.example, section: e.section, reason: GFM_PARSER_EXCEPTIONS[e.example] ?? "not explained yet" });
    let again;
    try {
      again = g.html(g.roundTrip(e.markdown));
    } catch (err) {
      again = `error: ${err.message}`;
    }
    if (again !== html) roundFailed.push({ example: e.example, section: e.section, reason: GFM_ROUND_TRIP_EXCEPTIONS[e.example] ?? "not explained yet" });
  }
  const row = (kind, what, failed) => ({ kind, what, spec: "GFM 0.29", total, passed: total - failed.length, rate: Math.round(((total - failed.length) / total) * 10000) / 10000, target: TARGET, exceptions: failed, leftOut: { disabled: leftOut.disabled, superseded: leftOut.superseded } });
  return [
    row("gfm-parser", `micromark with micromark-extension-gfm ${g.versions["micromark-extension-gfm"]} to HTML, byte for byte`, parserFailed),
    row("gfm-round-trip", `mdast-util-from-markdown → mdast-util-to-markdown with mdast-util-gfm ${g.versions["mdast-util-gfm"]} and src/editor/markdownSerialize.mjs → micromark with GFM, HTML compared with the parser's`, roundFailed),
  ];
}


/** Score the parser and the round trip on the spec's examples. */
export function score(examples, p) {
  const parserFailed = [];
  const roundFailed = [];
  for (const e of examples) {
    const html = p.micromark(e.markdown, OPTS);
    if (html !== e.html) parserFailed.push({ example: e.example, section: e.section, reason: "the parser's HTML differs from the spec's" });
    let again;
    try {
      again = p.micromark(p.toMarkdown(p.fromMarkdown(e.markdown)), OPTS);
    } catch (err) {
      again = `error: ${err.message}`;
    }
    if (again !== html) roundFailed.push({ example: e.example, section: e.section, reason: ROUND_TRIP_EXCEPTIONS[e.example] ?? "not explained yet" });
  }
  const row = (kind, what, failed) => ({ kind, what, spec: "CommonMark 0.31.2", total: examples.length, passed: examples.length - failed.length, rate: Math.round(((examples.length - failed.length) / examples.length) * 10000) / 10000, target: TARGET, exceptions: failed });
  return [
    row("parser", `micromark ${p.versions.micromark} to HTML, byte for byte`, parserFailed),
    row("round-trip", `mdast-util-from-markdown ${p.versions["mdast-util-from-markdown"]} → mdast-util-to-markdown ${p.versions["mdast-util-to-markdown"]} with src/editor/markdownSerialize.mjs → micromark, HTML compared with the parser's`, roundFailed),
  ];
}

export const SPEC_SOURCE = "https://spec.commonmark.org/0.31.2/";

/** Per-example 0/1 scores of a row, from its own counts and exceptions (no rerun). */
export function rowScores(row) {
  const failed = new Set(row.exceptions.map((e) => e.example));
  if (failed.size !== row.total - row.passed) throw new Error(`${row.kind}: ${row.total - row.passed} failures but ${failed.size} exceptions listed`);
  return Array.from({ length: row.total }, (_, i) => (failed.has(i + 1) ? 0 : 1));
}

/** The eval cards of the parser and round-trip rows: { card (round-trip), cards: { parser, "round-trip" } }. */
export function mdCards(rows, versions) {
  const dataset = (split) => ({ name: "commonmark-spec", version: "0.31.2", license: "CC-BY-SA-4.0", source: SPEC_SOURCE, split });
  const byKind = Object.fromEntries(rows.filter((r) => r.kind !== "app").map((r) => [r.kind, r]));
  const parser = makeCard({
    tag: "public",
    model: { name: `micromark ${versions.micromark}`, digest: `npm:micromark@${versions.micromark}` },
    seed: 1,
    temperature: 0,
    // Review Z6-L6: micromark is developed and tested against these very examples, so this is a conformance check
    // on a published split, not an untuned result.
    dataset: dataset("all examples of the published spec; micromark is developed and tested against them, so this is a conformance check"),
    scores: { html_exact: rowScores(byKind.parser) },
  });
  const roundTrip = makeCard({
    tag: "dev",
    model: { name: "mdast round trip with src/editor/markdownSerialize.mjs", digest: `npm:mdast-util-from-markdown@${versions["mdast-util-from-markdown"]}+mdast-util-to-markdown@${versions["mdast-util-to-markdown"]}+micromark@${versions.micromark}` },
    seed: 1,
    temperature: 0,
    dataset: dataset("all examples of the published spec; dev, because the round-trip handlers were fixed on these examples"),
    scores: { html_kept: rowScores(byKind["round-trip"]) },
  });
  const cards = { parser, "round-trip": roundTrip };
  if (byKind["gfm-parser"] && byKind["gfm-round-trip"]) {
    const gfmSet = (split) => ({ name: "gfm-spec", version: "0.29-gfm", license: "CC-BY-SA-4.0", source: GFM_SOURCE, split });
    cards["gfm-parser"] = makeCard({
      tag: "public",
      model: { name: `micromark ${versions.micromark} + micromark-extension-gfm ${versions["micromark-extension-gfm"]}`, digest: `npm:micromark@${versions.micromark}+micromark-extension-gfm@${versions["micromark-extension-gfm"]}` },
      seed: 1,
      temperature: 0,
      dataset: gfmSet("the published GFM 0.29 spec without its 2 disabled examples and the ones CommonMark 0.31.2 superseded; micromark is tested against it, so this is a conformance check"),
      scores: { html_exact: rowScores(byKind["gfm-parser"]) },
    });
    cards["gfm-round-trip"] = makeCard({
      tag: "dev",
      model: { name: "mdast round trip with mdast-util-gfm and src/editor/markdownSerialize.mjs", digest: `npm:mdast-util-from-markdown@${versions["mdast-util-from-markdown"]}+mdast-util-to-markdown@${versions["mdast-util-to-markdown"]}+mdast-util-gfm@${versions["mdast-util-gfm"]}` },
      seed: 1,
      temperature: 0,
      dataset: gfmSet("as the GFM parser row; dev, because the round-trip handlers were fixed on the spec's examples"),
      scores: { html_kept: rowScores(byKind["gfm-round-trip"]) },
    });
  }
  return { card: roundTrip, cards };
}

/** The app renderer's rows from mdConformance.test.ts's report.json (Mac). */
export function appRows(report, examples) {
  return report.map((r) => ({
    kind: "app",
    what: r.name,
    spec: r.name.startsWith("GFM") ? "GFM 0.29" : "CommonMark 0.31.2",
    total: r.total,
    passed: r.passed,
    rate: Math.round((r.passed / r.total) * 10000) / 10000,
    target: TARGET,
    exceptions: (r.failed ?? []).map((f) => ({ example: f.example, section: f.section ?? examples.find((e) => e.example === f.example)?.section ?? "", reason: f.reason ?? "listed in mdConformance.test.ts KNOWN_DEVIATIONS" })),
  }));
}

async function main() {
  const argv = process.argv.slice(2);
  const examples = parseSpecText(readFileSync(join(ROOT, SPEC), "utf8"));
  const p = await loadParsers();
  const prev = existsSync(join(ROOT, OUT)) ? JSON.parse(readFileSync(join(ROOT, OUT), "utf8")) : null;
  let rows = score(examples, p);
  const g = await loadGfm(ROOT, p);
  if (g) {
    rows = [...rows, ...scoreGfm(parseGfmSpecText(readFileSync(join(ROOT, GFM_SPEC), "utf8")), examples, g)];
    Object.assign(p.versions, g.versions);
  } else if (prev) {
    console.error("md-conformance: the GFM packages are not installed here; the committed GFM rows are kept as they are");
    rows = [...rows, ...prev.rows.filter((r) => r.kind.startsWith("gfm-"))];
    Object.assign(p.versions, Object.fromEntries(Object.entries(prev.versions).filter(([k]) => k.includes("gfm"))));
  }
  const appAt = argv.indexOf("--app");
  if (appAt >= 0) rows = [...rows, ...appRows(JSON.parse(readFileSync(argv[appAt + 1], "utf8")), examples)];
  else if (prev) rows = [...rows, ...prev.rows.filter((r) => r.kind === "app")];
  const out = { schema: 1, generator: "scripts/md-conformance.mjs", origin: "real", source: `${SPEC} (commonmark/commonmark-spec 0.31.2, CC BY-SA 4.0); ${GFM_SPEC} (github/cmark-gfm 0.29-gfm, CC BY-SA 4.0)`, versions: p.versions, ...mdCards(rows, p.versions), rows };
  const text = `${JSON.stringify(out, null, 2)}\n`;
  if (argv.includes("--check")) {
    const have = existsSync(join(ROOT, OUT)) ? readFileSync(join(ROOT, OUT), "utf8") : "";
    if (have !== text) {
      console.error(`✖ ${OUT} is not what a run gives now: run node scripts/md-conformance.mjs`);
      process.exit(1);
    }
  } else {
    mkdirSync(dirname(join(ROOT, OUT)), { recursive: true });
    writeFileSync(join(ROOT, OUT), text);
  }
  for (const r of rows) console.error(`${r.kind}: ${r.passed}/${r.total} (${(r.rate * 100).toFixed(2)}%)${r.exceptions.length ? ` — exceptions ${r.exceptions.map((e) => e.example).join(", ")}` : ""}`);
  const unexplained = rows.flatMap((r) => r.exceptions.filter((e) => e.reason === "not explained yet").map((e) => `${r.kind} #${e.example}`));
  if (unexplained.length) {
    console.error(`✖ exceptions without a reason: ${unexplained.join(", ")}`);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
