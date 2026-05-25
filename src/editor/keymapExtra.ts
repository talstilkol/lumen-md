/**
 * Extra keymap for the WYSIWYG editor (γ.1.b).
 *
 * `Tab` / `Shift-Tab` indent / outdent the current list item, falling
 * through to the editor's default behaviour when the cursor isn't
 * inside a list. Mirrors what every Notion-style editor does and
 * matches Markdown semantics: nested list items round-trip cleanly to
 * `  - item` / `    - item`.
 *
 * Wire-up (see `WysiwygEditor.tsx`):
 *
 *     ctx.update(prosePluginsCtx, (plugins) => [
 *       ...plugins,
 *       buildIndentKeymap(),
 *     ]);
 *
 * The plugin wraps `sinkListItem` / `liftListItem` from
 * `prosemirror-schema-list` and exits cleanly (returns `false`) when
 * the schema doesn't expose the expected node — Milkdown's commonmark
 * preset uses different node names than the prosemirror-schema-list
 * defaults, so we discover them on first use.
 */

import { keymap } from "prosemirror-keymap";
import { sinkListItem, liftListItem } from "prosemirror-schema-list";
import type { Schema } from "prosemirror-model";
import type { Command } from "prosemirror-state";
import type { Plugin } from "prosemirror-state";

/** Find the list-item node type in the schema, regardless of name. */
function findListItem(schema: Schema): import("prosemirror-model").NodeType | null {
  // Common names across Milkdown / commonmark / GFM presets.
  const candidates = [
    "list_item",
    "listItem",
    "bullet_list_item",
    "bulletListItem",
  ];
  for (const name of candidates) {
    const node = schema.nodes[name];
    if (node) return node;
  }
  return null;
}

/**
 * Build the keymap plugin. We don't bind to a specific schema at module
 * load — the plugin captures the schema from the active editor state on
 * each invocation so it works regardless of which preset is mounted.
 */
export function buildIndentKeymap(): Plugin {
  const indent: Command = (state, dispatch) => {
    const item = findListItem(state.schema);
    if (!item) return false;
    return sinkListItem(item)(state, dispatch);
  };
  const outdent: Command = (state, dispatch) => {
    const item = findListItem(state.schema);
    if (!item) return false;
    return liftListItem(item)(state, dispatch);
  };
  return keymap({
    Tab: indent,
    "Shift-Tab": outdent,
  });
}
