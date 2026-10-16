/**
 * Code & document formatting (MASTER_PLAN_NUMBER_ONE §3.2 — "Code formatting").
 *
 * Prettier is heavy (~350 KB gz across the standalone core + plugins), so
 * nothing here imports it statically: `prettier/standalone` and each parser
 * plugin are pulled in with dynamic `import()` the first time a format is
 * requested, and only the plugins the chosen parser needs are fetched. The
 * module itself stays tiny and can sit in the eager bundle.
 *
 * The pure helpers (language → parser mapping, fenced-block lookup, cursor
 * mapping, minimal-diff change) are exported for unit tests; the CodeMirror
 * glue lives in `formatCommands.ts`.
 */

import type { Plugin } from "prettier";

/** Prettier plugin bundles we know how to lazy-load. */
export type PluginName =
  | "markdown"
  | "babel"
  | "estree"
  | "typescript"
  | "postcss"
  | "html"
  | "yaml";

export interface ParserSpec {
  parser: string;
  plugins: PluginName[];
}

const JS: ParserSpec = { parser: "babel", plugins: ["babel", "estree"] };
const TS: ParserSpec = { parser: "typescript", plugins: ["typescript", "estree"] };
const JSON_SPEC: ParserSpec = { parser: "json", plugins: ["babel", "estree"] };
const CSS: ParserSpec = { parser: "css", plugins: ["postcss"] };
const SCSS: ParserSpec = { parser: "scss", plugins: ["postcss"] };
const LESS: ParserSpec = { parser: "less", plugins: ["postcss"] };
// Prettier's html printer formats embedded <script>/<style>, so it needs
// the JS + CSS plugins alongside its own.
const HTML: ParserSpec = { parser: "html", plugins: ["html", "babel", "estree", "postcss"] };
const YAML: ParserSpec = { parser: "yaml", plugins: ["yaml"] };
// Markdown documents can carry YAML frontmatter and fenced code; Prettier
// formats embedded code only when the matching plugin is loaded, so the
// document formatter brings the whole family (all lazily, all on demand).
const MARKDOWN: ParserSpec = {
  parser: "markdown",
  plugins: ["markdown", "yaml", "babel", "estree", "typescript", "postcss", "html"],
};

const LANG_TO_SPEC: Record<string, ParserSpec> = {
  js: JS,
  javascript: JS,
  mjs: JS,
  cjs: JS,
  jsx: JS,
  ts: TS,
  typescript: TS,
  tsx: TS,
  mts: TS,
  cts: TS,
  json: JSON_SPEC,
  json5: { parser: "json5", plugins: ["babel", "estree"] },
  jsonc: JSON_SPEC,
  css: CSS,
  scss: SCSS,
  less: LESS,
  html: HTML,
  htm: HTML,
  xhtml: HTML,
  vue: { parser: "vue", plugins: ["html", "babel", "estree", "postcss"] },
  yaml: YAML,
  yml: YAML,
  md: MARKDOWN,
  markdown: MARKDOWN,
};

/**
 * Normalise a fenced-code info string (```ts {1,3} title="x"```) to the bare
 * language token and map it to a Prettier parser. Returns null when we have
 * no formatter for that language.
 */
export function parserForLang(info: string | null | undefined): ParserSpec | null {
  const lang = normalizeLang(info);
  if (!lang) return null;
  return LANG_TO_SPEC[lang] ?? null;
}

export function normalizeLang(info: string | null | undefined): string {
  if (!info) return "";
  const first = info.trim().split(/[\s{,]/)[0] ?? "";
  // Live-execution blocks use `live-js`, `live-ts`, … — format them as the
  // underlying language.
  return first.replace(/^live-/, "").toLowerCase();
}

/** Languages the formatter supports, for UI / docs. */
export const SUPPORTED_FORMAT_LANGS = Object.freeze(Object.keys(LANG_TO_SPEC));

/* ─── Fenced code block lookup ──────────────────────────────────── */

export interface FencedBlock {
  /** Language token (may be "" for an untagged fence). */
  lang: string;
  /** Offset of the first character of the opening fence line. */
  fenceFrom: number;
  /** Offset just past the closing fence line (or doc end if unclosed). */
  fenceTo: number;
  /** Offset of the first character of the code body. */
  codeFrom: number;
  /** Offset just past the last character of the code body (excl. final newline). */
  codeTo: number;
  /** Indentation of the opening fence — re-applied to formatted lines. */
  indent: string;
}

const OPEN_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/;

/**
 * Find the fenced code block that contains `pos`. A cursor sitting on either
 * fence line counts as inside. Returns null when `pos` is outside every
 * fence. Pure: works on the raw markdown string.
 */
export function findFencedBlockAt(doc: string, pos: number): FencedBlock | null {
  const lines = doc.split("\n");
  let offset = 0;
  let open: { marker: string; lang: string; from: number; codeFrom: number; indent: string } | null = null;
  for (let i = 0; i < lines.length; i++) {
    // CRLF files: match on the line without its carriage return (`.` and `$`
    // don't cover `\r`), but advance offsets over the raw line.
    const raw = lines[i];
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const lineFrom = offset;
    const lineTo = offset + line.length;
    offset = lineFrom + raw.length + 1;
    if (!open) {
      const m = OPEN_RE.exec(line);
      if (!m) continue;
      // Backtick fences can't carry backticks in the info string.
      if (m[2][0] === "`" && m[3].includes("`")) continue;
      open = {
        marker: m[2],
        lang: normalizeLang(m[3]),
        from: lineFrom,
        codeFrom: Math.min(offset, doc.length),
        indent: m[1],
      };
      continue;
    }
    const close = /^ {0,3}(`+|~+)[ \t]*$/.exec(line);
    const isClose =
      !!close && close[1][0] === open.marker[0] && close[1].length >= open.marker.length;
    if (isClose) {
      const block: FencedBlock = {
        lang: open.lang,
        fenceFrom: open.from,
        fenceTo: lineTo,
        codeFrom: open.codeFrom,
        // Exclude the line break before the closing fence (LF or CRLF).
        codeTo: Math.max(open.codeFrom, lineFrom - (doc[lineFrom - 2] === "\r" ? 2 : 1)),
        indent: open.indent,
      };
      if (pos >= block.fenceFrom && pos <= block.fenceTo) return block;
      if (pos < block.fenceFrom) return null;
      open = null;
    }
  }
  if (open && pos >= open.from) {
    // Unclosed fence runs to end of document (CommonMark semantics).
    return {
      lang: open.lang,
      fenceFrom: open.from,
      fenceTo: doc.length,
      codeFrom: open.codeFrom,
      codeTo: doc.length,
      indent: open.indent,
    };
  }
  return null;
}

/* ─── Cursor mapping & minimal change ──────────────────────────── */

/**
 * Map a cursor offset in `before` to the equivalent offset in `after`, where
 * `after` is a reformat of `before`. Formatting mostly moves whitespace, so
 * we count non-whitespace characters before the cursor and land after the
 * same count in the output. Approximate by design.
 */
export function mapCursor(before: string, after: string, pos: number): number {
  const clamped = Math.max(0, Math.min(pos, before.length));
  let count = 0;
  for (let i = 0; i < clamped; i++) if (!/\s/.test(before[i])) count++;
  if (count === 0) return Math.min(clamped, after.length);
  let seen = 0;
  for (let i = 0; i < after.length; i++) {
    if (!/\s/.test(after[i])) {
      seen++;
      if (seen === count) return i + 1;
    }
  }
  return after.length;
}

export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

/**
 * Smallest single replacement turning `before` into `after` (common prefix /
 * suffix trimmed). Keeps undo history, collab updates and decorations
 * outside the touched region stable. Returns null when nothing changed.
 */
export function minimalChange(before: string, after: string): TextChange | null {
  if (before === after) return null;
  let start = 0;
  const max = Math.min(before.length, after.length);
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  let endB = before.length;
  let endA = after.length;
  while (endB > start && endA > start && before.charCodeAt(endB - 1) === after.charCodeAt(endA - 1)) {
    endB--;
    endA--;
  }
  return { from: start, to: endB, insert: after.slice(start, endA) };
}

/** Strip `indent` from every line that starts with it (indented fences). */
export function dedent(code: string, indent: string): string {
  if (!indent) return code;
  return code
    .split("\n")
    .map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l))
    .join("\n");
}

export function reindent(code: string, indent: string): string {
  if (!indent) return code;
  return code
    .split("\n")
    .map((l) => (l.length ? indent + l : l))
    .join("\n");
}

/* ─── Lazy Prettier ─────────────────────────────────────────────── */

type PrettierStandalone = typeof import("prettier/standalone");

const PLUGIN_LOADERS: Record<PluginName, () => Promise<Plugin>> = {
  markdown: () => import("prettier/plugins/markdown").then((m) => (m.default ?? m) as Plugin),
  babel: () => import("prettier/plugins/babel").then((m) => (m.default ?? m) as Plugin),
  estree: () => import("prettier/plugins/estree").then((m) => (m.default ?? m) as unknown as Plugin),
  typescript: () => import("prettier/plugins/typescript").then((m) => (m.default ?? m) as Plugin),
  postcss: () => import("prettier/plugins/postcss").then((m) => (m.default ?? m) as Plugin),
  html: () => import("prettier/plugins/html").then((m) => (m.default ?? m) as Plugin),
  yaml: () => import("prettier/plugins/yaml").then((m) => (m.default ?? m) as Plugin),
};

let standalonePromise: Promise<PrettierStandalone> | null = null;
const pluginCache = new Map<PluginName, Promise<Plugin>>();

function loadStandalone(): Promise<PrettierStandalone> {
  if (!standalonePromise) {
    standalonePromise = import("prettier/standalone").catch((err) => {
      standalonePromise = null;
      throw err;
    });
  }
  return standalonePromise;
}

function loadPlugin(name: PluginName): Promise<Plugin> {
  let p = pluginCache.get(name);
  if (!p) {
    p = PLUGIN_LOADERS[name]().catch((err) => {
      pluginCache.delete(name);
      throw err;
    });
    pluginCache.set(name, p);
  }
  return p;
}

export class NoFormatterError extends Error {
  constructor(readonly lang: string) {
    super(`No formatter for ${lang || "plain text"}`);
    this.name = "NoFormatterError";
  }
}

/** Format `code` with the Prettier parser for `spec`. */
export async function formatWithSpec(code: string, spec: ParserSpec): Promise<string> {
  const [prettier, ...plugins] = await Promise.all([
    loadStandalone(),
    ...spec.plugins.map(loadPlugin),
  ]);
  return prettier.format(code, {
    parser: spec.parser,
    plugins,
    // Markdown prose: keep the author's line wrapping.
    proseWrap: "preserve",
    embeddedLanguageFormatting: "auto",
  });
}

/** Format a code snippet written in `lang`. Throws NoFormatterError. */
export async function formatCode(code: string, lang: string): Promise<string> {
  const spec = parserForLang(lang);
  if (!spec) throw new NoFormatterError(normalizeLang(lang));
  return formatWithSpec(code, spec);
}

/** Format a whole markdown document (frontmatter + embedded code included). */
export function formatMarkdown(doc: string): Promise<string> {
  return formatWithSpec(doc, MARKDOWN);
}

/**
 * Format the fenced code block containing `pos` and return the replacement
 * for the code body (fences untouched). Returns null when `pos` isn't inside
 * a fence; throws NoFormatterError for unsupported languages.
 */
export async function formatBlockAt(
  doc: string,
  pos: number,
): Promise<{ block: FencedBlock; change: TextChange | null; cursor: number } | null> {
  const block = findFencedBlockAt(doc, pos);
  if (!block) return null;
  const spec = parserForLang(block.lang);
  if (!spec) throw new NoFormatterError(block.lang);
  const original = doc.slice(block.codeFrom, block.codeTo);
  const formatted = reindent(
    (await formatWithSpec(dedent(original, block.indent), spec)).replace(/\n+$/, ""),
    block.indent,
  );
  const next = doc.slice(0, block.codeFrom) + formatted + doc.slice(block.codeTo);
  const change = minimalChange(doc, next);
  const inBody = pos >= block.codeFrom && pos <= block.codeTo;
  const cursor = inBody
    ? block.codeFrom + mapCursor(original, formatted, pos - block.codeFrom)
    : pos <= block.codeFrom
      ? pos
      : pos + (formatted.length - original.length);
  return { block, change, cursor };
}
