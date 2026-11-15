/**
 * Math with Temml (plan W1.3 step 2, W10.E77): TeX to MathML, which every
 * current browser draws natively, in place of KaTeX's HTML and fonts. KaTeX
 * stays as the backup: renderCore picks Temml when the package is installed
 * (./temmlEngine.ts; without the package vite.config.ts aliases `temml` to a
 * null stub), and KaTeX when it is not or its chunk fails to load. Either one is loaded only when a note has math, so
 * neither is in the startup bundle.
 *
 * The plugin has rehype-katex's shape (a rehype plugin over the same math
 * elements), so ./math.ts' per-formula cache runs in front of it unchanged.
 * Pure: the Temml module is passed in.
 */
import type { Element, ElementContent, Root, Properties } from "hast";
import { SKIP, visit } from "unist-util-visit";

export interface TemmlLike {
  renderToString(tex: string, opts: { displayMode: boolean; throwOnError: boolean; trust: boolean; annotate: boolean }): string;
}

/** The TeX of a math element: its text, as hast-util-to-string gives it. */
const textOf = (n: Element | ElementContent): string => (n.type === "text" ? n.value : n.type === "element" ? n.children.map(textOf).join("") : "");

const classes = (el: Element): string[] => (Array.isArray(el.properties?.className) ? el.properties.className.map(String) : []);
const isMathCode = (el: Element) => el.tagName === "code" && classes(el).includes("language-math");

/** The math elements remark-math / rehype give: inline and display spans/codes, and `pre > code.language-math` blocks. */
function mathScope(el: Element): { display: boolean } | null {
  const c = classes(el);
  if (c.includes("math-display")) return { display: true };
  if (c.includes("math-inline")) return { display: false };
  if (el.tagName === "pre" && el.children.some((x) => x.type === "element" && isMathCode(x))) return { display: true };
  return null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENTITIES[e] ?? m),
  );

/**
 * Temml's MathML string as hast. Temml writes well-formed MathML (elements,
 * double-quoted attributes, escaped text, no comments or CDATA). Anything
 * else is refused, and the formula falls back to its source text.
 */
export function mathmlToHast(src: string): ElementContent[] {
  const root: Element = { type: "element", tagName: "root", properties: {}, children: [] };
  const stack: Element[] = [root];
  const re = /<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[a-zA-Z_:][\w:.-]*\s*=\s*"[^"]*")*)\s*(\/?)>|([^<]+)/gy;
  let m: RegExpExecArray | null;
  let at = 0;
  while (at < src.length && (m = re.exec(src))) {
    at = re.lastIndex;
    if (m[1]) {
      const top = stack.pop();
      if (!top || top.tagName !== m[1] || stack.length === 0) throw new Error("mathml: unbalanced");
    } else if (m[2]) {
      const props: Properties = {};
      for (const a of m[3].matchAll(/([a-zA-Z_:][\w:.-]*)\s*=\s*"([^"]*)"/g)) {
        const name = a[1] === "class" ? "className" : a[1];
        if (/^on/i.test(name) || /^(href|src|xlink:href)$/i.test(name)) continue; // never a link or a handler from a formula
        props[name] = name === "className" ? decode(a[2]).split(/\s+/).filter(Boolean) : decode(a[2]);
      }
      const el: Element = { type: "element", tagName: m[2], properties: props, children: [] };
      stack[stack.length - 1].children.push(el);
      if (!m[4]) stack.push(el);
    } else if (m[5]) {
      stack[stack.length - 1].children.push({ type: "text", value: decode(m[5]) });
    }
  }
  if (at !== src.length || stack.length !== 1) throw new Error("mathml: not well-formed");
  return root.children;
}

/** The rehype plugin (rehype-katex's shape): every math element becomes Temml's MathML, in a `span.temml` / `div.temml`. */
export function createRehypeTemml(temml: TemmlLike) {
  return function rehypeTemml() {
    return (tree: Root) => {
      visit(tree, "element", (el: Element, index, parent) => {
        if (!parent || index === undefined) return;
        const scope = mathScope(el);
        if (!scope) return;
        const tex = textOf(el).trim();
        let children: ElementContent[];
        try {
          children = mathmlToHast(temml.renderToString(tex, { displayMode: scope.display, throwOnError: false, trust: false, annotate: true }));
        } catch {
          children = [{ type: "text", value: tex }];
        }
        const out: Element = { type: "element", tagName: scope.display ? "div" : "span", properties: { className: ["temml", scope.display ? "temml-display" : "temml-inline"] }, children };
        parent.children.splice(index, 1, out);
        return [SKIP, index + 1];
      });
    };
  };
}

/** The math plugin to use: Temml's when its engine module says it is there, else KaTeX's (loaded only then). */
export async function pickMathPlugin<K>(engine: () => Promise<{ available: boolean; default: unknown } | null>, katex: () => Promise<K>): Promise<{ name: "temml" | "katex"; plugin: K }> {
  const t = await engine().catch(() => null);
  if (t?.available && typeof t.default === "function") return { name: "temml", plugin: t.default as K };
  return { name: "katex", plugin: await katex() };
}
