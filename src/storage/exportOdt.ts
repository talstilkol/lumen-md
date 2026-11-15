/**
 * Markdown → OpenDocument Text (.odt), plan W12.F3.
 *
 * A real ODF 1.3 package (OASIS OpenDocument v1.3, part 2 "Packages"): an
 * uncompressed `mimetype` first, META-INF/manifest.xml, content.xml,
 * styles.xml and meta.xml, zipped by the zero-dependency writer in ./zip.
 *
 * Direction is per paragraph, as in the DOCX export: a paragraph whose first
 * strong character is Hebrew (or Arabic) gets a style with
 * `style:writing-mode="rl-tb"`, otherwise `lr-tb`. A table whose cells are
 * mostly RTL is laid out from the right (`rl-tb` on the table style), so
 * column 1 is the rightmost, as in the preview. Bold and italic set both the
 * Latin and the complex-script properties (`style:font-weight-complex`),
 * because LibreOffice reads the complex ones for Hebrew.
 *
 * Covered: headings 1–6, paragraphs, bold, italic, inline code, links,
 * bullet and numbered lists (nested), pipe tables, fenced code, block
 * quotes, thematic breaks and footnotes (`[^id]` with `[^id]: text`).
 * Not covered: images (their alt text is kept), math (kept as TeX text).
 */
import { firstStrongDirection, markdownBaseDirection, type BaseDirection } from "../lib/textDirection";
import { zip } from "./zip";

export const ODT_MIME = "application/vnd.oasis.opendocument.text";

const NS = [
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"',
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"',
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"',
  'xmlns:xlink="http://www.w3.org/1999/xlink"',
  'xmlns:dc="http://purl.org/dc/elements/1.1/"',
  'xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"',
  'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"',
].join(" ");

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Text with runs of spaces and tabs kept (ODF collapses them otherwise). */
function textXml(s: string): string {
  return esc(s)
    .replace(/\t/g, "<text:tab/>")
    .replace(/ {2,}/g, (m) => ` <text:s text:c="${m.length - 1}"/>`);
}

/* ─── inline ─────────────────────────────────────────────────────────── */

interface Ctx {
  notes: Map<string, string>;
  noteNo: number;
}

const INLINE =
  /(`+)([\s\S]*?[^`])\1(?!`)|\*\*([^*\n]+?)\*\*|__([^_\n]+?)__|(?<![*\w])\*(?=\S)([^*\n]+?)\*(?![*\w])|(?<![_\w])_(?=\S)([^_\n]+?)_(?![_\w])|!\[([^\]]*)\]\([^)]*\)|\[\^([^\]\s]+)\]|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function inlineXml(text: string, ctx: Ctx, bold = false, italic = false): string {
  const style = (b: boolean, i: boolean) => (b && i ? "T_bi" : b ? "T_b" : i ? "T_i" : "");
  const plain = (s: string) => {
    if (!s) return "";
    const st = style(bold, italic);
    return st ? `<text:span text:style-name="${st}">${textXml(s)}</text:span>` : textXml(s);
  };
  let out = "";
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    out += plain(text.slice(last, m.index));
    last = m.index! + m[0].length;
    if (m[2] !== undefined) out += `<text:span text:style-name="T_code">${textXml(m[2].trim() ? m[2].replace(/^ (.*) $/, "$1") : m[2])}</text:span>`;
    else if (m[3] !== undefined || m[4] !== undefined) out += inlineXml(m[3] ?? m[4], ctx, true, italic);
    else if (m[5] !== undefined || m[6] !== undefined) out += inlineXml(m[5] ?? m[6], ctx, bold, true);
    else if (m[7] !== undefined) out += plain(m[7]);
    else if (m[8] !== undefined) {
      const body = ctx.notes.get(m[8]);
      if (body === undefined) out += plain(m[0]);
      else {
        const n = ++ctx.noteNo;
        out +=
          `<text:note text:id="ftn${n}" text:note-class="footnote"><text:note-citation>${n}</text:note-citation>` +
          `<text:note-body>${paraXml(body, ctx, "Footnote")}</text:note-body></text:note>`;
      }
    } else if (m[9] !== undefined) {
      out += `<text:a xlink:type="simple" xlink:href="${esc(m[10])}">${inlineXml(m[9], ctx, bold, italic)}</text:a>`;
    }
  }
  return out + plain(text.slice(last));
}

const dirOf = (text: string, fallback: BaseDirection): BaseDirection => firstStrongDirection(text) ?? fallback;

/** Paragraph styles are `<base>_rtl` / `<base>_ltr` automatic styles over a named parent. */
function paraXml(text: string, ctx: Ctx, base = "Body", fallback: BaseDirection = "ltr"): string {
  return `<text:p text:style-name="${base}_${dirOf(text, fallback)}">${inlineXml(text, ctx)}</text:p>`;
}

/* ─── blocks ─────────────────────────────────────────────────────────── */

const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const isTableSep = (l: string) => /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(l) && l.includes("-");
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

function extractNotes(lines: string[], ctx: Ctx): string[] {
  const kept: string[] = [];
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) fence = !fence;
    const def = fence ? null : /^\[\^([^\]\s]+)\]:\s?(.*)$/.exec(lines[i]);
    if (!def) {
      kept.push(lines[i]);
      continue;
    }
    let body = def[2];
    while (i + 1 < lines.length && /^( {2,}|\t)\S/.test(lines[i + 1])) body += " " + lines[++i].trim();
    if (!ctx.notes.has(def[1])) ctx.notes.set(def[1], body);
  }
  return kept;
}

function listXml(items: { indent: number; ordered: boolean; text: string }[], ctx: Ctx, fallback: BaseDirection): string {
  // Nest by indentation: an item deeper than the one before opens a sub-list inside it.
  let i = 0;
  const build = (indent: number): string => {
    const ordered = items[i].ordered;
    let xml = `<text:list text:style-name="${ordered ? "L_num" : "L_bullet"}">`;
    while (i < items.length && items[i].indent >= indent) {
      const it = items[i++];
      xml += `<text:list-item>${paraXml(it.text, ctx, "List", fallback)}`;
      if (i < items.length && items[i].indent > it.indent) xml += build(items[i].indent);
      xml += "</text:list-item>";
    }
    return xml + "</text:list>";
  };
  let out = "";
  while (i < items.length) out += build(items[i].indent);
  return out;
}

let tableNo = 0;

function tableXml(rows: string[][], ctx: Ctx, fallback: BaseDirection): string {
  const cells = rows.flat().filter((c) => c.trim());
  const rtl = cells.filter((c) => firstStrongDirection(c) === "rtl").length;
  const ltr = cells.filter((c) => firstStrongDirection(c) === "ltr").length;
  const dir: BaseDirection = rtl > ltr ? "rtl" : ltr > rtl ? "ltr" : fallback;
  const cols = Math.max(...rows.map((r) => r.length));
  const name = `Table${++tableNo}`;
  const row = (r: string[]) =>
    `<table:table-row>${Array.from({ length: cols }, (_, k) => `<table:table-cell table:style-name="Cell" office:value-type="string">${paraXml(r[k] ?? "", ctx, "Cell", dir)}</table:table-cell>`).join("")}</table:table-row>`;
  return (
    `<table:table table:name="${name}" table:style-name="Table_${dir}"><table:table-column table:number-columns-repeated="${cols}"/>` +
    `<table:table-header-rows>${row(rows[0])}</table:table-header-rows>${rows.slice(1).map(row).join("")}</table:table>`
  );
}

function bodyXml(md: string, ctx: Ctx, base: BaseDirection): string {
  const lines = extractNotes(md.replace(/\r\n?/g, "\n").split("\n"), ctx);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^\s*(```+|~~~+)/.exec(line);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) code.push(lines[i++]);
      i++;
      out.push(
        `<text:p text:style-name="Code">${code.map(textXml).join("<text:line-break/>")}</text:p>`,
      );
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      const level = h[1].length;
      out.push(
        `<text:h text:style-name="H${level}_${dirOf(h[2], base)}" text:outline-level="${level}">${inlineXml(h[2], ctx)}</text:h>`,
      );
      i++;
      continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push(`<text:p text:style-name="Rule"/>`);
      i++;
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const rows = [splitRow(line)];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(splitRow(lines[i++]));
      out.push(tableXml(rows, ctx, base));
      continue;
    }
    if (LIST.test(line)) {
      const items: { indent: number; ordered: boolean; text: string }[] = [];
      while (i < lines.length) {
        const m = LIST.exec(lines[i]);
        if (m) {
          items.push({ indent: m[1].replace(/\t/g, "    ").length, ordered: /\d/.test(m[2]), text: m[3].replace(/^\[[ xX]\]\s+/, "") });
          i++;
        } else if (lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && items.length) {
          items[items.length - 1].text += " " + lines[i++].trim();
        } else break;
      }
      out.push(listXml(items, ctx, base));
      continue;
    }
    if (/^\s{0,3}>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) quote.push(lines[i++].replace(/^\s{0,3}>\s?/, ""));
      for (const p of quote.join("\n").split(/\n\s*\n/)) if (p.trim()) out.push(paraXml(p.replace(/\n/g, " "), ctx, "Quote", base));
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6}\s|\s*(```|~~~)|\s{0,3}>)/.test(lines[i]) &&
      !LIST.test(lines[i]) &&
      !(lines[i].includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1]))
    )
      para.push(lines[i++].trim());
    out.push(paraXml(para.join(" "), ctx, "Body", base));
  }
  return out.join("");
}

/* ─── styles ─────────────────────────────────────────────────────────── */

const RTL_PROPS = 'style:writing-mode="rl-tb" fo:text-align="start"';
const LTR_PROPS = 'style:writing-mode="lr-tb" fo:text-align="start"';

function automaticStyles(): string {
  const para = (name: string, parent: string) =>
    ["rtl", "ltr"]
      .map(
        (d) =>
          `<style:style style:name="${name}_${d}" style:family="paragraph" style:parent-style-name="${parent}"><style:paragraph-properties ${d === "rtl" ? RTL_PROPS : LTR_PROPS}/></style:style>`,
      )
      .join("");
  const headings = [1, 2, 3, 4, 5, 6].map((l) => para(`H${l}`, `Heading_20_${l}`)).join("");
  const weight = 'fo:font-weight="bold" style:font-weight-asian="bold" style:font-weight-complex="bold"';
  const slant = 'fo:font-style="italic" style:font-style-asian="italic" style:font-style-complex="italic"';
  return [
    para("Body", "Text_20_body"),
    para("List", "List_20_Contents"),
    para("Quote", "Quotations"),
    para("Cell", "Table_20_Contents"),
    para("Footnote", "Footnote"),
    headings,
    `<style:style style:name="T_b" style:family="text"><style:text-properties ${weight}/></style:style>`,
    `<style:style style:name="T_i" style:family="text"><style:text-properties ${slant}/></style:style>`,
    `<style:style style:name="T_bi" style:family="text"><style:text-properties ${weight} ${slant}/></style:style>`,
    `<style:style style:name="T_code" style:family="text" style:parent-style-name="Source_20_Text"/>`,
    `<style:style style:name="Code" style:family="paragraph" style:parent-style-name="Preformatted_20_Text"><style:paragraph-properties style:writing-mode="lr-tb"/></style:style>`,
    `<style:style style:name="Rule" style:family="paragraph" style:parent-style-name="Horizontal_20_Line"/>`,
    `<style:style style:name="Table_rtl" style:family="table"><style:table-properties table:align="right" style:writing-mode="rl-tb"/></style:style>`,
    `<style:style style:name="Table_ltr" style:family="table"><style:table-properties table:align="left" style:writing-mode="lr-tb"/></style:style>`,
    `<style:style style:name="Cell" style:family="table-cell"><style:table-cell-properties fo:padding="0.05in" fo:border="0.5pt solid #000000"/></style:style>`,
    `<text:list-style style:name="L_bullet">${[1, 2, 3, 4, 5, 6]
      .map((l) => `<text:list-level-style-bullet text:level="${l}" text:bullet-char="•"><style:list-level-properties text:space-before="${(l - 1) * 0.25}in" text:min-label-width="0.25in"/></text:list-level-style-bullet>`)
      .join("")}</text:list-style>`,
    `<text:list-style style:name="L_num">${[1, 2, 3, 4, 5, 6]
      .map((l) => `<text:list-level-style-number text:level="${l}" style:num-format="1" style:num-suffix="."><style:list-level-properties text:space-before="${(l - 1) * 0.25}in" text:min-label-width="0.25in"/></text:list-level-style-number>`)
      .join("")}</text:list-style>`,
  ].join("");
}

function stylesXml(lang: string): string {
  const named = (name: string, display: string, family: string, extra = "") =>
    `<style:style style:name="${name}" style:display-name="${display}" style:family="${family}" ${extra}`;
  const heading = (l: number) =>
    `${named(`Heading_20_${l}`, `Heading ${l}`, "paragraph", `style:parent-style-name="Heading" style:default-outline-level="${l}">`)}<style:text-properties fo:font-size="${[0, 20, 16, 14, 13, 12, 11][l]}pt" fo:font-weight="bold" style:font-size-complex="${[0, 20, 16, 14, 13, 12, 11][l]}pt" style:font-weight-complex="bold"/></style:style>`;
  return (
    `<?xml version="1.0" encoding="UTF-8"?><office:document-styles ${NS} office:version="1.3"><office:styles>` +
    `<style:default-style style:family="paragraph"><style:text-properties fo:language="${lang === "he" ? "he" : "en"}" fo:country="${lang === "he" ? "IL" : "US"}" style:language-complex="he" style:country-complex="IL" style:font-name-complex="David CLM"/></style:default-style>` +
    `${named("Standard", "Default Paragraph Style", "paragraph", ">")}</style:style>` +
    `${named("Text_20_body", "Text body", "paragraph", 'style:parent-style-name="Standard">')}<style:paragraph-properties fo:margin-bottom="0.08in"/></style:style>` +
    `${named("Heading", "Heading", "paragraph", 'style:parent-style-name="Standard">')}<style:paragraph-properties fo:margin-top="0.17in" fo:margin-bottom="0.08in" fo:keep-with-next="always"/></style:style>` +
    [1, 2, 3, 4, 5, 6].map(heading).join("") +
    `${named("List_20_Contents", "List Contents", "paragraph", 'style:parent-style-name="Standard">')}</style:style>` +
    `${named("Quotations", "Quotations", "paragraph", 'style:parent-style-name="Standard">')}<style:paragraph-properties fo:margin-left="0.4in" fo:margin-right="0.4in"/></style:style>` +
    `${named("Table_20_Contents", "Table Contents", "paragraph", 'style:parent-style-name="Standard">')}</style:style>` +
    `${named("Footnote", "Footnote", "paragraph", 'style:parent-style-name="Standard">')}<style:text-properties fo:font-size="10pt" style:font-size-complex="10pt"/></style:style>` +
    `${named("Preformatted_20_Text", "Preformatted Text", "paragraph", 'style:parent-style-name="Standard">')}<style:text-properties style:font-name="Liberation Mono" fo:font-family="'Liberation Mono'" fo:font-size="10pt"/></style:style>` +
    `${named("Source_20_Text", "Source Text", "text", ">")}<style:text-properties fo:font-family="'Liberation Mono'"/></style:style>` +
    `${named("Horizontal_20_Line", "Horizontal Line", "paragraph", 'style:parent-style-name="Standard">')}<style:paragraph-properties fo:border-bottom="0.5pt solid #808080"/></style:style>` +
    `</office:styles></office:document-styles>`
  );
}

export interface OdtOptions {
  title?: string;
}

/** The package's parts by name, in the order they are zipped (mimetype first). */
export function markdownToOdtParts(md: string, opts: OdtOptions = {}): { name: string; data: string }[] {
  tableNo = 0;
  const base = markdownBaseDirection(md);
  const body = md.startsWith("---") ? md.replace(/^---\n[\s\S]*?\n---\n?/, "") : md;
  const ctx: Ctx = { notes: new Map(), noteNo: 0 };
  const content =
    `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${NS} office:version="1.3">` +
    `<office:automatic-styles>${automaticStyles()}</office:automatic-styles>` +
    `<office:body><office:text>${bodyXml(body, ctx, base)}</office:text></office:body></office:document-content>`;
  const meta =
    `<?xml version="1.0" encoding="UTF-8"?><office:document-meta ${NS} office:version="1.3"><office:meta>` +
    `<meta:generator>Lumen</meta:generator>${opts.title ? `<dc:title>${esc(opts.title)}</dc:title>` : ""}` +
    `<dc:language>${base === "rtl" ? "he" : "en"}</dc:language></office:meta></office:document-meta>`;
  const manifest =
    `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">` +
    `<manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="${ODT_MIME}"/>` +
    ["content.xml", "styles.xml", "meta.xml"].map((p) => `<manifest:file-entry manifest:full-path="${p}" manifest:media-type="text/xml"/>`).join("") +
    `</manifest:manifest>`;
  return [
    { name: "mimetype", data: ODT_MIME },
    { name: "META-INF/manifest.xml", data: manifest },
    { name: "content.xml", data: content },
    { name: "styles.xml", data: stylesXml(base === "rtl" ? "he" : "en") },
    { name: "meta.xml", data: meta },
  ];
}

/** The .odt bytes. `mimetype` is stored, uncompressed and first, as ODF requires. */
export async function markdownToOdtBytes(md: string, opts: OdtOptions = {}): Promise<Uint8Array> {
  return zip(markdownToOdtParts(md, opts).map((p) => ({ ...p, store: p.name === "mimetype" ? true : undefined })));
}
