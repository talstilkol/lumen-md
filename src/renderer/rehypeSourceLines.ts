/**
 * Source lines on the preview's blocks (plan W13.R7): the shared anchor map
 * between the Markdown source, the rendered tree and the outline.
 *
 * Each block element (paragraph, heading, list item, quote, code block,
 * table row, …) gets `data-sl` (its first source line, 1-based) and
 * `data-sle` (its last line) from the parse positions, before
 * `withoutPositions` drops them. Scroll sync (src/reading/scrollSync.ts)
 * reads them: the editor's top line and the preview's top pixel meet in one
 * "line space", so any two panes that know their lines can be linked.
 *
 * Opt-in per render (`SOURCE_LINES_KEY` in the file's data): the preview
 * asks for it, an export or a print never gets the attributes. A block of a
 * long note (./incrementalPreview.ts) is parsed on its own, so its lines are
 * relative to the block; its top-level elements also carry the block's key
 * (`data-sb`, `stampBlockKey`) and the window adds the block's first line.
 */
import type { Element, Root } from "hast";

/** vfile data key: stamp source lines on this render. */
export const SOURCE_LINES_KEY = "lumenSourceLines";

const BLOCK = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "pre", "table", "tr", "hr",
  "ul", "ol", "dl", "dt", "dd", "div", "section", "figure", "details", "aside",
]);

type Positioned = { position?: { start?: { line?: number }; end?: { line?: number } } };

function walk(node: Root | Element, top: boolean): void {
  for (const child of node.children) {
    if (child.type !== "element") continue;
    const pos = (child as Positioned).position;
    const start = pos?.start?.line;
    if (start && (top || BLOCK.has(child.tagName) || child.tagName.startsWith("lumen-"))) {
      const props = (child.properties ??= {});
      props.dataSl = start;
      props.dataSle = pos?.end?.line ?? start;
    }
    // Inside code and math there are no source blocks; a table's cells share their row's line.
    if (child.tagName !== "pre" && child.tagName !== "code" && child.tagName !== "math" && child.tagName !== "svg" && child.tagName !== "tr") walk(child, false);
  }
}

/** The rehype plugin: a no-op unless the render asked for source lines. */
export function rehypeSourceLines() {
  return (tree: Root, file?: { data: Record<string, unknown> }) => {
    if (!file?.data[SOURCE_LINES_KEY]) return;
    walk(tree, true);
  };
}

/** Mark every line-stamped element of one block's tree with the block's key (`data-sb`). */
export function stampBlockKey<T extends Root>(tree: T, key: string): T {
  const mark = (node: Root | Element) => {
    for (const child of node.children) {
      if (child.type !== "element") continue;
      if (child.properties?.dataSl !== undefined) child.properties.dataSb = key;
      mark(child);
    }
  };
  mark(tree);
  return tree;
}
