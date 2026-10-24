/**
 * KaTeX rehype plugin, split out of the eager pipeline (A7 lever 1/3) and
 * imported dynamically by pipeline.ts and the render worker, so
 * `vendor-katex` (~84 KB gz) is never a static dependency of the main chunk.
 *
 * It is rehype-katex 7's transform with one difference (plan 8.1 step 3):
 * KaTeX's HTML is parsed with hast-util-from-html (parse5), which runs in
 * a worker, instead of hast-util-from-html-isomorphic, whose browser build
 * needs a DOMParser at module load. The main thread uses the same code, so
 * both paths produce the same tree.
 *
 * The import ORDER below is load-bearing: katex must evaluate before mhchem
 * mutates its internals, otherwise the production chunk hits a TDZ error
 * ("Cannot access 'xn' before initialization") — see the vendor-katex note
 * in vite.config.ts.
 */
import katex from "katex";
// Side-effect import: registers \ce{}/\pu{} macros on KaTeX
import "katex/contrib/mhchem";
import type { Element, ElementContent, Root } from "hast";
import { fromHtml } from "hast-util-from-html";
import { toText } from "hast-util-to-text";
import { SKIP, visitParents } from "unist-util-visit-parents";
import type { VFile } from "vfile";

export interface KatexOptions {
  errorColor?: string;
  [key: string]: unknown;
}

export default function rehypeKatex(options: KatexOptions = {}) {
  return function (tree: Root, file?: VFile) {
    visitParents(tree, "element", (element: Element, parents) => {
      const classes = Array.isArray(element.properties?.className) ? (element.properties.className as string[]) : [];
      // ` ```math ` fences, remark-math's `$$` blocks and `$` inline spans.
      const languageMath = classes.includes("language-math");
      const mathDisplay = classes.includes("math-display");
      const mathInline = classes.includes("math-inline");
      let displayMode = mathDisplay;
      if (!languageMath && !mathDisplay && !mathInline) return;

      let parent = parents[parents.length - 1] as Root | Element | undefined;
      let scope: Element = element;
      // A ```math fence: replace the <pre> and use display mode.
      if (element.tagName === "code" && languageMath && parent && parent.type === "element" && parent.tagName === "pre") {
        scope = parent;
        parent = parents[parents.length - 2] as Root | Element | undefined;
        displayMode = true;
      }
      if (!parent) return;

      const value = toText(scope, { whitespace: "pre" });
      let result: ElementContent[] | string;
      try {
        result = katex.renderToString(value, { ...options, displayMode, throwOnError: true });
      } catch (error) {
        const cause = error as Error;
        file?.message("Could not render math with KaTeX", { ancestors: [...parents, element], cause, place: element.position, ruleId: cause.name.toLowerCase(), source: "rehype-katex" });
        // KaTeX handles its own ParseError when asked not to throw; other errors get similar markup.
        try {
          result = katex.renderToString(value, { ...options, displayMode, strict: "ignore", throwOnError: false });
        } catch {
          result = [{ type: "element", tagName: "span", properties: { className: ["katex-error"], style: "color:" + (options.errorColor || "#cc0000"), title: String(error) }, children: [{ type: "text", value }] }];
        }
      }
      if (typeof result === "string") result = fromHtml(result, { fragment: true }).children as ElementContent[];
      const index = parent.children.indexOf(scope);
      parent.children.splice(index, 1, ...result);
      return SKIP;
    });
  };
}
