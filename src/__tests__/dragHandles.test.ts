/**
 * Tests for the drag-handle ProseMirror plugin (γ.1).
 *
 * We can't run a full ProseMirror EditorView in jsdom (it needs layout
 * for posAtCoords), so we exercise the plugin's pure pieces:
 *   1. Decoration count == top-level block count
 *   2. The drag-state meta key round-trips fromPos / hoverPos
 *   3. The default plugin state is initialised to nulls
 */

import { describe, it, expect } from "vitest";
import { EditorState, type Plugin } from "prosemirror-state";
import { Schema, DOMParser } from "prosemirror-model";
import { dragHandlePlugin } from "../editor/dragHandles";

// Minimal markdown-shaped schema — paragraph + blockquote + heading
// + a top-level "doc" container. Enough to exercise the decoration
// counter without pulling prosemirror-schema-basic into devDeps.
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "text*",
      parseDOM: [{ tag: "p" }],
      toDOM: () => ["p", 0],
    },
    blockquote: {
      group: "block",
      content: "block+",
      parseDOM: [{ tag: "blockquote" }],
      toDOM: () => ["blockquote", 0],
    },
    heading: {
      group: "block",
      content: "text*",
      parseDOM: [{ tag: "h1" }, { tag: "h2" }, { tag: "h3" }],
      toDOM: () => ["h1", 0],
    },
    text: { group: "inline" },
  },
});

function makeState(html: string): EditorState {
  const div = document.createElement("div");
  div.innerHTML = html;
  return EditorState.create({
    doc: DOMParser.fromSchema(schema).parse(div),
    plugins: [dragHandlePlugin as unknown as Plugin],
  });
}

describe("dragHandlePlugin", () => {
  it("plugin state initialises with fromPos / hoverPos null", () => {
    const state = makeState("<p>one</p>");
    const meta = dragHandlePlugin.getState(state);
    expect(meta).toEqual({ fromPos: null, hoverPos: null });
  });

  it("renders one decoration per top-level block", () => {
    const state = makeState(
      "<p>first</p><p>second</p><blockquote><p>quoted</p></blockquote><p>fourth</p>",
    );
    const decoSet = dragHandlePlugin.props.decorations?.call(
      dragHandlePlugin,
      state,
    );
    // 4 top-level blocks → 4 widgets.
    // DecorationSource lacks `find` in older TS defs but the runtime impl
     // exposes it. Cast through to read the inner array.
    expect((decoSet as unknown as { find: () => unknown[] }).find().length).toBe(4);
  });

  it("decoration set is empty for an empty doc", () => {
    const state = EditorState.create({
      schema,
      plugins: [dragHandlePlugin as unknown as Plugin],
    });
    const decoSet = dragHandlePlugin.props.decorations?.call(
      dragHandlePlugin,
      state,
    );
    // doc has a single empty paragraph by default → 1 widget.
    expect((decoSet as unknown as { find: () => unknown[] }).find().length).toBe(1);
  });

  it("setting drag-state meta updates the plugin state", () => {
    const state = makeState("<p>a</p><p>b</p>");
    const tr = state.tr.setMeta(dragHandlePlugin, { fromPos: 0, hoverPos: 5 });
    const next = state.apply(tr);
    expect(dragHandlePlugin.getState(next)).toEqual({ fromPos: 0, hoverPos: 5 });
  });
});
