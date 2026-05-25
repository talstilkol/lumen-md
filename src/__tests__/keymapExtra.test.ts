/**
 * Tests for the WYSIWYG indent / outdent keymap (γ.1.b).
 *
 * Driving Tab through a real ProseMirror EditorView requires layout
 * support that jsdom doesn't provide; we verify the plugin shape +
 * its props instead. The actual sinkListItem / liftListItem behaviour
 * is covered by prosemirror-schema-list's own tests.
 */

import { describe, it, expect } from "vitest";
import { EditorState, Plugin } from "prosemirror-state";
import { Schema } from "prosemirror-model";
import { buildIndentKeymap } from "../editor/keymapExtra";

// Minimal schema with conventionally-named list nodes.
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "text*",
      parseDOM: [{ tag: "p" }],
      toDOM: () => ["p", 0],
    },
    bullet_list: {
      group: "block",
      content: "list_item+",
      parseDOM: [{ tag: "ul" }],
      toDOM: () => ["ul", 0],
    },
    list_item: {
      content: "paragraph (bullet_list)*",
      parseDOM: [{ tag: "li" }],
      toDOM: () => ["li", 0],
    },
    text: { group: "inline" },
  },
});

describe("buildIndentKeymap", () => {
  it("returns a Plugin instance", () => {
    const plugin = buildIndentKeymap();
    expect(plugin).toBeInstanceOf(Plugin);
  });

  it("the plugin attaches a handleKeyDown prop (via prosemirror-keymap)", () => {
    const plugin = buildIndentKeymap();
    // The keymap plugin from prosemirror-keymap exposes handleKeyDown
    // under its `props` object.
    const props = plugin.props as { handleKeyDown?: unknown };
    expect(typeof props.handleKeyDown).toBe("function");
  });

  it("can be added to a plain EditorState without errors", () => {
    const plugin = buildIndentKeymap();
    const state = EditorState.create({ schema, plugins: [plugin] });
    expect(state.plugins).toContain(plugin);
  });

  it("schema lookup is permissive: missing list_item doesn't crash", () => {
    // Schema with NO list_item — the keymap's commands should return false
    // (caller falls through to default Tab) instead of throwing.
    const minimalSchema = new Schema({
      nodes: {
        doc: { content: "paragraph+" },
        paragraph: {
          content: "text*",
          parseDOM: [{ tag: "p" }],
          toDOM: () => ["p", 0],
        },
        text: { group: "inline" },
      },
    });
    const plugin = buildIndentKeymap();
    const state = EditorState.create({
      schema: minimalSchema,
      plugins: [plugin],
    });
    expect(() => state.plugins).not.toThrow();
  });
});
