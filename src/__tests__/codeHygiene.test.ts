import { describe, it, expect } from "vitest";
// @ts-expect-error — plain .mjs script without type declarations
import { findViolations } from "../../scripts/check-code-hygiene.mjs";

type Violation = { line: number; rule: string; text: string };
const check = (src: string, name = "x.ts"): Violation[] => findViolations(name, src);

describe("scripts/check-code-hygiene", () => {
  it("flags `as any` casts and console.log calls", () => {
    const v = check(`const a = b as any;\nconsole.log("hi");\n`);
    expect(v.map((x) => x.rule)).toEqual(["as-any", "console-log"]);
    expect(v.map((x) => x.line)).toEqual([1, 2]);
  });

  it("ignores strings, template literals, comments and other console methods", () => {
    const v = check(
      [
        `const s = 'console.log("x") as any';`,
        "const t = `console.log(1)`;",
        "// console.log(nope) as any",
        "console.info('ok'); console.warn('ok');",
      ].join("\n"),
    );
    expect(v).toEqual([]);
  });

  it("honours a justified hygiene-allow comment", () => {
    expect(check(`// hygiene-allow: dev sink\nconsole.log(1);`)).toEqual([]);
    expect(check(`console.log(1); // hygiene-allow: reason`)).toEqual([]);
    // A bare marker without justification does not count.
    expect(check(`// hygiene-allow:\nconsole.log(1);`)).toHaveLength(1);
  });

  it("parses TSX", () => {
    expect(check(`const el = <div>{(x as any).y}</div>;`, "c.tsx")).toHaveLength(1);
  });
});
