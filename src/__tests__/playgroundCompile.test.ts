// @vitest-environment node
/**
 * Plan W10.D1 — the playground block compiles the project and the runner
 * page only links and runs it (src/playground/compile.ts), so the runner's
 * bundle needs no transpiler and loads no script by URL.
 */
import { describe, it, expect } from "vitest";
import { compileFile, vendorNeeds, buildForRunner, VENDOR_FILES, type Transform } from "../playground/compile";
import { buildProject, LOOP_GUARD } from "../playground/files";

/** Sucrase, when installed (it is a dependency; the offline shim lacks it). */
const sucrase = await import("sucrase").then(
  (m) => m.transform as unknown as Transform,
  () => null,
);
/** What Sucrase does to plain JavaScript with no transforms: nothing. Used only for .js in a vanilla project. */
const plain: Transform = (code, o) => {
  if (o.transforms.length) throw new Error("plain: only for a vanilla .js file");
  return { code };
};
const refuse: Transform = () => {
  throw new Error("CSS and JSON never go through the transpiler");
};

describe("compileFile", () => {
  it("CSS and JSON become modules without the transpiler", () => {
    expect(compileFile("a.css", "p { color: red }", "vanilla", refuse)).toEqual({ name: "a.css", code: 'export default "p { color: red }";', specs: [] });
    expect(compileFile("d.json", '{"n":1}', "vanilla", refuse)).toEqual({ name: "d.json", code: 'export default {"n":1};', specs: [] });
  });

  it("a script gets loop guards and the offsets of its real import specifiers", () => {
    const src = 'import x from "./x.js";\n// import "./not-this.js"\nwhile (true) {}\nconst s = "import y from \'./nor-this.js\'";';
    const f = compileFile("main.js", src, "vanilla", plain);
    if (!("code" in f)) throw new Error(f.error);
    expect(f.code).toContain(`while (${LOOP_GUARD}() && (true))`);
    expect(f.specs.map((s) => s.spec)).toEqual(["./x.js"]);
    for (const s of f.specs) expect(f.code.slice(s.start, s.end)).toBe(JSON.stringify(s.spec));
  });

  it("a file that doesn't compile carries its error (the runner throws it only if the run reaches the file)", () => {
    const broken: Transform = () => {
      throw new SyntaxError("Unexpected token (1:5)");
    };
    expect(compileFile("App.jsx", "<div", "react", broken)).toEqual({ name: "App.jsx", error: "SyntaxError: Unexpected token (1:5)" });
  });

  // skip-reason: the real-compiler case needs sucrase installed; the reason is printed in the title | task: W10.D1 | until: 2027-05-16
  it.skipIf(!sucrase)(`with the real Sucrase: JSX for react imports the automatic runtime${sucrase ? "" : " — skipped: sucrase not installed"}`, () => {
    const f = compileFile("App.jsx", "export default () => <p>hi</p>;", "react", sucrase!);
    if (!("code" in f)) throw new Error(f.error);
    expect(f.specs.map((s) => s.spec)).toContain("react/jsx-runtime");
    const bad = compileFile("B.tsx", "const = ;", "react", sucrase!);
    expect("error" in bad && bad.error).toMatch(/Error/);
  });
});

describe("vendorNeeds", () => {
  it("React for a react project, Vue only when a file imports it", () => {
    const react = buildProject("console.log(1)", "react");
    expect(vendorNeeds(react, [{ name: "main.jsx", code: "", specs: [] }])).toEqual(["react", "reactDom"]);
    const vue = buildProject('import { createApp } from "vue";', "vue");
    expect(vendorNeeds(vue, [{ name: "main.js", code: "", specs: [{ start: 0, end: 5, spec: "vue" }] }])).toEqual(["vue"]);
    expect(vendorNeeds(vue, [{ name: "main.js", code: "", specs: [] }])).toEqual([]);
  });
});

describe("buildForRunner", () => {
  it("reads only the libraries the project needs; one that fails to load is left out", async () => {
    const project = buildProject('import { createApp } from "vue";\ncreateApp({}).mount("#app");', "vue");
    const asked: string[] = [];
    const build = await buildForRunner(project, {
      transform: plain,
      readVendor: async (file) => {
        asked.push(file);
        return `/* ${file} */`;
      },
    });
    expect(asked).toEqual([VENDOR_FILES.vue]);
    expect(build.vendor).toEqual({ vue: `/* ${VENDOR_FILES.vue} */` });
    expect(build.files.map((f) => f.name)).toEqual(["main.js"]);

    const none = await buildForRunner(project, {
      transform: plain,
      readVendor: async () => {
        throw new Error("404");
      },
    });
    expect(none.vendor).toEqual({});
  });
});
