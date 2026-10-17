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
import { wysiwygBidiPlugin, wysiwygBidiKey } from "../editor/wysiwygBidi";

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
    text: { group: "inline" },
  },
});

function stateFor(html: string): EditorState {
  const div = document.createElement("div");
  div.innerHTML = html;
  return EditorState.create({ doc: DOMParser.fromSchema(schema).parse(div), plugins: [wysiwygBidiPlugin()] });
}

describe("wysiwyg: wysiwygBidiPlugin", () => {
  it("decorates every textblock with dir=auto and code blocks with dir=ltr", () => {
    const state = stateFor("<h1>כותרת</h1><p>שלום</p><blockquote><p>quoted</p></blockquote><pre><code>x = 1</code></pre>");
    expect(wysiwygBidiKey.getState(stateFor("<blockquote><p>ציטוט</p></blockquote>"))!.find().map((d) => (d as unknown as { type: { attrs: Record<string, string> } }).type.attrs?.dir)).toEqual(["rtl", "auto"]);
    const decos = wysiwygBidiKey.getState(state)!.find();
    const byDir = (d: string) => decos.filter((x) => (x.spec as { attrs?: Record<string, string> }).attrs?.dir === d || (x as unknown as { type: { attrs: Record<string, string> } }).type.attrs?.dir === d).length;
    // h1, p, inner p → auto; blockquote → computed from "quoted" (ltr);
    // pre → ltr (its text is not revisited).
    expect(decos.length).toBe(5);
    expect(byDir("auto")).toBe(3);
    expect(byDir("ltr")).toBe(2);
  });

  it("puts the attributes on the rendered DOM and follows edits", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = new EditorView(host, { state: stateFor("<p>שלום</p><pre><code>code</code></pre>") });
    const dirs = () => Array.from(view.dom.querySelectorAll("[dir]")).map((el) => `${el.tagName.toLowerCase()}:${el.getAttribute("dir")}`);
    expect(dirs()).toEqual(["p:auto", "pre:ltr"]);
    view.dispatch(view.state.tr.insert(0, schema.nodes.paragraph.create(null, schema.text("hello"))));
    expect(dirs()).toEqual(["p:auto", "p:auto", "pre:ltr"]);
    view.destroy();
    host.remove();
  });
});
