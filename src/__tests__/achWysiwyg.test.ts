/**
 * Plan R12.20 acceptance "works in source mode and in WYSIWYG": the ```ach
 * block is plain text in the note, so the source editor keeps it as typed;
 * this checks the WYSIWYG side. The note goes through the WYSIWYG save path
 * with Milkdown's serializer stood in by the remark-stringify it is built on
 * and the editor's own options (as obsidianCorpusPreserve.test.ts does; real
 * Milkdown is not installable offline here):
 * - opened and saved unedited: byte-identical, the block included;
 * - a word typed in the paragraph after it: the block keeps its bytes;
 * - the block parses as code in the language "ach", which the preview turns
 *   into the matrix (renderCore SPECIAL_LANGS → components "lumen-ach").
 * A Hebrew note, right to left, from the insert menu's own template too.
 */
import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { toMarkdown, type Options } from "mdast-util-to-markdown";
import { gfmToMarkdown } from "mdast-util-gfm";
import { mathToMarkdown } from "mdast-util-math";
import type { Code, Root, Text } from "mdast";
import { wysiwygSourcePreserver } from "../editor/wysiwygSource";
import { roundTripSafe } from "../editor/markdownSerialize.mjs";
import { keepWikiLinks, protectEscapedWikiLinks } from "../editor/wysiwygWikiLinks";
import { SPECIAL_LANGS } from "../renderer/renderCore";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAch, scoreAch } from "../research/ach";

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const syntax: Options = { extensions: [gfmToMarkdown(), mathToMarkdown()] };
const options = roundTripSafe(keepWikiLinks(syntax)) as Options;
const parse = (md: string) => parser.parse(protectEscapedWikiLinks(md)) as Root;
const serialize = (tree: Root) => toMarkdown(tree, options);

const HE_BLOCK = [
  "```ach",
  "title: מי הדליף את הדוח?",
  "hypotheses:",
  "  H1: מישהו *מבפנים*",
  "  H2: קבלן_חיצוני",
  "evidence:",
  "  - { id: E1, text: מטא-דאטה של הקובץ, weight: 3, marks: { H1: CC, H2: I } }",
  "  - { id: E2, text: פוסט בבלוג, deceptive: true, marks: { H1: N, H2: C } }",
  "```",
].join("\n");
const NOTE = `# ניתוח\n\nלפני הבלוק, עם __הדגשה__.\n\n${HE_BLOCK}\n\n* פריט ברשימה\n\nפסקה אחרונה\n`;

function save(body: string, edit?: (tree: Root) => void): string {
  const loaded = serialize(parse(body));
  const preserver = wysiwygSourcePreserver(body, loaded);
  if (!edit) return preserver.restore(loaded);
  const tree = parse(body);
  edit(tree);
  return preserver.restore(serialize(tree));
}

const lastText = (tree: Root): Text => {
  const p = tree.children.filter((c) => c.type === "paragraph").at(-1)!;
  return (p as { children: Text[] }).children.at(-1)!;
};

describe("```ach in the WYSIWYG editor (R12.20)", () => {
  it("the stand-in serializer would rewrite this note (so the check below is not empty)", () => {
    expect(serialize(parse(NOTE))).not.toBe(NOTE);
  });

  it("opened and saved unedited: byte-identical", () => {
    expect(save(NOTE)).toBe(NOTE);
  });

  it("a word typed after it: the ach block keeps its bytes", () => {
    const out = save(NOTE, (tree) => void (lastText(tree).value += " נוספה"));
    expect(out).toContain("פסקה אחרונה נוספה");
    expect(out).toContain(HE_BLOCK);
  });

  it("the block is code in the language ach, which the preview renders as the matrix", () => {
    const code = parse(NOTE).children.find((c): c is Code => c.type === "code")!;
    expect(code.lang).toBe("ach");
    expect(SPECIAL_LANGS.has("ach")).toBe(true);
    const model = parseAch(code.value);
    expect(model.problems).toEqual([]);
    expect(scoreAch(model).leader).toBe("H1");
  });

  it("the insert menu's template survives the WYSIWYG save too", () => {
    // the menu's entry list is module-private (and loads CodeMirror): its template literal is read from the source
    const src = readFileSync(join(__dirname, "..", "editor", "insertMenu.ts"), "utf8");
    const lit = /id: "ach",[\s\S]*?template: ('(?:[^'\\]|\\.)*'),/.exec(src)![1];
    const tpl = new Function(`return ${lit}`)() as string;
    expect(tpl.startsWith("```ach\n")).toBe(true);
    const body = `${tpl}\n\nאחרי\n`;
    expect(save(body)).toBe(body);
    expect(save(body, (tree) => void (lastText(tree).value += "!"))).toContain(tpl);
  });
});
