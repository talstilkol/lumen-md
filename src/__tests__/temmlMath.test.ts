// @vitest-environment node
/**
 * W10.E77 (plan W1.3 step 2): math with Temml when it is installed, KaTeX as
 * the backup, neither at startup. Temml is not installed offline here. The
 * MathML strings below are written by hand in the shape Temml 0.13 outputs
 * (`<math>` with `display="block"` and `class="tml-display"`, mrow/mi/mo/mn,
 * escaped text, an annotation). The stand-in renderer records what it is
 * asked. The parser, the plugin, the choice of engine and the wiring are the
 * real code.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Element, Root } from "hast";
import { createRehypeTemml, mathmlToHast, pickMathPlugin, type TemmlLike } from "../renderer/temmlCore";
import stub from "./stubs/temml";
import { rehypeMathIsolate } from "../lib/mathIsolate";

const ROOT = resolve(__dirname, "..", "..");
const DISPLAY = '<math display="block" class="tml-display" style="display:block math;"><semantics><mrow><mi>x</mi><mo>=</mo><mfrac><mrow><mo form="prefix" stretchy="false">−</mo><mi>b</mi></mrow><mrow><mn>2</mn><mi>a</mi></mrow></mfrac><mo>&lt;</mo><mi>&#x3B1;</mi></mrow><annotation encoding="application/x-tex">x = \\frac{-b}{2a} &lt; \\alpha</annotation></semantics></math>';

const el = (tagName: string, className: string[] | undefined, children: Element["children"]): Element => ({ type: "element", tagName, properties: className ? { className } : {}, children });
const tex = (t: string) => [{ type: "text" as const, value: t }];

describe("Temml math (W10.E77)", () => {
  it("reads Temml's MathML into hast: elements, attributes, classes, entities", () => {
    const [math] = mathmlToHast(DISPLAY) as Element[];
    expect(math.tagName).toBe("math");
    expect(math.properties).toMatchObject({ display: "block", className: ["tml-display"] });
    const text = JSON.stringify(math);
    expect(text).toContain('"value":"<"');
    expect(text).toContain('"value":"α"');
    expect(text).toContain('"tagName":"mfrac"');
    expect(() => mathmlToHast("<math><mi>x</mo></math>")).toThrow(/unbalanced/);
    expect(() => mathmlToHast("<math><mi>x</mi>")).toThrow(/well-formed/);
  });

  it("never keeps a link or a handler from a formula", () => {
    const [m] = mathmlToHast('<math><mrow href="javascript:alert(1)" onclick="x()" mathcolor="red"><mi>x</mi></mrow></math>') as Element[];
    const mrow = m.children[0] as Element;
    expect(mrow.properties).toEqual({ mathcolor: "red" });
  });

  it("the plugin renders inline and display math (pre > code.language-math) with Temml's options, and falls back to the source", () => {
    const asked: Array<[string, boolean, boolean]> = [];
    const temml: TemmlLike = {
      renderToString: (t, o) => {
        asked.push([t, o.displayMode, o.trust]);
        if (t === "\\bad") return "<math><mi>broken";
        return o.displayMode ? DISPLAY : "<math><mi>y</mi></math>";
      },
    };
    const tree: Root = {
      type: "root",
      children: [
        el("p", undefined, [{ type: "text", value: "see " }, el("code", ["language-math", "math-inline"], tex("y")), el("code", ["language-math", "math-inline"], tex("\\bad"))]),
        el("pre", undefined, [el("code", ["language-math", "math-display"], tex("x = \\frac{-b}{2a}"))]),
      ],
    };
    createRehypeTemml(temml)()(tree);
    expect(asked).toEqual([["y", false, false], ["\\bad", false, false], ["x = \\frac{-b}{2a}", true, false]]);
    const p = tree.children[0] as Element;
    expect((p.children[1] as Element).properties).toEqual({ className: ["temml", "temml-inline"] });
    expect(((p.children[1] as Element).children[0] as Element).tagName).toBe("math");
    expect((p.children[2] as Element).children).toEqual([{ type: "text", value: "\\bad" }]);
    const block = tree.children[1] as Element;
    expect(block.tagName).toBe("div");
    expect(block.properties).toEqual({ className: ["temml", "temml-display"] });
    // W5.14: a Temml formula is an LTR isolate inside Hebrew, as a KaTeX one is.
    rehypeMathIsolate()(tree as never);
    expect(block.properties?.dir).toBe("ltr");
    expect((p.children[1] as Element).properties?.dir).toBe("ltr");
  });

  it("Temml when its engine is there, KaTeX otherwise or when its chunk fails", async () => {
    const katex = async () => "katex-plugin";
    const temmlPlugin = () => () => undefined;
    expect(await pickMathPlugin(async () => ({ available: true, default: temmlPlugin }), katex)).toEqual({ name: "temml", plugin: temmlPlugin });
    // What temmlEngine.ts exports when `temml` is the null stub:
    expect(stub).toBeNull();
    expect(await pickMathPlugin(async () => ({ available: false, default: null }), katex)).toEqual({ name: "katex", plugin: "katex-plugin" });
    expect(await pickMathPlugin(() => Promise.reject(new Error("chunk")), katex)).toEqual({ name: "katex", plugin: "katex-plugin" });
  });

  it("neither engine is at startup: renderCore loads them with dynamic imports only, and only temmlEngine.ts imports temml", () => {
    const core = readFileSync(join(ROOT, "src/renderer/renderCore.ts"), "utf8");
    expect(core).toContain('() => import("./temmlEngine")');
    expect(core).toContain('() => import("./katexPlugin")');
    const vite = readFileSync(join(ROOT, "vite.config.ts"), "utf8");
    expect(vite).toContain('...(temmlInstalled ? {} : { temml: path.resolve(__dirname, "src/__tests__/stubs/temml.ts") }),');
    const files: string[] = [];
    (function walk(d: string) {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) {
          if (e.name !== "__tests__") walk(p);
        } else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith(".d.ts")) files.push(p);
      }
    })(join(ROOT, "src"));
    const importers = files.filter((f) => /from\s+["']temml["']|import\(\s*["']temml["']\s*\)/.test(readFileSync(f, "utf8"))).map((f) => f.slice(ROOT.length + 1));
    expect(importers).toEqual(["src/renderer/temmlEngine.ts"]);
    const statically = files.filter((f) => /^import[^;(]*["']\.\/temml(Engine|Core)["']/m.test(readFileSync(f, "utf8"))).map((f) => f.slice(ROOT.length + 1));
    // temmlCore (pure, no Temml) is imported by renderCore and temmlEngine; temmlEngine only dynamically.
    expect(statically.sort()).toEqual(["src/renderer/renderCore.ts", "src/renderer/temmlEngine.ts"]);
  });
});
