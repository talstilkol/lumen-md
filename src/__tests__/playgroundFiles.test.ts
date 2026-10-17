import { describe, it, expect } from "vitest";
import { buildProject, frameworkFromMeta, resolveImport, splitFiles } from "../playground/files";
import { runnerUrl } from "../plugins/PlaygroundBlock";
import { renderMarkdown } from "../renderer/pipeline";
import { components } from "../renderer/components";
import { isValidElement, type ReactNode } from "react";

describe("playground project", () => {
  it("splits files at --- name.ext --- markers", () => {
    const files = splitFiles("--- index.html ---\n<div id=x></div>\n--- app.js ---\nconsole.log(1)\n\n", "vanilla");
    expect(files).toEqual([
      { name: "index.html", code: "<div id=x></div>" },
      { name: "app.js", code: "console.log(1)" },
    ]);
  });

  it("treats an unmarked body as one entry file per framework", () => {
    expect(splitFiles("console.log(1)", "vanilla")).toEqual([{ name: "main.js", code: "console.log(1)" }]);
    expect(splitFiles("<App />", "react")).toEqual([{ name: "main.jsx", code: "<App />" }]);
    expect(splitFiles("   ", "vue")).toEqual([]);
  });

  it("picks main.* as the entry, default markup per framework, and collects CSS", () => {
    const p = buildProject("--- App.jsx ---\nx\n--- main.jsx ---\ny\n--- a.css ---\nb{}", "react height=300");
    expect(p).toMatchObject({ framework: "react", entry: "main.jsx", html: '<div id="root"></div>', css: ["b{}"] });
    expect(buildProject("--- lib.ts ---\nx", "vue").entry).toBe("lib.ts");
    expect(buildProject("--- src/App.jsx ---\na\n--- src/main.jsx ---\nb", "react").entry).toBe("src/main.jsx");
    expect(buildProject("--- about.html ---\n<p>a</p>\n--- index.html ---\n<p>i</p>\n--- main.js ---\nx").html).toBe("<p>i</p>");
    expect(buildProject("x", "vue").html).toBe('<div id="app"></div>');
    expect(frameworkFromMeta(undefined)).toBe("vanilla");
  });

  it("resolves relative imports with or without an extension", () => {
    const names = ["main.jsx", "App.tsx", "lib/util.js", "lib/index.ts"];
    expect(resolveImport("./App", "main.jsx", names)).toBe("App.tsx");
    expect(resolveImport("./lib/util.js", "main.jsx", names)).toBe("lib/util.js");
    expect(resolveImport("../App", "lib/util.js", names)).toBe("App.tsx");
    expect(resolveImport("./lib", "main.jsx", names)).toBe("lib/index.ts");
    expect(resolveImport("./nope", "main.jsx", names)).toBeNull();
    expect(resolveImport("react", "main.jsx", names)).toBeNull();
  });

  it("resolves extensionless CSS and JSON imports", () => {
    const names = ["main.js", "theme.css", "data/items.json"];
    expect(resolveImport("./theme", "main.js", names)).toBe("theme.css");
    expect(resolveImport("./data/items", "main.js", names)).toBe("data/items.json");
  });

  it("serves the runner under the base path", () => {
    expect(runnerUrl("/")).toBe("/playground-runner.html");
    expect(runnerUrl("/app")).toBe("/app/playground-runner.html");
  });

  it("routes ```playground / ```web-playground fences to the block", async () => {
    const target = (components as Record<string, unknown>)["lumen-playground"];
    const found: string[] = [];
    const walk = (n: ReactNode) => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (!isValidElement(n)) return;
      const props = n.props as { lang?: string; children?: ReactNode };
      if (n.type === target) found.push(String(props.lang));
      walk(props.children);
    };
    walk(await renderMarkdown("```playground react\nx\n```\n\n```web-playground\ny\n```", () => false));
    expect(found).toEqual(["playground", "web-playground"]);
  });
});

describe("importSpecifiers", () => {
  it("finds real imports, re-exports and dynamic imports only", async () => {
    const { importSpecifiers } = await import("../playground/files");
    const code = [
      'import React from "react";',
      "import './side.css';",
      'import { a,\n  b } from "./ab.js";',
      'export { c } from "./c.js";',
      'export * from "./star.js";',
      'const lazy = import("./lazy.js");',
      'const opts = import("./opts.json", { with: { type: "json" } });',
      '// import "./missing.js"',
      "/* import x from './nope.js' */",
      "console.log('import \"react\"', `from \"./tpl.js\"`);",
      'const from = "./not-an-import.js";',
      "const meta = import.meta.url;",
    ].join("\n");
    const specs = importSpecifiers(code);
    expect(specs.map((s) => s.spec)).toEqual(["react", "./side.css", "./ab.js", "./c.js", "./star.js", "./lazy.js", "./opts.json"]);
    for (const s of specs) expect(code.slice(s.start + 1, s.end - 1)).toBe(s.spec);
  });

  it("finds dynamic imports inside template expressions", async () => {
    const { importSpecifiers } = await import("../playground/files");
    const code = 'const s = `a ${(await import("./dep.js")).default} b ${ {x: 1}.x } c ${`in ${await import("./deep.js")}`}`;';
    const specs = importSpecifiers(code);
    expect(specs.map((s) => s.spec)).toEqual(["./dep.js", "./deep.js"]);
    for (const s of specs) expect(code.slice(s.start + 1, s.end - 1)).toBe(s.spec);
  });
});

describe("importSpecifiers: template literals", () => {
  it("treats a substitution-free template in import() as a static specifier", async () => {
    const { importSpecifiers } = await import("../playground/files");
    const code = "const a = import(`./dep.js`); const b = import(`./${name}.js`);";
    const specs = importSpecifiers(code);
    expect(specs.map((s) => s.spec)).toEqual(["./dep.js"]);
    expect(code.slice(specs[0].start, specs[0].end)).toBe("`./dep.js`");
  });
});

describe("IMPORT_ATTRS_RE", () => {
  it("matches static and dynamic import attributes only", async () => {
    const { IMPORT_ATTRS_RE } = await import("../playground/files");
    expect(' with { type: "json" };'.replace(IMPORT_ATTRS_RE, "")).toBe(";");
    expect(', { with: { type: "json" } });'.replace(IMPORT_ATTRS_RE, "")).toBe(");");
    expect(" assert {type:'css'}".replace(IMPORT_ATTRS_RE, "")).toBe("");
    expect(";\nwith (x) {}".replace(IMPORT_ATTRS_RE, "")).toBe(";\nwith (x) {}");
    expect(").then(f)".replace(IMPORT_ATTRS_RE, "")).toBe(").then(f)");
  });
});

describe("guardLoops", () => {
  it("guards while / for conditions and leaves for-of, strings and members alone", async () => {
    const { guardLoops } = await import("../playground/files");
    expect(guardLoops("while (x < 3) x++;")).toBe("while (__lumenLoop() && (x < 3)) x++;");
    expect(guardLoops("for (let i = 0; i < n; i++) {}")).toBe("for (let i = 0; __lumenLoop() && ( i < n); i++) {}");
    expect(guardLoops("for (;;) {}")).toBe("for (; __lumenLoop();) {}");
    expect(guardLoops("do { a() } while (f(g(1)))")).toBe("do { a() } while (__lumenLoop() && (f(g(1))))");
    expect(guardLoops('for (const x of xs) {} s = "while (1)"; o.while(1); o.for(2)')).toBe('for (const x of xs) {} s = "while (1)"; o.while(1); o.for(2)');
    expect(guardLoops("for (let i = 0, j = (1, 2); i < j; i++) {}")).toBe("for (let i = 0, j = (1, 2); __lumenLoop() && ( i < j); i++) {}");
  });

  it("leaves methods named while / for alone and still guards loops inside them", async () => {
    const { guardLoops } = await import("../playground/files");
    const keep = [
      "const helper = { while(value) { return value; } };",
      "const o = { a: 1, for(x) { return x; } };",
      "class A { while(x) {} for(y) {} static for(z) {} get while() { return 1; } }",
      "class B extends Base { m() {} while(x) { return x; } }",
      "f({ while(v) { return v; } });",
      "const c = class { async *for(x) {} };",
    ];
    for (const code of keep) expect(guardLoops(code)).toBe(code);
    expect(guardLoops("class C { run() { while (x) x--; } }")).toBe("class C { run() { while (__lumenLoop() && (x)) x--; } }");
    expect(guardLoops("const o = { run() { for (;;) {} } };")).toBe("const o = { run() { for (; __lumenLoop();) {} } };");
    expect(guardLoops("if (a) { while (b) {} } else { outer: for (;;) {} }")).toBe(
      "if (a) { while (__lumenLoop() && (b)) {} } else { outer: for (; __lumenLoop();) {} }",
    );
    expect(guardLoops("switch (k) { case 1: { while (b) {} } }")).toBe("switch (k) { case 1: { while (__lumenLoop() && (b)) {} } }");
    expect(guardLoops("const f = () => { do { x() } while (y) };")).toBe("const f = () => { do { x() } while (__lumenLoop() && (y)) };");
    // The result is valid JavaScript.
    expect(() => new Function(guardLoops("const helper = { while(value) { return value; } }; class A { for(y) { while (y) y--; } }"))).not.toThrow();
  });

  it("guarded code still runs and the guard can stop it", async () => {
    const { guardLoops } = await import("../playground/files");
    let calls = 0;
    const guard = () => ++calls < 50;
    const run = new Function("__lumenLoop", guardLoops("let n = 0; while (true) n++; return n;"));
    expect(run(guard)).toBe(49);
  });
});

describe("formatValue", () => {
  it("formats like JSON, with functions, bigints and cycles shown", async () => {
    const { formatValue } = await import("../playground/files");
    const o: Record<string, unknown> = { a: 1, s: "x", u: undefined, f: function named() {}, n: 10n, arr: [1, undefined], d: new Date(0) };
    o.self = o;
    expect(formatValue(o)).toBe('{"a":1,"s":"x","f":"[Function named]","n":"10n","arr":[1,null],"d":"1970-01-01T00:00:00.000Z","self":"[Circular]"}');
    const shared = { x: 1 };
    expect(formatValue([shared, shared])).toBe('[{"x":1},{"x":1}]');
    expect(formatValue(undefined)).toBe("undefined");
    expect(formatValue(null)).toBe("null");
  });

  it("stops walking once the output budget is reached", async () => {
    const { formatValue } = await import("../playground/files");
    const typed = formatValue(new Float64Array(5_000_000), 100);
    expect(typed).toHaveLength(101);
    expect(typed.startsWith("[0,0,0")).toBe(true);
    expect(typed.endsWith("…")).toBe(true);
    // Elements past the budget are never read.
    let reads = 0;
    const counted = new Proxy(new Array(1_000_000).fill(7), {
      get(t, k) {
        if (typeof k === "string" && /^\d+$/.test(k)) reads++;
        return Reflect.get(t, k);
      },
    });
    expect(formatValue(counted, 100)).toHaveLength(101);
    expect(reads).toBeLessThan(60);
    expect(formatValue({ list: Array.from({ length: 1e5 }, (_, i) => i) }, 50)).toHaveLength(51);
  });
});

describe("guardLoops in labeled blocks", () => {
  it("guards a loop inside a labeled block but not object-literal methods", async () => {
    const { guardLoops } = await import("../playground/files");
    expect(guardLoops("outer: { while (true) {} }")).toContain("__lumenLoop()");
    expect(guardLoops("function f() { outer: { for (;;) break outer; } }")).toContain("__lumenLoop()");
    expect(guardLoops("const o = { a: { while(x) { return x; } } };")).not.toContain("__lumenLoop");
    expect(guardLoops("function* g() { yield\n{ while (true) {} } }")).toContain("__lumenLoop()");
  });
});
