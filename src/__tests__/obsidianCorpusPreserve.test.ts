/**
 * W10.E47 (W4.30) — the WYSIWYG save path over the real Obsidian corpus, the
 * part that needs no editor: the source-preserving save (sourcePreserve.ts,
 * wysiwygSource.ts) with Milkdown's serializer stood in by the same
 * remark-stringify it is built on, with the editor's own stringify options
 * (markdownSerialize.mjs roundTripSafe + wysiwygWikiLinks keepWikiLinks).
 * The run through real Milkdown is obsidianCorpusWysiwyg.test.ts.
 *
 * For every note of fixtures/obsidian-corpus (manifest.json, hashes checked
 * in obsidianCorpus.test.ts):
 * - unedited: the save is byte-identical, even though the stand-in serializer
 *   rewrites most notes (bullets, emphasis, tables, escapes, wikilinks …);
 * - one character typed at the end of the last paragraph: only that block
 *   changes, every other block keeps its source bytes and the frontmatter
 *   is untouched.
 * The same notes saved by Windows (CRLF) are run too.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { toMarkdown, type Options } from "mdast-util-to-markdown";
import { gfmToMarkdown } from "mdast-util-gfm";
import { mathToMarkdown } from "mdast-util-math";
import type { Root, RootContent, Text } from "mdast";
import { splitMarkdownBlocks, wysiwygSourcePreserver } from "../editor/wysiwygSource";
import { splitFrontmatter } from "../editor/wysiwygFrontmatter";
import { roundTripSafe } from "../editor/markdownSerialize.mjs";
import { keepWikiLinks, protectEscapedWikiLinks } from "../editor/wysiwygWikiLinks";

const root = join(__dirname, "fixtures", "obsidian-corpus");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")) as {
  vaults: Array<{ id: string; files: Array<{ path: string }> }>;
};
const notes = manifest.vaults.flatMap((v) =>
  v.files.filter((f) => f.path.endsWith(".md")).map((f) => ({ name: `${v.id}/${f.path}`, text: readFileSync(join(root, v.id, f.path), "utf8") })),
);

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const options: Options = roundTripSafe(keepWikiLinks({ extensions: [gfmToMarkdown(), mathToMarkdown()] })) as Options;
const parse = (md: string) => parser.parse(protectEscapedWikiLinks(md)) as Root;
const serialize = (tree: Root) => toMarkdown(tree, options);

/** The last text node of the last paragraph (where mdRoundTrip.test.ts types its "Z"). */
function lastParagraphText(tree: Root): Text | null {
  let found: Text | null = null;
  const walk = (n: Root | RootContent, inParagraph: boolean) => {
    if (n.type === "text" && inParagraph) found = n;
    if ("children" in n) for (const c of n.children as RootContent[]) walk(c, inParagraph || n.type === "paragraph");
  };
  walk(tree, false);
  return found;
}

function firstDiff(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return `line ${a.slice(0, i).split("\n").length}: ${JSON.stringify(a.slice(Math.max(0, i - 20), i + 30))} → ${JSON.stringify(b.slice(Math.max(0, i - 20), i + 30))}`;
}

/** Original blocks found, in order, in the saved text (as mdRoundTrip.test.ts counts them). */
function keptBlocks(original: string, saved: string): { kept: number; total: number } {
  let at = 0;
  let kept = 0;
  const blocks = splitMarkdownBlocks(original);
  for (const b of blocks) {
    const i = saved.indexOf(original.slice(b.start, b.end), at);
    if (i >= 0) {
      kept++;
      at = i + (b.end - b.start);
    }
  }
  return { kept, total: blocks.length };
}

interface Row {
  name: string;
  rewritten: boolean;
  unedited: string;
  edited: string;
}

function roundTrip(name: string, text: string): Row {
  const { fm, body } = splitFrontmatter(text);
  const loaded = serialize(parse(body));
  const preserver = wysiwygSourcePreserver(body, loaded);
  const row: Row = { name, rewritten: loaded !== body, unedited: "", edited: "" };
  const unedited = fm + preserver.restore(loaded);
  if (unedited !== text) row.unedited = firstDiff(text, unedited);

  const tree = parse(body);
  const t = lastParagraphText(tree);
  if (t) {
    t.value += "Z";
    const saved = preserver.restore(serialize(tree));
    const { kept, total } = keptBlocks(body, saved);
    const lead = body.slice(0, splitMarkdownBlocks(body)[0]?.start ?? 0);
    if (!saved.includes("Z")) row.edited = "the typed character is missing";
    else if (kept < total - 1) row.edited = `kept ${kept}/${total} blocks`;
    else if (!saved.startsWith(lead)) row.edited = "the text before the first block changed";
  }
  return row;
}

const failures = (rows: Row[]) => rows.filter((r) => r.unedited || r.edited).map((r) => `${r.name}: ${r.unedited ? `unedited ${r.unedited}` : `edited ${r.edited}`}`);

describe("what the corpus found (W10.E47)", () => {
  it("a note that is frontmatter and blank lines only saves unedited as it was", () => {
    // kepano-obsidian/Templates/*.md: the body is "\n".
    for (const body of ["\n", "\n\n", "\r\n"]) expect(wysiwygSourcePreserver(body, "").restore("")).toBe(body);
  });

  it("an edit to a note's only block keeps the blank line after its frontmatter", () => {
    // kepano-obsidian/Categories/*.md: "---\ntags: …\n---\n\n![[X.base]]".
    const body = "\n![[Albums.base]]";
    expect(wysiwygSourcePreserver(body, "!\\[\\[Albums.base]]\n").restore("!\\[\\[Albums.baseZ]]\n")).toBe("\n!\\[\\[Albums.baseZ]]\n");
  });

  it("a CRLF note's fenced code is code: an escaped \\[\\[ in it is not marked", () => {
    // munin-template-vault/…/Advanced log template.md, saved by Windows.
    const md = "```js\r\nx.replace(/!\\[\\[(a)\\]\\]/g, f)\r\n```\r\n\r\ntext \\[\\[b]]\r\n";
    const out = protectEscapedWikiLinks(md);
    expect(out.split("```")[1]).toBe(md.split("```")[1]);
    expect(out).toContain("\\[\u2060\\[b]]");
  });
});

describe("WYSIWYG save path over the Obsidian corpus, serializer stood in (W10.E47)", () => {
  it("loads the whole corpus, and the stand-in serializer rewrites most of it", () => {
    expect(notes.length).toBeGreaterThanOrEqual(300);
    const rewritten = notes.filter((n) => serialize(parse(splitFrontmatter(n.text).body)) !== splitFrontmatter(n.text).body).length;
    // Without the source-preserving save these notes would change on the first save.
    expect(rewritten).toBeGreaterThanOrEqual(Math.floor(notes.length / 2));
  });

  it("every note: unedited save byte-identical, one typed character changes only its block", () => {
    const rows = notes.map((n) => roundTrip(n.name, n.text));
    expect(failures(rows)).toEqual([]);
    expect(rows.filter((r) => r.rewritten).length).toBeGreaterThan(0);
  });

  it("the same notes with Windows line endings (CRLF) keep them", () => {
    const rows = notes.map((n) => roundTrip(`${n.name} (CRLF)`, n.text.replace(/\r?\n/g, "\r\n")));
    expect(failures(rows)).toEqual([]);
  });
});
