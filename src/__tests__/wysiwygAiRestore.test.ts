/**
 * Plan 5.9 / W10.E37 — the WYSIWYG editor draws the note's saved AI spans
 * after it is built from the store: Markdown offsets → document ranges
 * through the parser (brackets in a copy), checked against the editor's
 * document, so a span that would change the parse is left out, not guessed.
 *
 * The parser here is a small one for the test schema on remark-parse (the
 * parser under Milkdown's); the app passes Milkdown's own.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { EditorState } from "prosemirror-state";
import { Schema, type Node as PMNode, type Mark } from "prosemirror-model";
import { EditorView } from "prosemirror-view";
import { aiRanges, aiTexts, markAiInsert, restoreAiRanges, wysiwygAiAuthorshipPlugin } from "../editor/wysiwygAiAuthorship";
import { docAiRanges, drawSavedAiSpans, snapSpan } from "../editor/wysiwygAiRestore";
import { saveSpans, loadSpans } from "../ai/authorship";
import { authorshipKey } from "../ai/aiWrites";
import { useAppStore } from "../store/useStore";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*", toDOM: () => ["p", 0] },
    heading: { group: "block", content: "inline*", attrs: { level: { default: 1 } }, toDOM: (n) => [`h${n.attrs.level}`, 0] },
    blockquote: { group: "block", content: "block+", toDOM: () => ["blockquote", 0] },
    bullet_list: { group: "block", content: "list_item+", toDOM: () => ["ul", 0] },
    list_item: { content: "block+", toDOM: () => ["li", 0] },
    text: { group: "inline" },
  },
  marks: {
    em: { toDOM: () => ["em", 0] },
    strong: { toDOM: () => ["strong", 0] },
    link: { attrs: { href: {} }, toDOM: (m) => ["a", { href: m.attrs.href }, 0] },
  },
});

type MdNode = { type: string; value?: string; depth?: number; url?: string; children?: MdNode[] };

function inline(nodes: MdNode[] = [], marks: readonly Mark[] = []): PMNode[] {
  return nodes.flatMap((n): PMNode[] => {
    if (n.type === "text") return n.value ? [schema.text(n.value, marks)] : [];
    if (n.type === "emphasis") return inline(n.children, [...marks, schema.marks.em.create()]);
    if (n.type === "strong") return inline(n.children, [...marks, schema.marks.strong.create()]);
    if (n.type === "link") return inline(n.children, [...marks, schema.marks.link.create({ href: n.url })]);
    return [];
  });
}

function block(n: MdNode): PMNode[] {
  if (n.type === "paragraph") return [schema.node("paragraph", null, inline(n.children))];
  if (n.type === "heading") return [schema.node("heading", { level: n.depth }, inline(n.children))];
  if (n.type === "blockquote") return [schema.node("blockquote", null, (n.children ?? []).flatMap(block))];
  if (n.type === "list") return [schema.node("bullet_list", null, (n.children ?? []).map((li) => schema.node("list_item", null, (li.children ?? []).flatMap(block))))];
  return [];
}

const parse = (md: string): PMNode => schema.node("doc", null, (unified().use(remarkParse).parse(md) as unknown as MdNode).children!.flatMap(block));

function stateFor(md: string): EditorState {
  return EditorState.create({ doc: parse(md), plugins: [wysiwygAiAuthorshipPlugin()] });
}

/** The editor's state after a build from `md`, with the saved `spans` drawn. */
function restored(md: string, spans: Array<[number, number]>): EditorState {
  const s = stateFor(md);
  return s.apply(restoreAiRanges(s.tr, docAiRanges(md, spans, parse, s.doc)));
}

const spanOf = (md: string, text: string): [number, number] => {
  const a = md.indexOf(text);
  if (a < 0) throw new Error(`not in the note: ${text}`);
  return [a, a + text.length];
};

describe("saved spans drawn after a build", () => {
  it("a span in a paragraph: the same letters are AI text in the editor", () => {
    const md = "פתיחה של המשתמש. טקסט שהסוכן כתב. סוף.";
    const s = restored(md, [spanOf(md, "טקסט שהסוכן כתב.")]);
    expect(aiTexts(s)).toEqual(["טקסט שהסוכן כתב."]);
  });

  it("spans that start on block syntax (a heading, list items, a quote) draw the text, and the blocks stay what they were", () => {
    const md = "# כותרת מהסוכן\n\nהמשתמש כתב.\n\n- פריט אחד\n- פריט שני\n\n> ציטוט AI\n";
    const s = restored(md, [spanOf(md, "# כותרת מהסוכן"), spanOf(md, "- פריט אחד\n- פריט שני\n"), spanOf(md, "> ציטוט AI")]);
    // One span over both items: one range, from the first item's text to the second's.
    expect(aiTexts(s)).toEqual(["כותרת מהסוכן", "פריט אחד\nפריט שני", "ציטוט AI"]);
    expect(s.doc.firstChild?.type.name).toBe("heading");
  });

  it("a span over emphasis and a link's text: the marked text, with its marks", () => {
    const md = "user, then *AI emphasis* and [AI link](https://example.com/x) end";
    const s = restored(md, [spanOf(md, "*AI emphasis* and [AI link](https://example.com/x)")]);
    expect(aiTexts(s)).toEqual(["AI emphasis and AI link"]);
  });

  it("a span whose bracket would fall in a link's URL is left out; the others are still drawn", () => {
    const md = "first AI sentence. [link](https://example.com/path) tail";
    const bad = spanOf(md, "example.com");
    const good = spanOf(md, "first AI sentence.");
    expect(docAiRanges(md, [good, bad], parse, parse(md)).length).toBe(1);
    expect(aiTexts(restored(md, [good, bad]))).toEqual(["first AI sentence."]);
  });

  it("nothing is claimed when the parse does not match the editor's document", () => {
    const md = "some AI text";
    expect(docAiRanges(md, [[0, 4]], parse, parse("other text"))).toEqual([]);
    expect(docAiRanges(md, [[0, 4]], () => null, parse(md))).toEqual([]);
    expect(docAiRanges(md, [[0, 4]], () => { throw new Error("parser"); }, parse(md))).toEqual([]);
  });

  it("a random walk: every saved span over words of a mixed note is drawn over exactly its letters", () => {
    let seed = 7;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) >>> 0) % n);
    const words = ["שלום", "עולם", "בְּרֵאשִׁית", "agent", "wrote", "this", "*דגש*", "**bold**", "ועוד", "text"];
    for (let round = 0; round < 60; round++) {
      const paras = Array.from({ length: 1 + rnd(4) }, () => Array.from({ length: 2 + rnd(6) }, () => words[rnd(words.length)]).join(" "));
      const md = paras.map((p, i) => (i % 2 ? `- ${p}` : p)).join("\n\n");
      // Whole words as spans, some of them.
      const spans: Array<[number, number]> = [];
      for (const m of md.matchAll(/[^\s]+/g)) {
        if (m[0] === "-" || rnd(3)) continue;
        const a = m.index!;
        const last = spans[spans.length - 1];
        if (last && last[1] >= a - 1) continue; // keep them apart, as normalize() does
        spans.push([a, a + m[0].length]);
      }
      const s = restored(md, spans);
      const expected = spans.map(([a, b]) => md.slice(a, b).replace(/\*/g, ""));
      expect(aiTexts(s)).toEqual(expected);
    }
  });

  it("a drawn span is AI text like any other: typing in it cuts it, and the document is unchanged by the drawing", () => {
    const md = "abc AI text def";
    const before = stateFor(md);
    let s = restored(md, [spanOf(md, "AI text")]);
    expect(s.doc.eq(before.doc)).toBe(true);
    const [from] = aiRanges(s)[0];
    s = s.apply(s.tr.insertText("X", from + 2));
    expect(aiTexts(s)).toEqual(["AI", " text"]);
    // A marked insertion next to it still joins the set.
    s = s.apply(markAiInsert(s.tr.insertText("Z", s.doc.content.size - 1)));
    expect(aiTexts(s)).toContain("Z");
  });

  it("draws .ai-authored in the view", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const md = "user ואז הסוכן";
    const view = new EditorView(host, { state: restored(md, [spanOf(md, "הסוכן")]) });
    expect(view.dom.querySelector(".ai-authored")?.textContent).toBe("הסוכן");
    view.destroy();
    host.remove();
  });

  it("snapSpan: block syntax and the line breaks around a span are not text", () => {
    const md = "- [ ] task one\n";
    expect(md.slice(...snapSpan(md, [0, md.length])!)).toBe("task one");
    expect(snapSpan("a\n\nb", [1, 3])).toBeNull();
  });
});

describe("in the editor: the note's saved spans, after the frontmatter", () => {
  beforeEach(() => localStorage.clear());

  it("drawSavedAiSpans reads the note's saved spans and draws them in the editor's view", () => {
    const fm = "---\ntitle: x\n---\n";
    const body = "user text. AI written part. more user text.";
    const full = fm + body;
    const doc = { ...useAppStore.getState().doc, name: "restore-test.md", content: full };
    useAppStore.setState({ doc });
    const ai = spanOf(full, "AI written part.");
    saveSpans(authorshipKey(doc), full, [ai]);
    expect(loadSpans(authorshipKey(doc), full)).toEqual([ai]);
    const host = document.createElement("div");
    const view = new EditorView(host, { state: stateFor(body) });
    expect(drawSavedAiSpans(view, parse, full, fm, (s) => s)).toBe(1);
    expect(aiTexts(view.state)).toEqual(["AI written part."]);
    view.destroy();
  });

  it("the WYSIWYG editor draws them after every build, with the same preparation as its default value", () => {
    const src = readFileSync(join(__dirname, "..", "editor", "WysiwygEditor.tsx"), "utf8");
    expect(src).toMatch(/registerWysiwygView\(registeredViewRef\.current\);[\s\S]{0,200}restoreWysiwygAiSpans\(editor, value, fm, \(md\) => encodeCriticForWysiwyg\(protectEscapedWikiLinks\(md\)\)\)/);
    expect(src).toMatch(/ctx\.set\(defaultValueCtx, encodeCriticForWysiwyg\(protectEscapedWikiLinks\(body\)\)\)/);
  });
});
