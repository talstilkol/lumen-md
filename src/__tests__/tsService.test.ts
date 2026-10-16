// @vitest-environment node
/**
 * TypeScript checks in code blocks: block extraction, the language service
 * (real compiler + lib files from node_modules) and decoration mapping.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript";
import { findTsBlocks, blockAt, toUnits, unitAt, unitRangeToDoc } from "../lsp/tsBlocks";
import { createTsService, type TsService } from "../lsp/tsService";

let service: TsService;
beforeAll(() => {
  const dir = join(process.cwd(), "node_modules/typescript/lib");
  const libs: Record<string, string> = {};
  for (const f of readdirSync(dir)) {
    if (/^lib\.(es5|es20\d\d.*|decorators.*|dom.*)\.d\.ts$/.test(f)) libs[f] = readFileSync(join(dir, f), "utf8");
  }
  service = createTsService(ts, libs);
});

describe("findTsBlocks", () => {
  it("finds ts / tsx / js fences with exact code offsets", () => {
    const doc = "# T\n\n```ts\nconst a = 1;\n```\n\n```js\nx\n```\n\n~~~tsx\n<div/>\n~~~\n";
    const blocks = findTsBlocks(doc);
    expect(blocks.map((b) => [b.id, b.tsx, b.js, b.code])).toEqual([
      ["block-0", false, false, "const a = 1;"],
      ["block-1", false, true, "x"],
      ["block-2", true, false, "<div/>"],
    ]);
    expect(doc.slice(blocks[0].from, blocks[0].to)).toBe("const a = 1;");
    expect(blockAt(blocks, blocks[0].from + 3)?.id).toBe("block-0");
    expect(blockAt(blocks, 0)).toBeNull();
  });

  it("ignores unclosed fences and backtick info strings", () => {
    expect(findTsBlocks("```ts\nopen")).toEqual([]);
    expect(findTsBlocks("```ts `x`\na\n```")).toEqual([]);
  });
});

describe("TypeScript service", () => {
  it("reports type errors at block-relative offsets", () => {
    const code = 'const n: number = "x";\nn.toFixed(2);';
    const diags = service.diagnostics([{ id: "block-0", code, tsx: false }]);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe(2322);
    expect(code.slice(diags[0].start, diags[0].start + diags[0].length)).toBe("n");
    expect(diags[0].severity).toBe("error");
  });

  it("knows the ES and DOM libs, keeps blocks isolated, ignores missing packages", () => {
    const diags = service.diagnostics([
      { id: "block-0", code: "const xs = [1, 2].map((x) => x * 2);\ndocument.title = 'a';\nconst p = Promise.resolve(1);", tsx: false },
      { id: "block-1", code: "const xs = 'separate scope';\nimport { a } from 'some-package';", tsx: false },
    ]);
    expect(diags).toEqual([]);
  });

  it("completes members after a dot", () => {
    const code = "const s = 'hi';\ns.";
    const items = service.completions([{ id: "block-0", code, tsx: false }], "block-0", code.length);
    const labels = items.map((i) => i.label);
    expect(labels).toContain("toUpperCase");
    expect(labels).not.toContain("toFixed");
  });

  it("checks tsx blocks with JSX allowed", () => {
    const diags = service.diagnostics([{ id: "block-0", code: "const el = <div>{1 + 1}</div>;", tsx: true }]);
    // No JSX namespace without React types: only that complaint is acceptable.
    expect(diags.every((d) => d.code === 7026)).toBe(true);
  });
});

describe("JavaScript blocks and shared scopes", () => {
  it("finds js / live-js blocks and groups shared ones by scope", () => {
    const doc = [
      "```live-js shared",
      "const base = 2;",
      "```",
      "```live-js shared",
      "const total = base * 21;",
      "```",
      "```live-js shared=other",
      "const base = 'x';",
      "```",
      "```js",
      "let a = 1",
      "```",
    ].join("\n");
    const blocks = findTsBlocks(doc);
    expect(blocks.map((b) => [b.js, b.scope])).toEqual([
      [true, "default"],
      [true, "default"],
      [true, "other"],
      [true, null],
    ]);
    const units = toUnits(blocks);
    expect(units.map((u) => u.id)).toEqual(["scope-default", "scope-other", "block-3"]);
    expect(units[0].code).toBe("const base = 2;\nconst total = base * 21;");
    // Offsets map both ways through the concatenation.
    const second = blocks[1];
    const at = unitAt(units, second.from + 6)!;
    expect(at.unit.id).toBe("scope-default");
    expect(at.unit.code.slice(at.offset, at.offset + 5)).toBe("total");
    expect(unitRangeToDoc(units[0], at.offset, 5)).toEqual({ from: second.from + 6, to: second.from + 11 });
  });

  it("checks JS syntax always and types only with // @ts-check", () => {
    const syntax = service.diagnostics([{ id: "j0", code: "let x = ;", tsx: false, js: true }]);
    expect(syntax.length).toBeGreaterThan(0);
    const unchecked = service.diagnostics([{ id: "j1", code: "let n = 1;\nn = 'x';", tsx: false, js: true }]);
    expect(unchecked).toEqual([]);
    const checked = service.diagnostics([{ id: "j2", code: "// @ts-check\nlet n = 1;\nn = 'x';", tsx: false, js: true }]);
    expect(checked.map((d) => d.code)).toEqual([2322]);
  });

  it("shared blocks see each other's declarations and may redeclare", () => {
    const code = "// @ts-check\nconst base = 2;\nconst base = 3;\nconst total = base.toFixed(1);";
    const diags = service.diagnostics([{ id: "scope-default", code, tsx: false, js: true, shared: true }]);
    expect(diags).toEqual([]);
  });

  it("describes the symbol under the cursor", () => {
    const code = "/** The answer. */\nconst answer = 42;\nanswer;";
    const info = service.quickInfo([{ id: "q0", code, tsx: false }], "q0", code.lastIndexOf("answer") + 2);
    expect(info?.text).toBe("const answer: 42");
    expect(info?.doc).toBe("The answer.");
  });
});
