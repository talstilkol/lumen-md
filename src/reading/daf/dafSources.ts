/**
 * What goes on the page (W13.R11): a main text and up to two commentaries.
 *
 *  - Any note: its own ```commentary inner``` and ```commentary outer```
 *    blocks are the commentaries (an optional title after the side:
 *    ```commentary inner רש״י```), and the rest of the note is the main text.
 *  - A Sefaria source note (W5.1, `Sources/Sefaria/<ref>.md`): the main text
 *    is its Hebrew version, and the commentaries are the ones the user chose
 *    in the vault — by default `Sources/Sefaria/Rashi on <ref>.md` and
 *    `Tosafot on <ref>.md` when they exist. No request is made for them:
 *    the page shows what the vault holds.
 *
 * Text is shown as plain paragraphs (Markdown marks removed): the page is a
 * reading view, the note is never changed.
 */
import { parseSourceNote } from "../../sources/sefaria/store";

export interface DafText {
  title: string;
  paragraphs: string[];
}

export interface DafContent {
  main: DafText | null;
  inner: DafText | null;
  outer: DafText | null;
  /** The Sefaria reference, for a source note. */
  ref: string | null;
  /** The amud, when the reference names one. */
  amud: "a" | "b" | null;
}

const FENCE = /^(```|~~~)\s*commentary\s+(inner|outer)\b[ \t]*([^\n]*)\n([\s\S]*?)\n\1[ \t]*$/gm;

/** Markdown to plain paragraphs: blank lines split, marks and link targets dropped. */
export function plainParagraphs(md: string): string[] {
  return md
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((p) =>
      p
        .replace(/^#{1,6}\s+/gm, "")
        .replace(/^>\s?/gm, "")
        .replace(/^\s*([-*+]|\d+[.)])\s+/gm, "")
        .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
        .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
        .replace(/\[\[([^\]]+)\]\]/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/(\*\*|__|\*|_|~~|`)(.+?)\1/g, "$2")
        .replace(/\s*\n\s*/g, " ")
        .trim(),
    )
    .filter(Boolean);
}

/** The commentary blocks of a note, and the note without them. */
export function commentaryBlocks(md: string): { rest: string; inner: DafText | null; outer: DafText | null } {
  let inner: DafText | null = null;
  let outer: DafText | null = null;
  const rest = md.replace(FENCE, (_m, _f, side: string, title: string, body: string) => {
    const t: DafText = { title: title.trim(), paragraphs: plainParagraphs(body) };
    if (side === "inner") inner = inner ? { title: inner.title || t.title, paragraphs: [...inner.paragraphs, ...t.paragraphs] } : t;
    else outer = outer ? { title: outer.title || t.title, paragraphs: [...outer.paragraphs, ...t.paragraphs] } : t;
    return "";
  });
  return { rest, inner, outer };
}

/** The note's first heading, else "". */
function firstHeading(md: string): string {
  return /^#\s+(.+)$/m.exec(md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, ""))?.[1]?.trim() ?? "";
}

/** The page for a note: a Sefaria source note's Hebrew text, or the note with its commentary blocks. */
export function dafFromNote(md: string, name = ""): DafContent {
  const source = parseSourceNote(md.replace(/\r\n/g, "\n"));
  if (source) {
    const he = source.versions.find((v) => v.free && v.text?.length && v.language === "he") ?? source.versions.find((v) => v.free && v.text?.length);
    const ref = source.ref.tref;
    return {
      main: he?.text ? { title: source.heRef ?? source.ref.he, paragraphs: he.text.map((s) => plainParagraphs(s).join(" ")).filter(Boolean) } : null,
      inner: null,
      outer: null,
      ref,
      amud: amudOfRef(ref),
    };
  }
  const { rest, inner, outer } = commentaryBlocks(md);
  const heading = firstHeading(rest);
  const paragraphs = plainParagraphs(rest);
  // The heading is the page's title, not its first line of text.
  if (heading && paragraphs[0] === heading) paragraphs.shift();
  const amudFm = /^amud:\s*["']?(a|b|א|ב)["']?\s*$/m.exec(/^---\r?\n([\s\S]*?)\r?\n---/.exec(md)?.[1] ?? "")?.[1];
  return {
    main: paragraphs.length ? { title: heading || name, paragraphs } : null,
    inner,
    outer,
    ref: null,
    amud: amudFm === "b" || amudFm === "ב" ? "b" : amudFm ? "a" : null,
  };
}

/** A commentary from another note (a saved source note, or any note): its Hebrew text, else its body. */
export function commentaryFromNote(md: string, fallbackTitle: string): DafText | null {
  const source = parseSourceNote(md.replace(/\r\n/g, "\n"));
  if (source) {
    const v = source.versions.find((x) => x.free && x.text?.length && x.language === "he") ?? source.versions.find((x) => x.free && x.text?.length);
    return v?.text ? { title: fallbackTitle, paragraphs: v.text.map((s) => plainParagraphs(s).join(" ")).filter(Boolean) } : null;
  }
  const heading = firstHeading(md);
  const paragraphs = plainParagraphs(md);
  if (heading && paragraphs[0] === heading) paragraphs.shift();
  return paragraphs.length ? { title: heading || fallbackTitle, paragraphs } : null;
}

/** The vault paths looked at first for a source note's commentaries. */
export function defaultCommentaryPaths(ref: string): { inner: string; outer: string } {
  return { inner: `Sources/Sefaria/Rashi on ${ref}.md`, outer: `Sources/Sefaria/Tosafot on ${ref}.md` };
}

/** "Berakhot 2a" → a; "Berakhot 2b" → b; anything else → null. */
export function amudOfRef(ref: string): "a" | "b" | null {
  const m = /\d+([ab])(?:[:.]\d+(?:-\d+)?)?\s*$/i.exec(ref.trim());
  return m ? (m[1].toLowerCase() as "a" | "b") : null;
}
