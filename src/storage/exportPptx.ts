/**
 * Markdown → PowerPoint (.pptx, Office Open XML PresentationML).
 *
 * Builds a minimal but complete PPTX package with the zero-dep writer in
 * ./zip — [Content_Types].xml, _rels/.rels, docProps (core + app),
 * ppt/presentation.xml (+ rels), presProps / viewProps / tableStyles, one
 * slide master, one "Title and Content" layout, one theme, and one slide per
 * section (each with its own rels → layout).
 *
 * Slide splitting follows the Reveal export (`splitSlides` in
 * ./exportFormats): `---` thematic breaks when the deck uses them, otherwise
 * one slide per H1/H2 heading.
 *
 * Body content is plain text (inline Markdown syntax stripped): list items
 * become real PowerPoint bullets (ordered lists use auto-numbering, nesting
 * maps to indent levels), fenced code is monospace with no bullet, H3+ are
 * bold paragraphs, and lines in Hebrew/Arabic get right-to-left paragraphs.
 *
 * Not handled: images, tables (rendered as "a | b" text), speaker notes.
 */
import { zip } from "./zip";
import { splitSlides } from "./exportFormats";

export const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const CT = "application/vnd.openxmlformats-officedocument";

const XML_HEAD = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`;
const NS_APR = `xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"`;

/* 16:9 slide, EMU */
const SLIDE_W = 12192000;
const SLIDE_H = 6858000;
const TITLE_BOX = { x: 609600, y: 304800, w: 10972800, h: 1143000 };
const BODY_BOX = { x: 609600, y: 1600200, w: 10972800, h: 4800600 };

/** Escape text for XML text nodes / attributes, dropping illegal control chars. */
function esc(s: string): string {
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Strip inline Markdown syntax down to the visible text. */
export function stripInlineMarkdown(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // images → alt
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links → label
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2") // [[target|alias]]
    .replace(/\[\[([^\]]+)\]\]/g, "$1") // [[wikilink]]
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(\*|_)([^*_\s][^*_]*?)\1/g, "$2")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/==(.+?)==/g, "$1")
    .replace(/<\/?[a-zA-Z][^>]*>/g, "")
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, "$1")
    .trim();
}

export type PptxParagraph =
  | { kind: "text"; text: string; bold?: boolean }
  | { kind: "bullet"; text: string; level: number; ordered: boolean }
  | { kind: "code"; text: string };

export interface PptxSlide {
  title: string;
  body: PptxParagraph[];
}

/** Parse one slide's Markdown into a title + body paragraphs. */
function parseSlide(chunk: string, fallbackTitle: string): PptxSlide {
  const lines = chunk.replace(/\r\n?/g, "\n").split("\n");
  let title = "";
  const body: PptxParagraph[] = [];
  let inCode = false;
  let fence = "";
  for (const raw of lines) {
    const trimmed = raw.trim();
    const f = /^(```+|~~~+)/.exec(trimmed);
    if (f && (!inCode || trimmed.startsWith(fence))) {
      if (inCode) {
        inCode = false;
      } else {
        inCode = true;
        fence = f[1];
      }
      continue;
    }
    if (inCode) {
      body.push({ kind: "code", text: raw.replace(/\t/g, "    ") });
      continue;
    }
    if (!trimmed) continue;
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(trimmed);
    if (h) {
      const text = stripInlineMarkdown(h[2]);
      if (!title) title = text;
      else body.push({ kind: "text", text, bold: true });
      continue;
    }
    if (/^([-*_])\s*(\1\s*){2,}$/.test(trimmed)) continue; // stray rule
    if (/^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(trimmed)) continue; // table divider
    const li = /^(\s*)([-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/.exec(raw);
    if (li) {
      const indent = li[1].replace(/\t/g, "    ").length;
      body.push({
        kind: "bullet",
        text: stripInlineMarkdown(li[3]),
        level: Math.min(Math.floor(indent / 2), 4),
        ordered: /\d/.test(li[2]),
      });
      continue;
    }
    let text = trimmed.replace(/^>\s?/, "");
    if (/^\|.*\|$/.test(text)) {
      text = text
        .slice(1, -1)
        .split("|")
        .map((c) => c.trim())
        .join("  |  ");
    }
    text = stripInlineMarkdown(text);
    if (text) body.push({ kind: "text", text });
  }
  return { title: title || fallbackTitle, body };
}

/** Split Markdown into slides (title + body) using the shared splitter. */
export function markdownToSlides(md: string, deckTitle = "Presentation"): PptxSlide[] {
  const withoutFrontmatter = md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  const chunks = splitSlides(withoutFrontmatter);
  const slides = chunks.map((c, i) => parseSlide(c, i === 0 ? deckTitle : ""));
  return slides.length ? slides : [{ title: deckTitle, body: [] }];
}

const RTL_RE = /[֐-ࣿיִ-﷿ﹰ-﻿]/;

function rtlAttr(text: string): string {
  return RTL_RE.test(text) ? ` rtl="1" algn="r"` : "";
}

function run(text: string, extra = "", inner = ""): string {
  return `<a:r><a:rPr lang="en-US" dirty="0"${extra}>${inner}</a:rPr><a:t>${esc(text)}</a:t></a:r>`;
}

function paragraphXml(p: PptxParagraph): string {
  if (p.kind === "code") {
    return (
      `<a:p><a:pPr marL="0" indent="0"><a:buNone/></a:pPr>` +
      (p.text ? run(p.text, ` sz="1400"`, `<a:latin typeface="Courier New"/><a:cs typeface="Courier New"/>`) : "") +
      `<a:endParaRPr lang="en-US" sz="1400" dirty="0"/></a:p>`
    );
  }
  if (p.kind === "text") {
    return (
      `<a:p><a:pPr marL="0" indent="0"${rtlAttr(p.text)}><a:buNone/></a:pPr>` +
      run(p.text, p.bold ? ` b="1"` : "") +
      `</a:p>`
    );
  }
  const lvl = p.level > 0 ? ` lvl="${p.level}"` : "";
  const bu = p.ordered ? `<a:buFont typeface="+mj-lt"/><a:buAutoNum type="arabicPeriod"/>` : "";
  const ppr = bu || lvl || RTL_RE.test(p.text) ? `<a:pPr${lvl}${rtlAttr(p.text)}>${bu}</a:pPr>` : "";
  return `<a:p>${ppr}${run(p.text)}</a:p>`;
}

function xfrm(b: { x: number; y: number; w: number; h: number }): string {
  return `<a:xfrm><a:off x="${b.x}" y="${b.y}"/><a:ext cx="${b.w}" cy="${b.h}"/></a:xfrm>`;
}

const GRP_HEADER =
  `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
  `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>`;

function placeholder(
  id: number,
  name: string,
  ph: string,
  box: { x: number; y: number; w: number; h: number } | null,
  paragraphs: string,
  bodyPr = "<a:bodyPr/>",
): string {
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/>` +
    `<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>${ph}</p:nvPr></p:nvSpPr>` +
    `<p:spPr>${box ? xfrm(box) : ""}</p:spPr>` +
    `<p:txBody>${bodyPr}<a:lstStyle/>${paragraphs}</p:txBody></p:sp>`
  );
}

function slideXml(s: PptxSlide): string {
  const title = placeholder(
    2,
    "Title 1",
    `<p:ph type="title"/>`,
    null,
    s.title
      ? `<a:p>${RTL_RE.test(s.title) ? `<a:pPr${rtlAttr(s.title)}/>` : ""}${run(s.title)}</a:p>`
      : `<a:p><a:endParaRPr lang="en-US" dirty="0"/></a:p>`,
  );
  const shapes = [title];
  if (s.body.length) {
    shapes.push(
      placeholder(
        3,
        "Content Placeholder 2",
        `<p:ph idx="1"/>`,
        null,
        s.body.map(paragraphXml).join(""),
        `<a:bodyPr><a:normAutofit/></a:bodyPr>`,
      ),
    );
  }
  return (
    XML_HEAD +
    `<p:sld ${NS_APR}><p:cSld><p:spTree>${GRP_HEADER}${shapes.join("")}</p:spTree></p:cSld>` +
    `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
  );
}

function rels(list: { id: string; type: string; target: string }[]): string {
  return (
    XML_HEAD +
    `<Relationships xmlns="${NS_PKG_REL}">` +
    list.map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${r.target}"/>`).join("") +
    `</Relationships>`
  );
}

function themeXml(): string {
  const solid = `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>`;
  const ln = `<a:ln w="9525" cap="flat" cmpd="sng" algn="ctr">${solid}<a:prstDash val="solid"/></a:ln>`;
  const color = (n: string, hex: string) => `<a:${n}><a:srgbClr val="${hex}"/></a:${n}>`;
  return (
    XML_HEAD +
    `<a:theme xmlns:a="${NS_A}" name="Lumen"><a:themeElements>` +
    `<a:clrScheme name="Lumen">` +
    `<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>` +
    `<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>` +
    color("dk2", "1F1B3A") +
    color("lt2", "EEECF8") +
    color("accent1", "7C5CFF") +
    color("accent2", "2BB0A6") +
    color("accent3", "F2A541") +
    color("accent4", "E5566C") +
    color("accent5", "4A90E2") +
    color("accent6", "8BC34A") +
    color("hlink", "5B3FE0") +
    color("folHlink", "8E7CC3") +
    `</a:clrScheme>` +
    `<a:fontScheme name="Lumen">` +
    `<a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface="Arial"/></a:majorFont>` +
    `<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface="Arial"/></a:minorFont>` +
    `</a:fontScheme>` +
    `<a:fmtScheme name="Lumen">` +
    `<a:fillStyleLst>${solid}${solid}${solid}</a:fillStyleLst>` +
    `<a:lnStyleLst>${ln}${ln}${ln}</a:lnStyleLst>` +
    `<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>` +
    `<a:bgFillStyleLst>${solid}${solid}${solid}</a:bgFillStyleLst>` +
    `</a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`
  );
}

function levelStyle(lvl: number, size: number, bullet: string | null): string {
  const marL = 342900 + lvl * 400050;
  const bu = bullet
    ? `<a:buFont typeface="Arial"/><a:buChar char="${bullet}"/>`
    : `<a:buNone/>`;
  return (
    `<a:lvl${lvl + 1}pPr marL="${bullet ? marL : 0}" indent="${bullet ? -342900 : 0}" algn="l" rtl="0">` +
    `<a:spcBef><a:spcPts val="600"/></a:spcBef>${bu}` +
    `<a:defRPr sz="${size}" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill>` +
    `<a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl${lvl + 1}pPr>`
  );
}

function slideMasterXml(): string {
  const bodyLevels = [2800, 2400, 2000, 1800, 1800]
    .map((sz, i) => levelStyle(i, sz, i % 2 === 0 ? "•" : "–"))
    .join("");
  return (
    XML_HEAD +
    `<p:sldMaster ${NS_APR}><p:cSld>` +
    `<p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>` +
    `<p:spTree>${GRP_HEADER}` +
    placeholder(2, "Title Placeholder 1", `<p:ph type="title"/>`, TITLE_BOX,
      `<a:p><a:r><a:rPr lang="en-US"/><a:t>Title</a:t></a:r></a:p>`,
      `<a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="b"><a:normAutofit/></a:bodyPr>`) +
    placeholder(3, "Text Placeholder 2", `<p:ph type="body" idx="1"/>`, BODY_BOX,
      `<a:p><a:pPr lvl="0"/><a:r><a:rPr lang="en-US"/><a:t>Text</a:t></a:r></a:p>`,
      `<a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"><a:normAutofit/></a:bodyPr>`) +
    `</p:spTree></p:cSld>` +
    `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
    `<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>` +
    `<p:txStyles>` +
    `<p:titleStyle><a:lvl1pPr algn="l" rtl="0"><a:spcBef><a:spcPct val="0"/></a:spcBef><a:buNone/>` +
    `<a:defRPr sz="4000" b="1" kern="1200"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill>` +
    `<a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/><a:cs typeface="+mj-cs"/></a:defRPr></a:lvl1pPr></p:titleStyle>` +
    `<p:bodyStyle>${bodyLevels}</p:bodyStyle>` +
    `<p:otherStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr></p:otherStyle>` +
    `</p:txStyles></p:sldMaster>`
  );
}

function slideLayoutXml(): string {
  return (
    XML_HEAD +
    `<p:sldLayout ${NS_APR} type="obj" preserve="1"><p:cSld name="Title and Content"><p:spTree>${GRP_HEADER}` +
    placeholder(2, "Title 1", `<p:ph type="title"/>`, null, `<a:p><a:endParaRPr lang="en-US"/></a:p>`) +
    placeholder(3, "Content Placeholder 2", `<p:ph idx="1"/>`, null, `<a:p><a:endParaRPr lang="en-US"/></a:p>`) +
    `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`
  );
}

/** Build a valid .pptx (one slide per section) and return its bytes. */
export async function markdownToPptxBytes(md: string, title = "Presentation"): Promise<Uint8Array> {
  const slides = markdownToSlides(md, title);
  const n = slides.length;
  const slideNums = slides.map((_, i) => i + 1);

  const contentTypes =
    XML_HEAD +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/ppt/presentation.xml" ContentType="${CT}.presentationml.presentation.main+xml"/>` +
    `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="${CT}.presentationml.slideMaster+xml"/>` +
    `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="${CT}.presentationml.slideLayout+xml"/>` +
    slideNums
      .map((i) => `<Override PartName="/ppt/slides/slide${i}.xml" ContentType="${CT}.presentationml.slide+xml"/>`)
      .join("") +
    `<Override PartName="/ppt/theme/theme1.xml" ContentType="${CT}.theme+xml"/>` +
    `<Override PartName="/ppt/presProps.xml" ContentType="${CT}.presentationml.presProps+xml"/>` +
    `<Override PartName="/ppt/viewProps.xml" ContentType="${CT}.presentationml.viewProps+xml"/>` +
    `<Override PartName="/ppt/tableStyles.xml" ContentType="${CT}.presentationml.tableStyles+xml"/>` +
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
    `<Override PartName="/docProps/app.xml" ContentType="${CT}.extended-properties+xml"/>` +
    `</Types>`;

  const rootRels = rels([
    { id: "rId1", type: `${REL}/officeDocument`, target: "ppt/presentation.xml" },
    { id: "rId2", type: `${NS_PKG_REL}/metadata/core-properties`, target: "docProps/core.xml" },
    { id: "rId3", type: `${REL}/extended-properties`, target: "docProps/app.xml" },
  ]);

  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const core =
    XML_HEAD +
    `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
    `xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ` +
    `xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `<dc:title>${esc(title)}</dc:title><dc:creator>Lumen</dc:creator>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>` +
    `</cp:coreProperties>`;
  const app =
    XML_HEAD +
    `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ` +
    `xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">` +
    `<Application>Lumen</Application><PresentationFormat>Widescreen</PresentationFormat><Slides>${n}</Slides>` +
    `</Properties>`;

  // presentation.xml.rels: rId1 master, rId2..n+1 slides, then theme + props.
  const presRels = rels([
    { id: "rId1", type: `${REL}/slideMaster`, target: "slideMasters/slideMaster1.xml" },
    ...slideNums.map((i) => ({ id: `rId${i + 1}`, type: `${REL}/slide`, target: `slides/slide${i}.xml` })),
    { id: `rId${n + 2}`, type: `${REL}/theme`, target: "theme/theme1.xml" },
    { id: `rId${n + 3}`, type: `${REL}/presProps`, target: "presProps.xml" },
    { id: `rId${n + 4}`, type: `${REL}/viewProps`, target: "viewProps.xml" },
    { id: `rId${n + 5}`, type: `${REL}/tableStyles`, target: "tableStyles.xml" },
  ]);
  const presentation =
    XML_HEAD +
    `<p:presentation ${NS_APR} saveSubsetFonts="1">` +
    `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
    `<p:sldIdLst>${slideNums.map((i) => `<p:sldId id="${255 + i}" r:id="rId${i + 1}"/>`).join("")}</p:sldIdLst>` +
    `<p:sldSz cx="${SLIDE_W}" cy="${SLIDE_H}"/><p:notesSz cx="6858000" cy="9144000"/>` +
    `</p:presentation>`;

  const presProps = XML_HEAD + `<p:presentationPr ${NS_APR}/>`;
  const viewProps = XML_HEAD + `<p:viewPr ${NS_APR}><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`;
  const tableStyles =
    XML_HEAD + `<a:tblStyleLst xmlns:a="${NS_A}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`;

  const masterRels = rels([
    { id: "rId1", type: `${REL}/slideLayout`, target: "../slideLayouts/slideLayout1.xml" },
    { id: "rId2", type: `${REL}/theme`, target: "../theme/theme1.xml" },
  ]);
  const layoutRels = rels([
    { id: "rId1", type: `${REL}/slideMaster`, target: "../slideMasters/slideMaster1.xml" },
  ]);
  const slideRels = rels([
    { id: "rId1", type: `${REL}/slideLayout`, target: "../slideLayouts/slideLayout1.xml" },
  ]);

  return zip([
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "_rels/.rels", data: rootRels },
    { name: "docProps/core.xml", data: core },
    { name: "docProps/app.xml", data: app },
    { name: "ppt/presentation.xml", data: presentation },
    { name: "ppt/_rels/presentation.xml.rels", data: presRels },
    { name: "ppt/presProps.xml", data: presProps },
    { name: "ppt/viewProps.xml", data: viewProps },
    { name: "ppt/tableStyles.xml", data: tableStyles },
    { name: "ppt/theme/theme1.xml", data: themeXml() },
    { name: "ppt/slideMasters/slideMaster1.xml", data: slideMasterXml() },
    { name: "ppt/slideMasters/_rels/slideMaster1.xml.rels", data: masterRels },
    { name: "ppt/slideLayouts/slideLayout1.xml", data: slideLayoutXml() },
    { name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels", data: layoutRels },
    ...slides.flatMap((s, i) => [
      { name: `ppt/slides/slide${i + 1}.xml`, data: slideXml(s) },
      { name: `ppt/slides/_rels/slide${i + 1}.xml.rels`, data: slideRels },
    ]),
  ]);
}
