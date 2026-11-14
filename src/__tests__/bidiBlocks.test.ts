/**
 * T25 — per-block direction in the preview and the WYSIWYG editor.
 *
 * Both put `dir="auto"` on every block of prose and `dir="ltr"` on code,
 * so a Hebrew paragraph and the English one after it each read in their
 * own direction, inside one note.
 */
import { describe, it, expect } from "vitest";
import { EditorState } from "prosemirror-state";
import { Schema, DOMParser } from "prosemirror-model";
import { EditorView } from "prosemirror-view";
import { renderHtmlDocument } from "../storage/exportHtml";
import { TextSelection } from "prosemirror-state";
import { logicalArrow, wysiwygBidiPlugin, wysiwygBidiKey } from "../editor/wysiwygBidi";

describe("preview: rehypeDirAuto", () => {
  it("gives prose blocks dir=auto, keeps code and tables ltr, leaves an explicit dir alone", async () => {
    const md = [
      "# כותרת",
      "",
      "פסקה בעברית.",
      "",
      "An English paragraph.",
      "",
      "> ציטוט",
      "",
      "- פריט",
      "- item",
      "",
      "```js",
      "const x = 1;",
      "```",
      "",
      "| a | b |",
      "|---|---|",
      "| שלום | hi |",
      "",
      '<p dir="rtl">pinned by the author</p>',
      "",
    ].join("\n");
    const html = await renderHtmlDocument(md, { title: "t" });
    expect(html).toMatch(/<h1[^>]*dir="auto"/);
    expect((html.match(/<p dir="auto"/g) ?? []).length).toBeGreaterThanOrEqual(2);
    // Containers get a computed direction (auto would skip their children).
    expect(html).toMatch(/<blockquote dir="rtl"/);
    expect(html).toMatch(/<ul dir="rtl"/);
    expect(html).toMatch(/<li dir="rtl">פריט/);
    expect(html).toMatch(/<li dir="ltr">item/);
    // Highlighted code is rebuilt by rehypeShiki after this plugin ran, so
    // the wrapper carries the direction.
    expect(html).toMatch(/class="code-block"[^>]*dir="ltr"/);
    expect(html).toMatch(/<table[^>]*dir="ltr"/);
    expect(html).toMatch(/<td[^>]*dir="auto"/);
    expect(html).toMatch(/<p dir="rtl">pinned by the author<\/p>/);
  });
});

// Minimal markdown-shaped schema: enough blocks to see which get which dir.
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*", parseDOM: [{ tag: "p" }], toDOM: () => ["p", 0] },
    heading: { group: "block", content: "text*", parseDOM: [{ tag: "h1" }], toDOM: () => ["h1", 0] },
    blockquote: { group: "block", content: "block+", parseDOM: [{ tag: "blockquote" }], toDOM: () => ["blockquote", 0] },
    code_block: { group: "block", content: "text*", code: true, parseDOM: [{ tag: "pre", preserveWhitespace: "full" }], toDOM: () => ["pre", ["code", 0]] },
    // GFM tables as Milkdown names them: cells hold paragraphs.
    table: { group: "block", content: "table_row+", parseDOM: [{ tag: "table" }], toDOM: () => ["table", ["tbody", 0]] },
    table_row: { content: "(table_cell | table_header)+", parseDOM: [{ tag: "tr" }], toDOM: () => ["tr", 0] },
    table_cell: { content: "paragraph+", parseDOM: [{ tag: "td" }], toDOM: () => ["td", 0] },
    table_header: { content: "paragraph+", parseDOM: [{ tag: "th" }], toDOM: () => ["th", 0] },
    text: { group: "inline" },
  },
});

function stateFor(html: string): EditorState {
  const div = document.createElement("div");
  div.innerHTML = html;
  return EditorState.create({ doc: DOMParser.fromSchema(schema).parse(div), plugins: [wysiwygBidiPlugin()] });
}

describe("wysiwyg: wysiwygBidiPlugin", () => {
  it("decorates every block with its own direction and code blocks with dir=ltr (plan 9.7)", () => {
    const dirsOf = (html: string) =>
      wysiwygBidiKey.getState(stateFor(html))!.find().map((d) => (d as unknown as { type: { attrs: Record<string, string> } }).type.attrs?.dir);
    expect(dirsOf("<blockquote><p>ציטוט</p></blockquote>")).toEqual(["rtl", "rtl"]);
    // h1, p → rtl; blockquote and its p → ltr (from "quoted"); pre → ltr.
    expect(dirsOf("<h1>כותרת</h1><p>שלום</p><blockquote><p>quoted</p></blockquote><pre><code>x = 1</code></pre>")).toEqual(["rtl", "rtl", "ltr", "ltr", "ltr"]);
    // A paragraph with no strong character takes the document's direction.
    expect(dirsOf("<p>שלום</p><p>10:30 42%</p>")).toEqual(["rtl", "rtl"]);
  });

  it("puts the attributes on the rendered DOM and follows edits", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = new EditorView(host, { state: stateFor("<p>שלום</p><pre><code>code</code></pre>") });
    const dirs = () => Array.from(view.dom.querySelectorAll("[dir]")).map((el) => `${el.tagName.toLowerCase()}:${el.getAttribute("dir")}`);
    expect(dirs()).toEqual(["p:rtl", "pre:ltr"]);
    view.dispatch(view.state.tr.insert(0, schema.nodes.paragraph.create(null, schema.text("hello"))));
    expect(dirs()).toEqual(["p:ltr", "p:rtl", "pre:ltr"]);
    view.destroy();
    host.remove();
  });
});

describe("wysiwyg: a table has a direction (plan 9.5: the matrix found a table without dir)", () => {
  const row = (...cells: string[]) => `<tr>${cells.map((c) => `<td><p>${c}</p></td>`).join("")}</tr>`;
  function rendered(html: string): string[] {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = new EditorView(host, { state: stateFor(html) });
    const out = Array.from(view.dom.querySelectorAll("p, table")).map((el) => `${el.tagName.toLowerCase()}:${el.getAttribute("dir")}`);
    view.destroy();
    host.remove();
    return out;
  }

  it("takes the direction of its first cell", () => {
    // A Hebrew first cell in an English note: the columns run right to left.
    expect(rendered(`<p>Intro</p><table>${row("שם", "name")}${row("hi", "שלום")}</table>`)).toEqual(["p:ltr", "table:rtl", "p:rtl", "p:ltr", "p:ltr", "p:rtl"]);
    // An English first cell in a Hebrew note: left to right; cells keep their own.
    expect(rendered(`<p>פתק</p><table>${row("Fruit", "פרי")}</table>`)).toEqual(["p:rtl", "table:ltr", "p:ltr", "p:rtl"]);
  });

  it("falls back to the note's direction when the first cell has no strong character", () => {
    expect(rendered(`<p>פתק בעברית</p><table>${row("42", "x")}</table>`)).toEqual(["p:rtl", "table:rtl", "p:rtl", "p:ltr"]);
    expect(rendered(`<p>An English note</p><table>${row("10:30", "שלום")}</table>`)).toEqual(["p:ltr", "table:ltr", "p:ltr", "p:rtl"]);
  });

  it("every table gets one, also an empty one", () => {
    const html = `<table>${row("", "")}</table><p>שלום</p>`;
    expect(rendered(html).filter((d) => d.startsWith("table:"))).toEqual(["table:rtl"]);
  });
});

describe("wysiwyg: logical arrow keys (plan 9.7)", () => {
  function viewFor(html: string, pos: number): EditorView {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = new EditorView(host, { state: stateFor(html) });
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
    return view;
  }
  const head = (v: EditorView) => v.state.selection.head;

  it("moves through a mixed RTL paragraph in text order: Left forward, Right back", () => {
    // "שלום (3) PDF 10:30" — Hebrew, brackets, a Latin run and a number.
    const text = "שלום (3) PDF 10:30";
    const view = viewFor(`<p>${text}</p>`, 1);
    const seen: number[] = [];
    while (logicalArrow(view, false, false)) seen.push(head(view));
    expect(seen).toEqual(Array.from({ length: text.length }, (_, i) => i + 2));
    expect(logicalArrow(view, false, false)).toBe(false); // the block's end: left to the browser
    expect(logicalArrow(view, true, false)).toBe(true);
    expect(head(view)).toBe(text.length);
    view.destroy();
  });

  it("moves an LTR paragraph Right forward, and Shift selects the text in order", () => {
    const view = viewFor("<p>Hello שלום 42</p>", 1);
    for (let i = 0; i < 8; i++) logicalArrow(view, true, true);
    const { from, to } = view.state.selection;
    expect(view.state.doc.textBetween(from, to)).toBe("Hello של");
    expect(logicalArrow(view, false, false)).toBe(true); // collapses to the start
    expect(head(view)).toBe(1);
    view.destroy();
  });

  it("keeps a grapheme cluster (a letter with niqqud) in one step", () => {
    const view = viewFor("<p>שָׁלוֹם</p>", 1);
    logicalArrow(view, false, false);
    expect(head(view)).toBe(1 + "שָׁ".length);
    view.destroy();
  });
});
