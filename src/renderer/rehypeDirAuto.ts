/**
 * `dir="auto"` on every block of prose (T25): the browser resolves each
 * paragraph's direction from its first strong character, so a Hebrew
 * paragraph sits on the right and the English one after it on the left,
 * in the same note. Code, math and tables as a whole stay left-to-right
 * (a cell's text still gets `auto`). An element that already has a `dir`
 * (raw HTML in the note) is left alone.
 */

import type { Element, Root } from "hast";
import { visit } from "unist-util-visit";

const AUTO = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "dd", "dt", "figcaption", "th", "td", "summary", "label"]);
const LTR = new Set(["pre", "table", "math", "svg", "kbd", "samp"]);

export function rehypeDirAuto() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      const props = (node.properties ??= {});
      if (props.dir !== undefined && props.dir !== null && props.dir !== "") return;
      if (LTR.has(node.tagName)) props.dir = "ltr";
      else if (AUTO.has(node.tagName)) props.dir = "auto";
    });
  };
}
