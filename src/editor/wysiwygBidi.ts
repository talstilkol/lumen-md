/**
 * Per-block direction in the WYSIWYG editor (T25): a node decoration
 * puts `dir` on every block, so each one reads in the direction of its
 * own first strong character — the same rule as the source editor and
 * the preview. Textblocks get `dir="auto"`; container blocks (lists,
 * quotes, list items) get the direction of their own text, because
 * `auto` skips children that carry a `dir` of their own. Code blocks
 * stay `dir="ltr"`.
 */

import { Plugin, PluginKey, type EditorState } from "@milkdown/prose/state";
import { Decoration, DecorationSet } from "@milkdown/prose/view";
import { firstStrongDirection } from "../lib/textDirection";

export const wysiwygBidiKey = new PluginKey<DecorationSet>("lumen-bidi");

const CONTAINER = new Set(["list_item", "bullet_list", "ordered_list", "blockquote"]);

function decorate(state: EditorState): DecorationSet {
  const decos: Decoration[] = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name === "code_block" || node.type.name === "math_block") {
      decos.push(Decoration.node(pos, pos + node.nodeSize, { dir: "ltr" }));
      return false;
    }
    if (CONTAINER.has(node.type.name)) {
      decos.push(Decoration.node(pos, pos + node.nodeSize, { dir: firstStrongDirection(node.textContent) ?? "auto" }));
    } else if (node.isTextblock) {
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
