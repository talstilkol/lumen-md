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
