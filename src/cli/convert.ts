/**
 * Headless document conversion — the core of the `lumen convert` CLI.
 *
 * Uses ONLY the DOM-free converters so it runs in plain Node (no jsdom):
 *   md → tex / rst / org / adoc / rtf / opml / ipynb   (export)
 *   tex / rst / org / adoc / csv / tsv / json / ipynb → md   (import)
 *
 * The dispatch is a pure function (tested in src/__tests__/cliConvert.test.ts);
 * bin/lumen.ts is the thin file-I/O wrapper.
 */
import {
  markdownToLatex,
  markdownToRst,
  markdownToOrg,
  markdownToAdoc,
  markdownToRtf,
  markdownToOpml,
  markdownToIpynb,
} from "../storage/exportFormats";
import {
  latexToMarkdown,
  rstToMarkdown,
  orgToMarkdown,
  adocToMarkdown,
  csvToMarkdown,
  jsonToMarkdown,
  ipynbToMarkdown,
} from "../storage/fileFormats";

const EXPORTERS: Record<string, (md: string) => string> = {
  tex: markdownToLatex,
  latex: markdownToLatex,
  rst: markdownToRst,
  org: markdownToOrg,
  adoc: markdownToAdoc,
  rtf: markdownToRtf,
  opml: (md) => markdownToOpml(md),
  ipynb: (md) => markdownToIpynb(md),
};

const IMPORTERS: Record<string, (text: string) => string> = {
  tex: latexToMarkdown,
  latex: latexToMarkdown,
  rst: rstToMarkdown,
  org: orgToMarkdown,
  adoc: adocToMarkdown,
  csv: csvToMarkdown,
  tsv: csvToMarkdown,
  json: jsonToMarkdown,
  ipynb: ipynbToMarkdown,
};

const extOf = (name: string): string => (name.split(".").pop() || "").toLowerCase();

export function listFormats(): { export: string[]; import: string[] } {
  return { export: Object.keys(EXPORTERS).sort(), import: Object.keys(IMPORTERS).sort() };
}

/**
 * Convert `inText` (named `inName`) to Markdown, or — when the input is
 * Markdown — to the format implied by `toExt`. Returns the suggested output
 * filename and the converted text. Throws on unsupported formats.
 */
export function convert(
  inName: string,
  inText: string,
  toExt?: string,
): { outName: string; outText: string } {
  const inExt = extOf(inName);
  const base = inName.replace(/\.[^.]+$/, "");

  if (inExt === "md" || inExt === "markdown") {
    const to = (toExt || "").toLowerCase();
    const fn = EXPORTERS[to];
    if (!fn)
      throw new Error(
        `Unknown export target ".${to}". Supported: ${Object.keys(EXPORTERS).join(", ")}`,
      );
    return { outName: `${base}.${to}`, outText: fn(inText) };
  }

  const fn = IMPORTERS[inExt];
  if (!fn)
    throw new Error(
      `Unknown source format ".${inExt}". Supported: ${Object.keys(IMPORTERS).join(", ")}`,
    );
  return { outName: `${base}.md`, outText: fn(inText) };
}

/**
 * Request handler for the headless HTTP API (api-server/server.ts):
 * `{ name, text, to? }` → `{ name, text }`. Throws on bad input or
 * unsupported formats (the server maps that to a 400).
 */
export function handleConvert(payload: {
  name?: unknown;
  text?: unknown;
  to?: unknown;
}): { name: string; text: string } {
  if (typeof payload?.name !== "string" || typeof payload?.text !== "string")
    throw new Error("convert: 'name' and 'text' string fields are required");
  const { outName, outText } = convert(
    payload.name,
    payload.text,
    typeof payload.to === "string" ? payload.to : undefined,
  );
  return { name: outName, text: outText };
}
