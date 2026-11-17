// @vitest-environment node
/**
 * Review 9, L3: the import check (train:offline's fail-fast first gate) reads
 * imports from the syntax tree, so an import written inside a template literal
 * (a test fixture, a code sample) is not taken for a real one, and the forms
 * the pre-processor missed (`import("…" as string)`, a dynamic import after a
 * template) are still found.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs script without type declarations
import { specifiers } from "../../scripts/lib/importCheck.mjs";

describe("the import check reads the syntax tree", () => {
  it("an import inside a template literal is text, not an import", () => {
    const text = ["const sample = `", 'import gone from "./inTemplate";', "export * from './alsoInTemplate';", "`;", 'const tagged = html`import "./inTagged";`;'].join("\n");
    expect(specifiers(text)).toEqual([]);
  });

  it("finds every real form: static, re-export, side effect, import =, import(), require(), import types, references", () => {
    const text = [
      '/// <reference path="./ref.d.ts" />',
      'import a from "./a";',
      'import type { T } from "./types";',
      'export { b } from "../b";',
      'export * as ns from "./ns";',
      'import "./side";',
      'import eq = require("./eq");',
      "const t = `a template ${1}`;",
      'async function f() { return (await import("./lazy" as string)).x + (await import(`./tpl`)).y; }',
      'const r = require("./req");',
      'type L = typeof import("./typed");',
    ].join("\n");
    expect(specifiers(text).sort()).toEqual(["../b", "./a", "./eq", "./lazy", "./ns", "./ref.d.ts", "./req", "./side", "./tpl", "./typed", "./types"]);
  });

  it("strings, comments and regexes stay text; a substituted template is not a path", () => {
    const text = ['const s = "import z from \'./inString\'";', "// import y from './inComment';", 'const re = /^import "\\.\\/inRegex";/m;', "const n = 1; await import(`./x/${n}`);", 'other("./notAnImport");'].join("\n");
    expect(specifiers(text)).toEqual([]);
  });

  it("parses JSX only where the extension allows it", () => {
    expect(specifiers('import A from "./A";\nexport const v = <A x="import b from \'./b\'" />;', "c.tsx")).toEqual(["./A"]);
    expect(specifiers('import A from "./A";\nconst n = <number>(1 as unknown);', "c.ts")).toEqual(["./A"]);
  });
});
