/**
 * rehype-raw, but a note whose raw HTML the parser cannot take still
 * renders (W10.D21). parse5 through hast-util-raw threw on some fuzz inputs
 * (`Cannot read properties of null (reading 'attrs')`, fuzz #511908: an end
 * tag split across raw nodes; a stack overflow on nesting deeper than the
 * bounds of ./boundMarkdown.ts count). Then the raw HTML is shown as text,
 * which rehypeSanitizeRaw and the rest of the pipeline treat like any text,
 * instead of the whole preview failing.
 */
import rehypeRaw from "rehype-raw";
import type { Root, Nodes } from "hast";

type Transform = (tree: Root, file: unknown) => Root | undefined;

function rawToText(node: Nodes): void {
  if (!("children" in node)) return;
  node.children = node.children.map((c) => (c.type === "raw" ? { type: "text", value: c.value } : c)) as typeof node.children;
  for (const c of node.children) rawToText(c as Nodes);
}

export default function rehypeRawSafe(this: unknown, ...args: unknown[]) {
  const transform = (rehypeRaw as unknown as (...a: unknown[]) => Transform).apply(this, args);
  return (tree: Root, file: unknown): Root => {
    try {
      return transform(tree, file) ?? tree;
    } catch (e) {
      if (!(e instanceof TypeError || e instanceof RangeError)) throw e;
      console.warn("[lumen] raw HTML could not be parsed; shown as text", e);
      rawToText(tree);
      return tree;
    }
  };
}
