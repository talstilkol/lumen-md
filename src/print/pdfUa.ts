/**
 * PDF/UA-1 finishing and checking of a tagged PDF (plan W13.F3), with no
 * dependency: a PDF is bytes, and what PDF/UA-1 adds on top of Chromium's
 * tagged PDF is a few catalog entries and an XMP packet.
 *
 * `finishPdfUa` appends an incremental update (the original bytes are kept
 * as they are, as PDF allows) with:
 *  - an XMP metadata stream: `pdfuaid:part 1` (the PDF/UA identification
 *    veraPDF looks for first), `dc:title` (the same as the Info /Title),
 *    `dc:language`, the producer;
 *  - the catalog again, with `/Metadata`, `/Lang` (he-IL for Hebrew),
 *    `/ViewerPreferences << /DisplayDocTitle true >>` and `/MarkInfo`.
 *
 * `inspectPdfUa` reads what a validator checks first — tagged, a structure
 * tree, the language, the title shown, the PDF/UA identification, every
 * Figure with /Alt, headings that do not skip a level, tables with TH — for
 * the tests and for `scripts/verapdf-check.mjs` before veraPDF runs. It reads
 * uncompressed objects (Chromium writes its structure tree uncompressed);
 * it is a first gate, not a replacement for veraPDF.
 */

const latin1 = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return s;
};
const bytesOf = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
const utf8 = (s: string) => new TextEncoder().encode(s);

/** A PDF text string: ASCII as a literal, anything else as UTF-16BE hex with a BOM. */
export function pdfString(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s)) return `(${s.replace(/[\\()]/g, (c) => `\\${c}`)})`;
  let hex = "FEFF";
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, "0").toUpperCase();
  return `<${hex}>`;
}

/** A PDF text string → JS (literal or hex, UTF-16BE with BOM or PDFDocEncoding as Latin-1). */
export function readPdfString(raw: string): string {
  const t = raw.trim();
  if (t.startsWith("<")) {
    const hex = t.slice(1, -1).replace(/\s+/g, "");
    const bytes = hex.match(/../g)?.map((h) => parseInt(h, 16)) ?? [];
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      let out = "";
      for (let i = 2; i + 1 < bytes.length; i += 2) out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
      return out;
    }
    return String.fromCharCode(...bytes);
  }
  const inner = t.slice(1, -1).replace(/\\([\\()])/g, "$1");
  if (inner.charCodeAt(0) === 0xfe && inner.charCodeAt(1) === 0xff) {
    let out = "";
    for (let i = 2; i + 1 < inner.length; i += 2) out += String.fromCharCode((inner.charCodeAt(i) << 8) | inner.charCodeAt(i + 1));
    return out;
  }
  return inner;
}

interface Trailer {
  root: number;
  info: number | null;
  size: number;
  startxref: number;
}

function lastTrailer(text: string): Trailer {
  const sx = text.lastIndexOf("startxref");
  if (sx < 0) throw new Error("not a PDF: no startxref");
  const startxref = Number(/startxref\s+(\d+)/.exec(text.slice(sx))?.[1]);
  const tIdx = text.lastIndexOf("trailer", sx);
  // A classic trailer; an xref stream keeps the same keys in its dictionary.
  const dict = tIdx >= 0 ? text.slice(tIdx, sx) : text.slice(startxref, startxref + 2000);
  const root = /\/Root\s+(\d+)\s+0\s+R/.exec(dict);
  const size = /\/Size\s+(\d+)/.exec(dict);
  if (!root || !size) throw new Error("not a PDF: no /Root in the trailer");
  const info = /\/Info\s+(\d+)\s+0\s+R/.exec(dict);
  return { root: Number(root[1]), size: Number(size[1]), info: info ? Number(info[1]) : null, startxref };
}

/** The dictionary text of object `n` (its last definition, as an update would leave it). */
function objectDict(text: string, n: number): string | null {
  const re = new RegExp(`(?:^|[\\r\\n\\s])${n}\\s+0\\s+obj\\s*`, "g");
  let start = -1;
  for (let m = re.exec(text); m; m = re.exec(text)) start = m.index + m[0].length;
  if (start < 0) return null;
  // The dictionary: balanced << >> from the start.
  if (text.slice(start, start + 2) !== "<<") return null;
  let depth = 0;
  for (let i = start; i < text.length - 1; i++) {
    if (text[i] === "(") {
      // Skip a literal string (it may hold << or >>).
      let d = 0;
      for (; i < text.length; i++) {
        if (text[i] === "\\") i++;
        else if (text[i] === "(") d++;
        else if (text[i] === ")" && --d === 0) break;
      }
      continue;
    }
    if (text[i] === "<" && text[i + 1] === "<") {
      depth++;
      i++;
    } else if (text[i] === ">" && text[i + 1] === ">") {
      depth--;
      i++;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Remove the top-level entry `/key` (and its value) from a dictionary's text. */
function withoutKey(dict: string, key: string): string {
  const i = dict.search(new RegExp(`/${key}(?![A-Za-z])`));
  if (i < 0) return dict;
  let j = i + key.length + 1;
  while (/\s/.test(dict[j])) j++;
  const open = dict.slice(j, j + 2);
  if (open === "<<") {
    let depth = 0;
    for (; j < dict.length - 1; j++) {
      if (dict[j] === "<" && dict[j + 1] === "<") {
        depth++;
        j++;
      } else if (dict[j] === ">" && dict[j + 1] === ">") {
        depth--;
        j++;
        if (depth === 0) {
          j++;
          break;
        }
      }
    }
  } else if (dict[j] === "(") {
    let d = 0;
    for (; j < dict.length; j++) {
      if (dict[j] === "\\") j++;
      else if (dict[j] === "(") d++;
      else if (dict[j] === ")" && --d === 0) {
        j++;
        break;
      }
    }
  } else if (dict[j] === "<") j = dict.indexOf(">", j) + 1;
  else if (dict[j] === "[") j = dict.indexOf("]", j) + 1;
  else {
    const m = /^(\d+\s+\d+\s+R|\/[^\s/<>[\]()]+|[^\s/<>[\]()]+)/.exec(dict.slice(j));
    j += m ? m[0].length : 0;
  }
  return dict.slice(0, i) + dict.slice(j);
}

const xmlEsc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function xmpPacket(o: { title: string; lang: string; producer?: string; date?: Date }): string {
  const d = (o.date ?? new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
   <pdfuaid:part>1</pdfuaid:part>
   <dc:format>application/pdf</dc:format>
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlEsc(o.title)}</rdf:li></rdf:Alt></dc:title>
   <dc:language><rdf:Bag><rdf:li>${xmlEsc(o.lang)}</rdf:li></rdf:Bag></dc:language>
   <pdf:Producer>${xmlEsc(o.producer ?? "Lumen")}</pdf:Producer>
   <xmp:MetadataDate>${d}</xmp:MetadataDate>
   <xmp:ModifyDate>${d}</xmp:ModifyDate>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/**
 * Add what PDF/UA-1 needs on top of a tagged PDF, as an incremental update.
 * `title` falls back to the PDF's own /Title. Throws on bytes that are not
 * a PDF; returns the input unchanged when it is not tagged (nothing to
 * finish: a PDF without a structure tree cannot be PDF/UA).
 */
export function finishPdfUa(pdf: Uint8Array, o: { title?: string; lang: string; producer?: string; date?: Date }): Uint8Array {
  const text = latin1(pdf);
  if (!text.startsWith("%PDF-")) throw new Error("not a PDF");
  const tr = lastTrailer(text);
  let catalog = objectDict(text, tr.root);
  if (!catalog) throw new Error("not a PDF: no catalog");
  if (!/\/StructTreeRoot\s+\d+\s+0\s+R/.test(catalog)) return pdf;
  const info = tr.info !== null ? objectDict(text, tr.info) : null;
  const ownTitle = info && /\/Title\s*(\([^)]*\)|<[^>]*>)/.exec(info)?.[1];
  const title = o.title?.trim() || (ownTitle ? readPdfString(ownTitle) : "") || "Untitled";
  // The XMP says what the Info dictionary says (the producer too), so the two never disagree.
  const ownProducer = info && /\/Producer\s*(\([^)]*\)|<[^>]*>)/.exec(info)?.[1];
  const xmp = utf8(xmpPacket({ title, lang: o.lang, producer: o.producer ?? (ownProducer ? readPdfString(ownProducer) : undefined), date: o.date }));
  const metaNum = tr.size;
  for (const k of ["Metadata", "Lang", "ViewerPreferences", "MarkInfo"]) catalog = withoutKey(catalog, k);
  catalog = `${catalog.slice(0, -2).trimEnd()}\n/Metadata ${metaNum} 0 R\n/Lang ${pdfString(o.lang)}\n/MarkInfo <</Marked true>>\n/ViewerPreferences <</DisplayDocTitle true>>>>`;
  // The Info /Title must say what dc:title says.
  const infoNum = tr.info ?? tr.size + 1;
  const infoDict = info ? `${withoutKey(info, "Title").slice(0, -2).trimEnd()}\n/Title ${pdfString(title)}>>` : `<</Title ${pdfString(title)}>>`;
  const parts: Uint8Array[] = [pdf];
  let offset = pdf.length;
  const push = (b: Uint8Array) => {
    parts.push(b);
    offset += b.length;
  };
  const sep = text.endsWith("\n") ? "" : "\n";
  push(bytesOf(sep));
  const offsets = new Map<number, number>();
  offsets.set(metaNum, offset);
  push(bytesOf(`${metaNum} 0 obj\n<</Type /Metadata /Subtype /XML /Length ${xmp.length}>>\nstream\n`));
  push(xmp);
  push(bytesOf("\nendstream\nendobj\n"));
  offsets.set(tr.root, offset);
  push(bytesOf(`${tr.root} 0 obj\n${catalog}\nendobj\n`));
  offsets.set(infoNum, offset);
  push(bytesOf(`${infoNum} 0 obj\n${infoDict}\nendobj\n`));
  // A link annotation needs a text alternative (/Contents; PDF/UA-1 7.18.1): its address, when Chromium left none.
  for (const m of text.matchAll(/(?:^|[\r\n])(\d+)\s+0\s+obj\s*<<\/Type\s*\/Annot\s*\/Subtype\s*\/Link/g)) {
    const n = Number(m[1]);
    if (offsets.has(n)) continue;
    const dict = objectDict(text, n);
    if (!dict || /\/Contents\s*[(<]/.test(dict)) continue;
    const uri = /\/URI\s*(\([^)]*\)|<[^>]*>)/.exec(dict)?.[1];
    const label = uri ? readPdfString(uri) : "Link";
    offsets.set(n, offset);
    push(bytesOf(`${n} 0 obj\n${dict.slice(0, -2).trimEnd()}\n/Contents ${pdfString(label)}>>\nendobj\n`));
  }
  const size = Math.max(tr.size, metaNum + 1, infoNum + 1);
  const xrefAt = offset;
  const rows = [...offsets.entries()].sort((a, b) => a[0] - b[0]);
  let xref = "xref\n";
  for (const [n, off] of rows) xref += `${n} 1\n${String(off).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<</Size ${size}\n/Root ${tr.root} 0 R\n/Info ${infoNum} 0 R\n/Prev ${tr.startxref}>>\nstartxref\n${xrefAt}\n%%EOF\n`;
  push(bytesOf(xref));
  const out = new Uint8Array(offset);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export type PdfUaProblem = "notTagged" | "noStructTree" | "noLang" | "noDisplayDocTitle" | "noTitle" | "noPdfUaId" | "figureWithoutAlt" | "headingSkipped" | "tableWithoutHeaders" | "linkWithoutText";

/** Each problem in English, with the PDF/UA-1 / Matterhorn reference (for scripts and logs). */
export const PROBLEM_TEXT: Record<PdfUaProblem, string> = {
  notTagged: "not marked as tagged (/MarkInfo /Marked true; PDF/UA-1 7.1)",
  noStructTree: "no structure tree (7.1)",
  noLang: "no document language (/Lang; 7.2)",
  noDisplayDocTitle: "the title is not shown in the window (/DisplayDocTitle; 7.1)",
  noTitle: "no title (/Title, dc:title; 7.1)",
  noPdfUaId: "no PDF/UA identification (pdfuaid:part 1; 5)",
  figureWithoutAlt: "a figure without alternative text (/Alt; 7.3)",
  headingSkipped: "a heading level is skipped (7.4.2)",
  tableWithoutHeaders: "a table without header cells (7.5)",
  linkWithoutText: "a link annotation without /Contents (7.18.1)",
};

export interface PdfUaReport {
  tagged: boolean;
  structTree: boolean;
  lang: string | null;
  displayDocTitle: boolean;
  title: string | null;
  pdfUaPart: number | null;
  /** Structure types in document order (H1, P, Figure, Table…). */
  structure: string[];
  figures: number;
  figuresWithoutAlt: number;
  /** Heading levels that skip one (H1 then H3): each as "H1→H3". */
  headingSkips: string[];
  tables: number;
  tablesWithoutTH: number;
  /** Link annotations, and those without a text alternative (/Contents). */
  links: number;
  linksWithoutText: number;
  /** Bookmarks (/Outlines) present. */
  outline: boolean;
  /** What fails (empty: the first gate passes); `PROBLEM_TEXT` says each in English for scripts, the app has its words. */
  problems: PdfUaProblem[];
}

/** The PDF/UA first gate: the checks above, from the bytes. */
export function inspectPdfUa(pdf: Uint8Array): PdfUaReport {
  const text = latin1(pdf);
  const tr = lastTrailer(text);
  const catalog = objectDict(text, tr.root) ?? "";
  const info = tr.info !== null ? (objectDict(text, tr.info) ?? "") : "";
  const lang = /\/Lang\s*(\([^)]*\)|<[^>]*>)/.exec(catalog)?.[1];
  const title = /\/Title\s*(\([^)]*\)|<[^>]*>)/.exec(info)?.[1];
  const metaRef = /\/Metadata\s+(\d+)\s+0\s+R/.exec(catalog)?.[1];
  let pdfUaPart: number | null = null;
  if (metaRef) {
    const at = text.search(new RegExp(`(?:^|\\s)${metaRef}\\s+0\\s+obj`));
    const xml = at >= 0 ? new TextDecoder().decode(pdf.subarray(at, Math.min(pdf.length, at + 8000))) : "";
    const m = /<pdfuaid:part>(\d)<\/pdfuaid:part>|pdfuaid:part="(\d)"/.exec(xml);
    if (m) pdfUaPart = Number(m[1] ?? m[2]);
  }
  // Structure elements: every dictionary with /S /<Type> and a /P parent (Chromium writes them uncompressed).
  const structure: string[] = [];
  let figures = 0;
  let figuresWithoutAlt = 0;
  for (const m of text.matchAll(/<<(?:[^<>]|<(?!<)[^<>]*>|<<(?:[^<>]|<[^<>]*>)*>>)*?\/S\s*\/([A-Za-z0-9]+)(?:[^<>]|<(?!<)[^<>]*>|<<(?:[^<>]|<[^<>]*>)*>>)*?>>/g)) {
    if (!/\/P\s+\d+\s+0\s+R/.test(m[0]) && !/\/Type\s*\/StructElem/.test(m[0])) continue;
    const s = m[1];
    structure.push(s);
    if (s === "Figure") {
      figures++;
      if (!/\/Alt\s*(\((?!\))|<(?!>))/.test(m[0])) figuresWithoutAlt++;
    }
  }
  const headings = structure.filter((s) => /^H[1-6]$/.test(s)).map((s) => Number(s[1]));
  const headingSkips: string[] = [];
  let prev = 0;
  for (const h of headings) {
    if (h > prev + 1) headingSkips.push(`H${prev || "-"}→H${h}`);
    prev = h;
  }
  // A table: the TH count between it and the table before (Chromium closes a table's children before the Table itself).
  let tables = 0;
  let tablesWithoutTH = 0;
  let thSince = 0;
  for (const s of structure) {
    if (s === "TH") thSince++;
    if (s === "Table") {
      tables++;
      if (!thSince) tablesWithoutTH++;
      thSince = 0;
    }
  }
  // Link annotations: the last definition of each object number wins (an update may have redefined it).
  const linkDefs = new Map<string, string>();
  for (const m of text.matchAll(/(?:^|[\r\n])(\d+)\s+0\s+obj\s*<<\/Type\s*\/Annot\s*\/Subtype\s*\/Link/g)) linkDefs.set(m[1], objectDict(text, Number(m[1])) ?? "");
  const linksWithoutText = [...linkDefs.values()].filter((d) => !/\/Contents\s*[(<]/.test(d)).length;
  const r: PdfUaReport = {
    tagged: /\/MarkInfo\s*<<[^>]*\/Marked\s+true/.test(catalog),
    structTree: /\/StructTreeRoot\s+\d+\s+0\s+R/.test(catalog),
    lang: lang ? readPdfString(lang) : null,
    displayDocTitle: /\/DisplayDocTitle\s+true/.test(catalog),
    title: title ? readPdfString(title) : null,
    pdfUaPart,
    structure,
    figures,
    figuresWithoutAlt,
    headingSkips,
    tables,
    tablesWithoutTH,
    links: linkDefs.size,
    linksWithoutText,
    outline: /\/Outlines\s+\d+\s+0\s+R/.test(catalog),
    problems: [],
  };
  if (!r.tagged) r.problems.push("notTagged");
  if (!r.structTree) r.problems.push("noStructTree");
  if (!r.lang) r.problems.push("noLang");
  if (!r.displayDocTitle) r.problems.push("noDisplayDocTitle");
  if (!r.title) r.problems.push("noTitle");
  if (r.pdfUaPart !== 1) r.problems.push("noPdfUaId");
  if (figuresWithoutAlt) r.problems.push("figureWithoutAlt");
  if (headingSkips.length) r.problems.push("headingSkipped");
  if (tablesWithoutTH) r.problems.push("tableWithoutHeaders");
  if (linksWithoutText) r.problems.push("linkWithoutText");
  return r;
}
