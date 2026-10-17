/**
 * Per-block direction in the WYSIWYG editor (T25): a node decoration
 * puts `dir="auto"` on every textblock (paragraph, heading, list item,
 * blockquote, table cell), so each one reads in the direction of its own
 * first strong character — the same rule as the source editor and the
 * preview. Code blocks stay `dir="ltr"`.
 */

import { Plugin, PluginKey, type EditorState } from "@milkdown/prose/state";
import { Decoration, DecorationSet } from "@milkdown/prose/view";

export const wysiwygBidiKey = new PluginKey<DecorationSet>("lumen-bidi");

function decorate(state: EditorState): DecorationSet {
  const decos: Decoration[] = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name === "code_block" || node.type.name === "math_block") {
      decos.push(Decoration.node(pos, pos + node.nodeSize, { dir: "ltr" }));
      return false;
    }
    if (node.isTextblock || node.type.name === "list_item" || node.type.name === "blockquote") {
      decos.push(Decoration.node(pos, pos + node.nodeSize, { dir: "auto" }));
    }
    return true;
  });
  return DecorationSet.create(state.doc, decos);
}

export function wysiwygBidiPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: wysiwygBidiKey,
    state: {
      init: (_, state) => decorate(state),
      apply: (tr, old, _oldState, newState) => (tr.docChanged ? decorate(newState) : old),
    },
    props: {
      decorations: (state) => wysiwygBidiKey.getState(state) ?? null,
    },
  });
}
