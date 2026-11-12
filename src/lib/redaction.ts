/**
 * True redaction for exports (plan W5.11, journalist mode, part 2).
 *
 * Text the author marks with `<redact>…</redact>` stays in the note, where
 * the author can see it, and is *removed* from every export: the PDF, DOCX,
 * HTML and Markdown files get a fixed placeholder (█████) instead of the
 * text. Nothing is covered by a black box over text that is still there, so
 * copying, `pdftotext` or unzipping the DOCX finds nothing.
 *
 * Rules, all of which fail closed (when in doubt, more is removed):
 *   - The placeholder has the same length whatever was removed, so its size
 *     tells nothing about a name's length.
 *   - A mark is what the preview takes for a `redact` element: the HTML
 *     tokenizer's rules (`redactMarks`), so `<redact class="x">`,
 *     `<redact\tid=1>` and `<redact/>` are marks too (review F-8). A tag cut
 *     off by the end of the note opens a mark.
 *   - Marks nest; the outermost pair wins. A `<redact>` that is never closed
 *     removes everything to the end of the note.
 *   - "Redact selection" over text that already holds marks merges them into
 *     one mark over the whole selection, and leaves every passage outside it
 *     as covered as it was (review F-9).
 *   - Marks count inside code blocks and code spans too: a secret in a code
 *     block is still a secret.
 *   - Hidden text that a reader of the file could find is removed too: HTML
 *     comments (`<!-- … -->`, an unclosed one runs to the end) and Obsidian
 *     comments (`%% … %%`), except inside code, where they are code.
 *   - Photos inlined as `data:` URLs, under any label (the bytes decide, as in
 *     a browser), lose their GPS, time and device
 *     metadata, unless the user keeps it (Settings, the same switch as for
 *     photos added to a note). A photo whose metadata can't be removed (it
 *     can't be parsed, and there is no canvas to re-encode it) is replaced by
 *     an empty image: it never leaves as it was (review 12.11).
 */

import { cleanDataUrls, cleanDataUrlsAsync, cleanImageBytes, keepImageMetadata, WITHHELD_IMAGE } from "./imageMetadata";

export { WITHHELD_IMAGE };

/** What replaces each redacted passage. Fixed length on purpose. */
export const REDACTED = "█████";

export const REDACT_OPEN = "<redact>";
export const REDACT_CLOSE = "</redact>";

/** A redaction mark in the text: `[index, end)` is the whole tag. */
export interface RedactMark {
  index: number;
  end: number;
  close: boolean;
}

/** The HTML tokenizer's whitespace (CR included: the input stream turns it into LF). */
const isSpace = (c: string) => c === " " || c === "\t" || c === "\n" || c === "\f" || c === "\r";

/**
 * Every redaction mark in `text`, in order — the one parser for the export
 * and for what the preview shades. It follows the HTML tokenizer that builds
 * the preview's `redact` elements (rehype-raw / parse5, the same rules as a
 * browser's): `<` or `</`, the name `redact` in any ASCII case, then
 * whitespace, `/` or `>`; attributes up to the `>` that ends the tag, where a
 * `>` inside a quoted value does not end it. `<redact/>` opens a mark (HTML
 * ignores the slash on an element that is not void). A tag that the end of
 * the text cuts off runs to the end: as an opening mark it removes the rest
 * (fail closed). `</ redact>` is not a closing mark (HTML reads it as a
 * comment), so the mark before it stays open.
 */
export function redactMarks(text: string): RedactMark[] {
  const out: RedactMark[] = [];
  for (let i = text.indexOf("<"); i >= 0; i = text.indexOf("<", i + 1)) {
    const close = text[i + 1] === "/";
    const nameAt = i + (close ? 2 : 1);
    if (text.slice(nameAt, nameAt + 6).replace(/[A-Z]/g, (c) => c.toLowerCase()) !== "redact") continue;
    const after = text[nameAt + 6];
    if (after !== undefined && !isSpace(after) && after !== "/" && after !== ">") continue;
    // The tag's attributes, as the tokenizer reads them, up to the `>` that ends it.
    let j = nameAt + 6;
    let quote: string | null = null;
    let valueStart = false;
    let end = text.length;
    for (; j < text.length; j++) {
      const c = text[j];
      if (quote) {
        if (c === quote) quote = null;
        continue;
      }
      if (c === ">") {
        end = j + 1;
        break;
      }
      if (valueStart && (c === '"' || c === "'")) quote = c;
      if (c === "=") valueStart = true;
      else if (!isSpace(c)) valueStart = false;
    }
    out.push({ index: i, end, close });
    i = end - 1;
  }
  return out;
}

/**
 * Wrap `text` in redaction marks (the editor's "Redact selection"). Marks
 * already in the selection merge into the new one, which covers all of it;
 * the closing and opening marks after it keep every passage before and after
 * the selection covered as it was (review F-9).
 */
export function wrapRedaction(text: string): string {
  let inner = "";
  let last = 0;
  // The selection's own marks, reduced: closes of marks opened before it, then opens of marks that run past it.
  let closes = 0;
  let opens = 0;
  for (const m of redactMarks(text)) {
    inner += text.slice(last, m.index);
    last = m.end;
    if (!m.close) opens++;
    else if (opens > 0) opens--;
    else closes++;
  }
  inner += text.slice(last);
  return REDACT_OPEN + inner + REDACT_CLOSE.repeat(1 + closes) + REDACT_OPEN.repeat(opens);
}

/** Does the note have any redaction mark? */
export function hasRedactions(markdown: string): boolean {
  return redactMarks(markdown).length > 0;
}

/** The marked passages, as written (for the author's own review before an export). */
export function redactedPassages(markdown: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (const m of redactMarks(markdown)) {
    if (!m.close) {
      if (depth === 0) start = m.end;
      depth++;
    } else if (depth > 0) {
      depth--;
      if (depth === 0) out.push(markdown.slice(start, m.index));
    }
  }
  if (depth > 0) out.push(markdown.slice(start));
  return out;
}

/** Remove every marked passage; returns the text and how many passages went. */
export function removeRedacted(markdown: string): { text: string; count: number } {
  let out = "";
  let depth = 0;
  let last = 0;
  let count = 0;
  for (const m of redactMarks(markdown)) {
    if (!m.close) {
      if (depth === 0) {
        out += markdown.slice(last, m.index);
        count++;
      }
      depth++;
    } else if (depth > 0) {
      depth--;
      if (depth === 0) out += REDACTED;
    } else {
      // A stray closing mark: drop the mark, keep the text before it.
      out += markdown.slice(last, m.index);
    }
    last = m.end;
  }
  if (depth > 0) return { text: out + REDACTED, count };
  return { text: out + markdown.slice(last), count };
}

/** Code fence opener/closer (``` or ~~~, up to three spaces in). */
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/**
 * Remove HTML and Obsidian comments outside code. An HTML comment that is
 * never closed runs to the end of the note (fail closed); `%%` needs a pair.
 */
export function removeHiddenComments(markdown: string): string {
  const lines = markdown.split("\n");
  // Mark which characters are code (fenced blocks and inline code spans).
  let open: { ch: string; len: number } | null = null;
  const segments: { text: string; code: boolean }[] = [];
  const push = (text: string, code: boolean) => {
    const prev = segments[segments.length - 1];
    if (prev && prev.code === code) prev.text += text;
    else segments.push({ text, code });
  };
  lines.forEach((line, i) => {
    const nl = i < lines.length - 1 ? "\n" : "";
    const m = FENCE.exec(line);
    if (open) {
      if (m && m[1][0] === open.ch && m[1].length >= open.len && m[2].trim() === "") open = null;
      push(line + nl, true);
      return;
    }
    if (m && !(m[1][0] === "`" && m[2].includes("`"))) {
      open = { ch: m[1][0], len: m[1].length };
      push(line + nl, true);
      return;
    }
    // Inline code spans: a run of N backticks closed by the same run.
    let at = 0;
    const span = /(`+)([\s\S]*?[^`])\1(?!`)/g;
    for (let s = span.exec(line); s; s = span.exec(line)) {
      push(line.slice(at, s.index), false);
      push(s[0], true);
      at = s.index + s[0].length;
    }
    push(line.slice(at) + nl, false);
  });

  let out = "";
  let inHtml = false;
  let inObsidian = false;
  for (const seg of segments) {
    if (seg.code) {
      if (!inHtml && !inObsidian) out += seg.text;
      continue;
    }
    let s = seg.text;
    while (s.length) {
      if (inHtml) {
        const end = s.indexOf("-->");
        if (end < 0) {
          s = "";
          break;
        }
        s = s.slice(end + 3);
        inHtml = false;
        continue;
      }
      if (inObsidian) {
        const end = s.indexOf("%%");
        if (end < 0) {
          s = "";
          break;
        }
        s = s.slice(end + 2);
        inObsidian = false;
        continue;
      }
      const h = s.indexOf("<!--");
      const o = s.indexOf("%%");
      if (h < 0 && o < 0) {
        out += s;
        break;
      }
      if (h >= 0 && (o < 0 || h < o)) {
        out += s.slice(0, h);
        s = s.slice(h + 4);
        inHtml = true;
      } else {
        out += s.slice(0, o);
        s = s.slice(o + 2);
        inObsidian = true;
      }
    }
  }
  // An Obsidian comment that never closed was not a comment: put it back.
  if (inObsidian) return removeHiddenCommentsKeepingUnclosedPercent(markdown);
  return out;
}

/** Second pass for a note with an odd `%%`: the last one is literal text. */
function removeHiddenCommentsKeepingUnclosedPercent(markdown: string): string {
  const last = markdown.lastIndexOf("%%");
  const sentinel = "\u0000LUMEN-PCT\u0000";
  const swapped = markdown.slice(0, last) + sentinel + markdown.slice(last + 2);
  return removeHiddenComments(swapped).split(sentinel).join("%%");
}

/**
 * Photos inlined in the note as data: URLs, without their metadata, judged by
 * their bytes whatever their label (review 4): see `cleanDataUrls`. One that
 * can't be cleaned is withheld: replaced by WITHHELD_IMAGE.
 */
export function cleanInlineImages(markdown: string): { text: string; cleaned: number; withheld: number } {
  return cleanDataUrls(markdown);
}

/** The async form: a photo that can't be stripped in place is re-encoded through a canvas first, withheld only when that fails. */
export async function cleanInlineImagesAsync(markdown: string): Promise<{ text: string; cleaned: number; withheld: number }> {
  return cleanDataUrlsAsync(markdown);
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** `![alt](lumen-asset-…)` and `![[lumen-asset-…]]`: photos stored in the vault. */
const ASSET_IMAGE = /!\[([^\]\n]*)\]\(\s*<?(?:\.\/)?(lumen-asset-[^\s)>]+\.(?:jpe?g|png|webp))>?(?:\s+"[^"\n]*")?\s*\)|!\[\[\s*(?:\.\/)?(lumen-asset-[^\]|#\n]+\.(?:jpe?g|png|webp))\s*(?:\|[^\]\n]*)?\]\]/gi;

const MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

/**
 * Photos stored in the vault, inlined as clean data: URLs, so an exported
 * PDF or HTML file never carries the original's metadata (Chromium writes a
 * JPEG into a PDF as it is, EXIF and all). A photo that can't be read is left
 * as a link.
 */
export async function inlineVaultImages(markdown: string, read: (name: string) => Promise<Blob>): Promise<{ text: string; inlined: number; withheld: number }> {
  const found = [...markdown.matchAll(ASSET_IMAGE)];
  if (!found.length) return { text: markdown, inlined: 0, withheld: 0 };
  const urls = new Map<string, string | null>();
  let withheld = 0;
  for (const m of found) {
    const name = m[2] ?? m[3];
    if (urls.has(name)) continue;
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await (await read(name)).arrayBuffer());
    } catch {
      urls.set(name, null); // why: not in the vault: left as a link, nothing to leak
      continue;
    }
    const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
    const r = await cleanImageBytes(bytes, MIME[ext]);
    if (!r) {
      // Fail closed: the renderer would otherwise load the original file into the PDF.
      withheld++;
      urls.set(name, WITHHELD_IMAGE);
    } else urls.set(name, `data:${r.type};base64,${toBase64(r.bytes)}`);
  }
  let inlined = 0;
  const text = markdown.replace(ASSET_IMAGE, (whole, alt: string | undefined, a: string | undefined, b: string | undefined) => {
    const url = urls.get((a ?? b) as string);
    if (!url) return whole;
    inlined++;
    return `![${alt ?? ""}](${url})`;
  });
  return { text, inlined, withheld };
}

export interface ExportPrepOptions {
  /** Read a vault photo, to inline it clean (PDF and HTML exports). */
  readAsset?: (name: string) => Promise<Blob>;
  /** Keep photos' metadata (Settings). Defaults to the user's choice. */
  keepImageMetadata?: boolean;
}

export interface ExportPrepReport {
  /** Marked passages removed. */
  redacted: number;
  /** Inline photos that lost metadata. */
  imagesCleaned: number;
  /** Photos replaced by an empty image: their metadata could not be removed. */
  imagesWithheld: number;
}

/**
 * The same for a synchronous exporter (`lumen convert`, the API server):
 * marked passages and hidden comments removed, inline photos cleaned in
 * place or withheld (no canvas to re-encode with there).
 */
export function prepareForExportSync(markdown: string, opts: Pick<ExportPrepOptions, "keepImageMetadata"> = {}): string {
  const text = removeHiddenComments(removeRedacted(markdown).text);
  return (opts.keepImageMetadata ?? keepImageMetadata()) ? text : cleanInlineImages(text).text;
}

/**
 * The text an exporter gets: marked passages and hidden comments removed,
 * photos without metadata. Every export path calls this; the note itself is
 * never changed.
 */
export async function prepareForExport(markdown: string, opts: ExportPrepOptions = {}): Promise<{ text: string; report: ExportPrepReport }> {
  const { text: removed, count } = removeRedacted(markdown);
  let text = removeHiddenComments(removed);
  let imagesCleaned = 0;
  let imagesWithheld = 0;
  const keep = opts.keepImageMetadata ?? keepImageMetadata();
  if (!keep) {
    if (opts.readAsset) {
      const r = await inlineVaultImages(text, opts.readAsset);
      text = r.text;
      imagesCleaned += r.inlined - r.withheld;
      imagesWithheld += r.withheld;
    }
    const c = await cleanInlineImagesAsync(text);
    text = c.text;
    imagesCleaned += c.cleaned;
    imagesWithheld += c.withheld;
  }
  return { text, report: { redacted: count, imagesCleaned, imagesWithheld } };
}
