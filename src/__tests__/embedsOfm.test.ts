/**
 * Plan 4.7, step 5: our `![[embed]]` parsing against Quartz's ofm.ts.
 *
 * The plan asked for a port of Quartz's Obsidian-flavoured-Markdown
 * transformer. Lumen keeps its own remark implementation (renderer/
 * embeds.ts, remarkObsidian.ts: workspace resolution, depth and cycle
 * guards, live updates, which ofm.ts does not have), and this file holds it
 * to ofm.ts's wikilink grammar instead: the regexes below are ported
 * verbatim from jackyzha0/quartz, branch v4 @ d25a6eabf96751ffca56f8a8139272def7a65041,
 * quartz/plugins/transformers/ofm.ts (MIT, © 2021 jackyzha0) — wikilinkRegex,
 * wikilinkImageEmbedRegex and the embed classification by extension.
 *
 * Every case must parse to the same target, fragment and kind, except the
 * ones listed in DIVERGENT, where Lumen follows Obsidian deliberately.
 */
import { describe, it, expect } from "vitest";
import { createEmbedContext, embedKind, embeddedTexts, missingEmbedded, parseEmbed } from "../renderer/embeds";
import { MEDIA_EXT, VIDEO_EXT } from "../media/mediaExt";

// ── the port (ofm.ts lines 119–121, 146–149, 222–262) ──
const wikilinkRegex = /!?\[\[([^[\]|#\\]+)?(#+[^[\]|#\\]+)?(\\?\|[^[\]#]*)?\]\]/;
const wikilinkImageEmbedRegex = /^(?<alt>(?!^\d*x?\d*$).*?)?(\|?\s*?(?<width>\d+)(x(?<height>\d+))?)?$/;
const QUARTZ_IMAGE = [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".svg", ".webp"];
const QUARTZ_VIDEO = [".mp4", ".webm", ".ogv", ".mov", ".mkv"];
const QUARTZ_AUDIO = [".mp3", ".webm", ".wav", ".m4a", ".ogg", ".3gp", ".flac"];

interface Parsed {
  kind: "note" | "image" | "video" | "audio" | "pdf";
  note: string;
  fragment: string | null;
  alias: string | null;
  width?: string;
  height?: string;
}

function quartz(src: string): Parsed | null {
  const m = wikilinkRegex.exec(src);
  if (!m || m.index !== 0 || m[0].length !== src.length || !src.startsWith("!")) return null;
  const [, rawFp, rawHeader, rawAlias] = m;
  const fp = rawFp?.trim() ?? "";
  const anchor = rawHeader?.trim() ?? "";
  const alias = rawAlias?.slice(1).trim();
  const ext = (/\.[^./]+$/.exec(fp)?.[0] ?? "").toLowerCase();
  // ofm.ts tests the extensions in this order: image, video, audio, pdf, else a transclusion.
  const kind: Parsed["kind"] = QUARTZ_IMAGE.includes(ext) ? "image" : QUARTZ_VIDEO.includes(ext) ? "video" : QUARTZ_AUDIO.includes(ext) ? "audio" : ext === ".pdf" ? "pdf" : "note";
  const out: Parsed = { kind, note: fp, fragment: anchor.replace(/^#+/, "") || null, alias: alias?.replace(/^\\?\|/, "") || null };
  if (kind === "image") {
    const g = wikilinkImageEmbedRegex.exec(alias ?? "")?.groups;
    out.width = g?.width ?? "auto";
    out.height = g?.height ?? "auto";
  }
  return out;
}

// ── ours, as the renderer and the source scans see it ──
const SIZE = /(?:^|\|)\s*(\d+)(?:x(\d+))?\s*$/;
function lumen(src: string): Parsed {
  const p = parseEmbed(src.slice(3, -2));
  const kind: Parsed["kind"] = MEDIA_EXT.test(p.note) ? (VIDEO_EXT.test(p.note) ? "video" : "audio") : embedKind(p.note);
  const out: Parsed = { kind, note: p.note, fragment: p.fragment, alias: p.alias };
  if (kind === "image") {
    const m = SIZE.exec(p.alias ?? "");
    out.width = m?.[1] ?? "auto";
    out.height = m?.[2] ?? "auto";
  }
  return out;
}

const SAME = [
  "![[Note]]",
  "![[Note#Heading]]",
  "![[Note#^block-1]]",
  "![[Note|alias]]",
  "![[Note#Heading|alias]]",
  "![[ Note ]]",
  "![[Note.md]]",
  "![[folder/sub/Note]]",
  "![[#Heading]]",
  "![[#^block]]",
  "![[פתק עברי]]",
  "![[פתק עברי#כותרת]]",
  "![[פתק#^בלוק-1]]",
  "![[img.png]]",
  "![[img.png|300]]",
  "![[img.png|300x200]]",
  "![[img.png|alt text|300]]",
  "![[img.png|תמונה|120x80]]",
  "![[a/b/img.PNG]]",
  "![[pic.JPEG]]",
  "![[diagram.svg]]",
  "![[doc.pdf]]",
  "![[doc.pdf#page=3]]",
  "![[clip.mp4]]",
  "![[clip.mov]]",
  "![[clip.ogv]]",
  "![[movie.mkv]]",
  "![[song.mp3]]",
  "![[voice.m4a]]",
  "![[take.wav]]",
  "![[take.flac]]",
  "![[file.ogg]]",
  // the bar escaped, as inside a table cell
  "![[Note\\|alias]]",
  "![[img.png\\|300]]",
  "![[Note#Heading\\|alias]]",
];

/** Where Lumen parts from ofm.ts on purpose (Obsidian's behaviour), with why. */
const DIVERGENT: Record<string, { why: string; lumen: Partial<Parsed>; quartz: Partial<Parsed> | null }> = {
  "![[Note#H1#H2]]": { why: "Obsidian embeds a nested heading by its path; ofm.ts's anchor group stops at the second #", lumen: { note: "Note", fragment: "H1#H2" }, quartz: null },
  "![[rec.webm]]": { why: "the app records voice notes as .webm, so .webm is audio here; ofm.ts tests video first", lumen: { kind: "audio" }, quartz: { kind: "video" } },
  "![[x.avif]]": { why: "Obsidian shows AVIF images; ofm.ts's list predates it", lumen: { kind: "image" }, quartz: { kind: "note" } },
  "![[x.apng]]": { why: "animated PNG is an image in Obsidian; not in ofm.ts's list", lumen: { kind: "image" }, quartz: { kind: "note" } },
};

describe("4.7 embeds vs Quartz ofm.ts (wikilink grammar, MIT port)", () => {
  it(`parses ${SAME.length} embeds to the same target, fragment, alias, kind and image size`, () => {
    const bad = SAME.map((s) => ({ s, q: quartz(s), l: lumen(s) })).filter(({ q, l }) => JSON.stringify(q) !== JSON.stringify(l));
    expect(bad).toEqual([]);
  });

  it("parts from ofm.ts only where Obsidian does (each case named, with its reason)", () => {
    for (const [s, d] of Object.entries(DIVERGENT)) {
      expect(d.why.length, s).toBeGreaterThan(10);
      expect(lumen(s), s).toMatchObject(d.lumen);
      const q = quartz(s);
      if (d.quartz === null) expect(q, s).toBeNull();
      else expect(q, s).toMatchObject(d.quartz);
    }
  });

  it("an embed with an escaped bar in a table resolves to its note in the source scans (live updates, loading what it embeds)", () => {
    const md = "| embed |\n|---|\n| ![[Note\\|alias]] |\n| ![[Other#Part\\|x]] |\n";
    const ctx = createEmbedContext({ hostPath: "host.md", hostText: md, files: [{ path: "Note.md", content: "the note" }, { path: "Other.md" }], notice: () => ({ type: "text", value: "" }) as never });
    expect(embeddedTexts(md, ctx)).toEqual(["the note"]);
    expect(missingEmbedded(md, ctx)).toEqual(["Other.md"]);
  });

  it("an .mkv embed is a video, not a note that is not found", () => {
    expect(MEDIA_EXT.test("movie.mkv")).toBe(true);
    expect(VIDEO_EXT.test("movie.MKV")).toBe(true);
  });
});
