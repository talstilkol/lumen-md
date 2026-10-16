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

  it("checks an unclosed fence through the end; ignores backtick info strings", () => {
    const open = findTsBlocks("intro\n```ts\nconst x = 1");
    expect(open.map((b) => b.code)).toEqual(["const x = 1"]);
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
    // One unit per block; a shared block's unit is its scope's earlier
    // blocks + itself, joined by a statement boundary.
    expect(units.map((u) => u.id)).toEqual(["block-0", "block-1", "block-2", "block-3"]);
    // A shared live block is wrapped only for a top-level await / return.
    expect(units[1].code).toBe("let   base = 2;\n;\nlet   total = base * 21;");
    expect(units[2].code).toBe("let   base = 'x';");
    // Offsets map both ways, into the unit's own block only.
    const second = blocks[1];
    const at = unitAt(units, second.from + 6)!;
    expect(at.unit.id).toBe("block-1");
    expect(at.unit.code.slice(at.offset, at.offset + 5)).toBe("total");
    expect(unitRangeToDoc(units[1], at.offset, 5)).toEqual({ from: second.from + 6, to: second.from + 11 });
    expect(unitRangeToDoc(units[1], 0, 5)).toBeNull(); // in the earlier block
  });

  it("recognises the js-live alias, shared too", () => {
    const blocks = findTsBlocks("```js-live shared\nconst a = 1\n```\n```js-live shared\na\n```\n");
    expect(blocks.map((b) => [b.js, b.scope])).toEqual([
      [true, "default"],
      [true, "default"],
    ]);
  });

  it("checks JS syntax always and types only with // @ts-check", () => {
    const syntax = service.diagnostics([{ id: "j0", code: "let x = ;", tsx: false, js: true }]);
    expect(syntax.length).toBeGreaterThan(0);
    const unchecked = service.diagnostics([{ id: "j1", code: "let n = 1;\nn = 'x';", tsx: false, js: true }]);
    expect(unchecked).toEqual([]);
    const checked = service.diagnostics([{ id: "j2", code: "// @ts-check\nlet n = 1;\nn = 'x';", tsx: false, js: true }]);
    expect(checked.map((d) => d.code)).toEqual([2322]);
  });

  const sharedDoc = (...bodies: string[]) => bodies.map((b) => "```live-js shared\n" + b + "\n```").join("\n");
  const checkShared = (...bodies: string[]) => {
    const units = toUnits(findTsBlocks(sharedDoc(...bodies)));
    const input = units.map(({ id, tsx, js, shared, code }) => ({ id, tsx, js, shared, code }));
    const diags = service.diagnostics(input);
    // Keep only diagnostics inside each unit's own block, as the editor does.
    return {
      units,
      input,
      diags: diags.filter((d) => {
        const u = units.find((x) => x.id === d.id)!;
        return unitRangeToDoc(u, d.start, d.length) !== null;
      }),
    };
  };

  it("shared blocks see earlier declarations, and a re-declaration replaces the type", () => {
    const { diags } = checkShared("// @ts-check\nconst value = 1;", "// @ts-check\nconst value = 'x';\nvalue.toUpperCase();", "// @ts-check\nvalue.toUpperCase();");
    expect(diags).toEqual([]);
    const { units, input } = checkShared("const value = 1;", "// @ts-check\nconst value = 'x';\nvalue;");
    const at = units[1].code.lastIndexOf("value");
    expect(service.quickInfo(input, units[1].id, at + 1)?.text).toBe("let value: string");
  });

  it("later shared blocks are invisible to earlier ones", () => {
    const { units, input } = checkShared("// @ts-check\nlater();", "function later() {}");
    expect(units[0].code).not.toContain("later() {}");
    const { diags } = checkShared("// @ts-check\nlater();", "function later() {}");
    expect(diags.map((d) => [d.id, d.code])).toEqual([["block-0", 2304]]);
    expect(service.completions(input, "block-0", units[0].code.indexOf("later")).some((c) => c.label === "later")).toBe(false);
  });

  it("each shared block decides // @ts-check for itself", () => {
    // Directive only in the later block: its type errors are reported.
    let r = checkShared("const n = 1;", "// @ts-check\nlet s = 'a';\ns = 1;");
    expect(r.diags.map((d) => [d.id, d.code])).toEqual([["block-1", 2322]]);
    // Directive only in the first block: the later block stays unchecked.
    r = checkShared("// @ts-check\nconst n = 1;", "let s = 'a';\ns = 1;");
    expect(r.diags).toEqual([]);
  });

  it("semicolonless shared blocks don't merge across the boundary", () => {
    const { diags } = checkShared("// @ts-check\nconst xs = [1]", "// @ts-check\n[2].forEach((x) => x.toFixed())");
    expect(diags).toEqual([]);
  });

  it("re-declared names are renamed in earlier parts only where they are bindings", () => {
    const { units } = checkShared("const value = 1; const o = { value: 2 }; o.value;", "const value = 'x';");
    const first = units[1].code.split("\n;\n")[0];
    expect(first).toBe("let   value$prev = 1; let   o = { value: 2 }; o.value;");
  });

  it("references inside functions stay late-bound to the newest declaration", () => {
    const { units, diags } = checkShared(
      "const value = 1; function read() { return value; } const arrow = () => value; const now = value;",
      "// @ts-check\nconst value = 'x';\nread().toUpperCase(); arrow().toUpperCase(); now.toFixed();",
    );
    expect(units[1].code.split("\n;\n")[0]).toBe(
      "// @ts-check\nlet   value$prev = 1; function read() { return value; } let   arrow = () => value; let   now = value$prev;",
    );
    expect(diags).toEqual([]);
  });

  it("functions invoked while the earlier block runs see that time's value", () => {
    const { units, diags } = checkShared(
      "const value = 1; const result = (() => value)(); const doubled = [1].map((x) => x * value);",
      "// @ts-check\nconst value = 'x';\nresult.toFixed(); doubled[0].toFixed();",
    );
    expect(units[1].code).toContain("let   result = (() => value$prev)();");
    expect(diags).toEqual([]);
  });

  it("a block that re-declares a name sees each version in turn", () => {
    // In the checked block itself: offsets are kept.
    let r = checkShared("// @ts-check\nlet value = 1; const n = value; let value = 'x'; value.toUpperCase(); n.toFixed();");
    expect(r.diags).toEqual([]);
    expect(r.units[0].code).toContain("let value = 'x'; value.toUpperCase();");
    expect(r.units[0].code).not.toContain("$prev");
    // In an earlier block: versions are renamed as usual.
    r = checkShared("let value = 1; const n = value; let value = 'x';", "// @ts-check\nvalue.toUpperCase(); n.toFixed();");
    expect(r.diags).toEqual([]);
    // And a real error after the re-declaration is still reported.
    r = checkShared("// @ts-check\nlet value = 1; let value = 'x'; value.toFixed();");
    expect(r.diags.map((d) => d.code)).toEqual([2551]);
  });

  it("every declarator and pattern starts a version, and recursion follows its declaration", () => {
    let r = checkShared("// @ts-check\nlet first = 0, value = 1; let value = 'x'; value.toUpperCase();");
    expect(r.diags).toEqual([]);
    // (A shorthand pattern in the checked block itself keeps its name, since
    // offsets there can't move; in an earlier block it is versioned too.)
    r = checkShared("let { value } = { value: 1 }; const n = value; let value = 'x';", "// @ts-check\nvalue.toUpperCase(); n.toFixed();");
    expect(r.diags).toEqual([]);
    // The original function recurses into itself, not the newer `value`.
    r = checkShared(
      "function value(n) { return n ? value(n - 1) : 1; } const saved = value;",
      "// @ts-check\nfunction value() { return 'x'; }\nsaved(1).toFixed();",
    );
    expect(r.units[1].code.split("\n;\n")[0]).toContain("function value$prev(n) { return n ? value$prev(n - 1) : 1; }");
    expect(r.diags).toEqual([]);
  });

  it("a directly invoked function expression runs with that time's value", () => {
    const { units, diags } = checkShared(
      "const value = 1; const result = function () { return value; }(); function decl() { return value; }\n(0);",
      "// @ts-check\nconst value = 'x';\nresult.toFixed(); decl().toUpperCase();",
    );
    const first = units[1].code.split("\n;\n")[0];
    expect(first).toContain("function () { return value$prev; }()");
    // A declaration followed by `(` on the next line is not invoked.
    expect(first).toContain("function decl() { return value; }");
    expect(diags).toEqual([]);
  });

  it("earlier retained closures see an unwrapped live block's declarations", () => {
    const doc = ["```live-js shared", "const value = 1; function read() { return value; }", "```", "```live-js shared", "// @ts-check", "const value = 'x';", "read().toFixed();", "```"].join("\n");
    const units = toUnits(findTsBlocks(doc));
    expect(units[1].code).not.toContain("async () =>");
    const diags = service
      .diagnostics(units.map(({ id, tsx, js, shared, code }) => ({ id, tsx, js, shared, code })))
      .filter((d) => unitRangeToDoc(units[1], d.start, d.length) !== null);
    expect(diags.map((d) => d.code)).toEqual([2551]); // toFixed doesn't exist on string
    // A top-level await still needs the async wrapper.
    const awaiting = toUnits(findTsBlocks(doc.replace("read().toFixed();", "await read();")));
    expect(awaiting[1].code).toContain("(async () => {");
  });

  it("parameters, a function's own name and its locals keep their binding", () => {
    const { units, diags } = checkShared(
      "const value = 1; function id(value) { return value; } const f = function value() { return value; }; [2].forEach((value) => { const k = value; });",
      "// @ts-check\nconst value = 'x';\nid(2).toFixed();",
    );
    const first = units[1].code.split("\n;\n")[0];
    expect(first).toContain("function id(value) { return value; }");
    expect(first).toContain("function value() { return value; }");
    expect(first).toContain("forEach((value) => { const k = value; })");
    expect(diags).toEqual([]);
  });

  it("each superseded version gets its own stand-in", () => {
    const { diags } = checkShared(
      "const value = 1;",
      "const value = 'x'; const saved = value;",
      "// @ts-check\nconst value = true;\nsaved.toUpperCase();",
    );
    expect(diags).toEqual([]);
  });

  it("callbacks stay late-bound unless the callee runs them synchronously", () => {
    const { units, diags } = checkShared(
      "const value = 1; const callbacks = []; callbacks.push(() => value); setTimeout(() => value, 0, 1); const xs = [1].map((x) => value); const reg = [0, () => value];",
      "// @ts-check\nconst value = 'x';\ncallbacks[0]().toUpperCase(); xs[0].toFixed();",
    );
    const first = units[1].code.split("\n;\n")[0];
    expect(first).toContain("callbacks.push(() => value)");
    expect(first).toContain("setTimeout(() => value, 0, 1)");
    expect(first).toContain("[1].map((x) => value$prev)");
    expect(first).toContain("[0, () => value]");
    expect(diags).toEqual([]);
  });

  it("shared bindings are reassignable, as at run time", () => {
    const { diags } = checkShared("// @ts-check\nconst count = 1;", "// @ts-check\ncount = 2;\nconst k = 3; k = 4;");
    expect(diags).toEqual([]);
  });

  it("a nested block's own binding doesn't hide the outer reference", () => {
    const { units } = checkShared(
      "const value = 1; const result = (() => { const before = value; { const value = 2; value; } return before; })();",
      "const value = 'x';",
    );
    expect(units[1].code).toContain("const before = value$prev; { const value = 2; value; }");
  });

  it("only built-in receivers count as synchronous callers", () => {
    const { units } = checkShared(
      "const value = 1; holder.map(() => value); [1].map(() => value); \"a\".replace(/a/, () => value); Array.from([1], () => value); xs[0].map(() => value);",
      "const value = 'x';",
    );
    const first = units[1].code.split("\n;\n")[0];
    expect(first).toContain("holder.map(() => value)");
    expect(first).toContain("[1].map(() => value$prev)");
    expect(first).toContain('"a".replace(/a/, () => value$prev)');
    expect(first).toContain("Array.from([1], () => value$prev)");
    expect(first).toContain("xs[0].map(() => value)");
  });

  it("class field names keep their key; parameter defaults still reference the shared name", () => {
    const { units } = checkShared(
      "const value = 1; class C { value; static value = 2; other = value; } const result = (function (x = value) { return x; })();",
      "const value = 'x';",
    );
    const first = units[1].code.split("\n;\n")[0];
    // Field initializers run at `new C()`, later: late-bound like methods.
    expect(first).toContain("class C { value; static value = 2; other = value; }");
    expect(first).toContain("(function (x = value$prev) { return x; })()");
  });

  it("static initializers and computed keys run at definition; destructuring defaults reference", () => {
    const { units } = checkShared(
      "const value = 1; class C { static saved = value; static { this.b = value; } [value] = 1; late = value; m() { return value; } } const r = (() => { const { x = (value) } = {}; return x; })();",
      "const value = 'x';",
    );
    const first = units[1].code.split("\n;\n")[0];
    expect(first).toContain("static saved = value$prev;");
    expect(first).toContain("static { this.b = value$prev; }");
    expect(first).toContain("[value$prev] = 1;");
    expect(first).toContain("late = value;");
    expect(first).toContain("m() { return value; }");
    expect(first).toContain("const { x = (value$prev) } = {}");
  });

  it("a closure in grouping parentheses is still retained", () => {
    const { units, diags } = checkShared(
      "const value = 1; const fn = (() => value); const now = (() => value)();",
      "// @ts-check\nconst value = 'x';\nfn().toUpperCase(); now.toFixed();",
    );
    expect(units[1].code).toContain("let   fn = (() => value);");
    expect(units[1].code).toContain("let   now = (() => value$prev)();");
    expect(diags).toEqual([]);
  });

  it("method names and getters keep their key", () => {
    const { units, diags } = checkShared(
      "const value = 1; const obj = { value() { return 2; }, get other() { return value; } };",
      "// @ts-check\nconst value = 'x';\nobj.value().toFixed();",
    );
    expect(units[1].code.split("\n;\n")[0]).toContain("{ value() { return 2; }, get other() { return value; } }");
    expect(diags).toEqual([]);
  });

  it("only leading directive comments are neutralised, not @ts-check as data", () => {
    const { units } = checkShared('// @ts-check\nconst marker = "@ts-check";', "const later = 1;");
    expect(units[1].code).toContain('let   marker = "@ts-check";');
    expect(units[1].code).toContain("// @ts-_____");
  });

  it("stand-ins never collide with nested bindings", () => {
    const { units } = checkShared(
      "const value = 1; const result = (() => { const value$prev = 'x'; return value; })(); const top = value;",
      "const value = 'y';",
    );
    expect(units[1].code.split("\n;\n")[0]).toContain("let   top = value$prev2;");
  });

  it("live-js blocks are checked as the async function they run in; js fences stay modules", () => {
    const check = (doc: string) => {
      const units = toUnits(findTsBlocks(doc));
      const diags = service.diagnostics(units.map(({ id, tsx, js, shared, code }) => ({ id, tsx, js, shared, code })));
      return diags.filter((d) => unitRangeToDoc(units.find((u) => u.id === d.id)!, d.start, d.length));
    };
    expect(check("```live-js\nconst r = await Promise.resolve(1)\nreturn r\n```\n")).toEqual([]);
    expect(toUnits(findTsBlocks("```js\nreturn 1\n```\n"))[0].code).toBe("return 1"); // a plain module
    // @ts-check still applies through the wrapper, and positions map back.
    const doc = "```live-js\n// @ts-check\nlet n = 1;\nn = 'x';\n```\n";
    const units = toUnits(findTsBlocks(doc));
    const [d] = check(doc);
    expect(d.code).toBe(2322);
    const r = unitRangeToDoc(units[0], d.start, d.length)!;
    expect(doc.slice(r.from, r.to)).toBe("n");
  });

  it("tilde fences may have backticks in the info string", () => {
    const blocks = findTsBlocks("~~~js title=\"Use `x`\"\nconst a = 1\n~~~\n");
    expect(blocks).toHaveLength(1);
    expect(findTsBlocks("```js title=`x`\nconst a = 1\n```\n")).toHaveLength(0);
  });

  it("shorthand properties keep their key when the binding is renamed", () => {
    const { units, input, diags } = checkShared(
      "const value = 1; const obj = { value }; const { value: v2, other = value } = obj;",
      "// @ts-check\nconst value = 'x';\nobj.value.toFixed();",
    );
    expect(units[1].code.split("\n;\n")[0]).toBe(
      "// @ts-check\nlet   value$prev = 1; let   obj = { value: value$prev }; let   { value: v2, other = value$prev } = obj;",
    );
    expect(diags).toEqual([]); // obj.value is still the number from the first block
    const at = units[1].code.lastIndexOf("value");
    expect(service.quickInfo(input, units[1].id, at + 1)?.text).toBe("(property) value: number");
  });

  it("describes the symbol under the cursor", () => {
    const code = "/** The answer. */\nconst answer = 42;\nanswer;";
    const info = service.quickInfo([{ id: "q0", code, tsx: false }], "q0", code.lastIndexOf("answer") + 2);
    expect(info?.text).toBe("const answer: 42");
    expect(info?.doc).toBe("The answer.");
  });
});
