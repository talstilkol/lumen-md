/**
 * The clean-room scan (scripts/clean-room-scan.mjs, W12.E1/E8): a copied
 * function is found even when its comments, strings and layout changed;
 * stock idioms and independent code are not reported.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error — a plain .mjs script
import { scan, tokenize } from "../../scripts/clean-room-scan.mjs";

type Run = { file: string; fromLine: number; toLine: number; tokens: number; refFile: string; refLine: number };
const run = (ours: string, refs: string, k?: number): Run[] => scan({ ours: [{ file: "ours.ts", src: ours }], refs: [{ file: "ref.js", src: refs }], k });

const reference = `
// AGPL reference
function assembleGraph(claims, entities, options) {
  const byId = new Map(entities.map((e) => [e.id, e]));
  const edges = [];
  for (const claim of claims) {
    if (!byId.has(claim.subject) || !byId.has(claim.object)) continue;
    const evidence = claim.evidence.filter((ev) => ev.quote && ev.sha256);
    if (!evidence.length && options.strict) throw new Error("claim without evidence: " + claim.id);
    edges.push({ source: claim.subject, target: claim.object, predicate: claim.predicate, weight: evidence.length });
  }
  return { nodes: [...byId.values()], edges };
}
`;

describe("clean-room scan", () => {
  it("finds a copied function after comments, strings, types and layout changed", () => {
    const copied = `
/** our own words */
export function assembleGraph(claims: any, entities: any, options: any) {
  const byId = new Map(entities.map((e: any) => [e.id, e]));
  const edges: any[] = [];
  for (const claim of claims) {
    if (!byId.has(claim.subject) || !byId.has(claim.object)) continue;
    const evidence = claim.evidence.filter((ev: any) => ev.quote && ev.sha256);
    if (!evidence.length && options.strict) throw new Error(\`no evidence \${claim.id}\`);
    edges.push({ source: claim.subject, target: claim.object, predicate: claim.predicate, weight: evidence.length });
  }
  return { nodes: [...byId.values()], edges };
}`;
    // Type annotations break up the token stream; the untyped tail is still a long shared run.
    const runs = run(copied, reference);
    expect(runs.length).toBeGreaterThan(0);
    expect(runs[0]).toMatchObject({ file: "ours.ts", refFile: "ref.js" });
    expect(runs[0].tokens).toBeGreaterThanOrEqual(40);
    expect(run(copied.replace(/: any(\[\])?/g, ""), reference)[0].tokens).toBeGreaterThan(100);
  });

  it("does not report a stock idiom or independent code for the same job", () => {
    const own = `
export function toEdges(g: Graph): Edge[] {
  const known = new Set(g.entities.map((x) => x.id));
  return g.edges.filter((x) => known.has(x.subject) && known.has(x.object)).map((x) => ({ ...x, provenance: { ...x.provenance } }));
}
for (let i = 0; i < n; i++) total += xs[i];
const a = document.createElement("a");
a.href = URL.createObjectURL(blob);
a.click();`;
    expect(run(own, reference)).toEqual([]);
  });

  it("drops comments and string contents, keeps the lines", () => {
    const t = tokenize('const a = "x y z"; // note\n/* block\n */ f(a)', "a.ts");
    expect(t.map((x: { t: string }) => x.t)).toEqual(["const", "a", "=", "S", ";", "f", "(", "a", ")"]);
    expect(t.at(-1).line).toBe(3);
    expect(tokenize('x = """doc\nstring"""  # c\ny', "a.py").map((x: { t: string }) => x.t)).toEqual(["x", "=", "S", "y"]);
  });

  it("a list of strings or numbers is not a copy, however long", () => {
    const table = `const T = [${Array.from({ length: 80 }, (_, i) => `"w${i}"`).join(", ")}];`;
    expect(run(table, table)).toEqual([]);
  });
});
