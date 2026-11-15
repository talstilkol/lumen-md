// @vitest-environment node
/**
 * Plan W11.I18 — the eval honesty pack: `npm run eval:card` refuses a report
 * whose card is missing a field, and plan:check refuses a ✅ that rests on a
 * dev report (R4.13).
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  validateCard,
  bootstrapCi,
  cohenKappa,
  makeCard,
  checkEvalClaims,
  // @ts-expect-error — plain .mjs module without type declarations
} from "../../scripts/lib/evalCard.mjs";
// @ts-expect-error — plain .mjs script without type declarations
import { main as evalCard } from "../../scripts/eval-card.mjs";
// @ts-expect-error — plain .mjs script without type declarations
import { run as planRun } from "../../scripts/plan/build.mjs";

const ROOT = resolve(__dirname, "..", "..");
const tmp = mkdtempSync(join(tmpdir(), "lumen-evalcard-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

type Card = Record<string, any>;
const card = (over: Card = {}): Card => ({
  schema: 1,
  tag: "public",
  model: { name: "qwen3.5:4b", digest: "sha256:2b9f1c0a7d3e" },
  seed: 7,
  temperature: 0,
  dataset: { name: "bfcl-v4-simple", version: "v4@2026-04-12", license: "Apache-2.0", source: "https://github.com/ShishirPatil/gorilla" },
  n: 40,
  metrics: { ast: { value: 0.9, ci95: [0.8, 0.975], method: "bootstrap" } },
  ...over,
});
/** A copy of the card with one dotted path removed. */
const without = (c: Card, path: string): Card => {
  const copy = JSON.parse(JSON.stringify(c));
  const keys = path.split(".");
  const last = keys.pop() as string;
  delete keys.reduce((o, k) => o[k], copy)[last];
  return copy;
};
const quiet = { log: () => {}, err: () => {} };
let k = 0;
const writeReport = (report: unknown): string => {
  const dir = join(tmp, `r${k++}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "report.json"), JSON.stringify(report));
  return dir;
};

describe("validateCard", () => {
  it("a complete card has no problems", () => {
    expect(validateCard(card())).toEqual([]);
    expect(validateCard(card({ tag: "dev", dataset: { name: "probe", version: "1", license: "MIT" } }))).toEqual([]);
  });

  const required = ["schema", "tag", "model", "model.name", "model.digest", "seed", "temperature", "dataset", "dataset.name", "dataset.version", "dataset.license", "n", "metrics", "metrics.ast.ci95", "metrics.ast.method", "metrics.ast.value"];
  it.each(required)("eval:card fails a report whose card has no %s", (path) => {
    const c = without(card(), path);
    expect(validateCard(c).length).toBeGreaterThan(0);
    expect(evalCard([writeReport({ card: c, results: [] })], { root: tmp, ...quiet })).toBe(1);
  });

  it("eval:card passes a report with a complete card, and fails one with no card at all", () => {
    expect(evalCard([writeReport({ card: card(), results: [] })], { root: tmp, ...quiet })).toBe(0);
    expect(evalCard([writeReport({ results: [1, 0, 1] })], { root: tmp, ...quiet })).toBe(1);
  });

  it("a public set names where it is published", () => {
    expect(validateCard(without(card(), "dataset.source")).join()).toMatch(/dataset\.source/);
  });

  it("an interval that does not contain its value is refused", () => {
    expect(validateCard(card({ metrics: { ast: { value: 0.9, ci95: [0.5, 0.6], method: "bootstrap" } } })).join()).toMatch(/does not contain/);
  });

  it("an LLM-judged metric needs κ ≥ 0.6 against ≥ 50 human labels", () => {
    const judged = { metrics: { faithful: { value: 0.9, ci95: [0.85, 0.95], method: "bootstrap", judge: "llm" } } };
    expect(validateCard(card(judged)).join()).toMatch(/judgeCalibration/);
    expect(validateCard(card({ ...judged, judgeCalibration: { kappa: 0.55, humanLabels: 80 } })).join()).toMatch(/not calibrated/);
    expect(validateCard(card({ ...judged, judgeCalibration: { kappa: 0.7, humanLabels: 49 } })).join()).toMatch(/49 < 50/);
    expect(validateCard(card({ ...judged, judgeCalibration: { kappa: 0.7, humanLabels: 50 } }))).toEqual([]);
  });
});

describe("bootstrapCi and cohenKappa", () => {
  it("the interval contains the mean, is reproducible from the seed, and narrows with n", () => {
    const small = Array.from({ length: 20 }, (_, i) => (i % 4 === 0 ? 0 : 1));
    const big = Array.from({ length: 400 }, (_, i) => (i % 4 === 0 ? 0 : 1));
    const a = bootstrapCi(small, { seed: 3 });
    expect(a.value).toBe(0.75);
    expect(a.ci95[0]).toBeLessThanOrEqual(0.75);
    expect(a.ci95[1]).toBeGreaterThanOrEqual(0.75);
    expect(bootstrapCi(small, { seed: 3 })).toEqual(a);
    const b = bootstrapCi(big, { seed: 3 });
    expect(b.ci95[1] - b.ci95[0]).toBeLessThan(a.ci95[1] - a.ci95[0]);
  });

  it("κ matches the textbook values", () => {
    expect(cohenKappa([1, 1, 0, 0], [1, 0, 0, 0])).toBeCloseTo(0.5, 10);
    expect(cohenKappa(["a", "b", "a"], ["a", "b", "a"])).toBe(1);
  });

  it("makeCard refuses to build a card eval:card would refuse", () => {
    const base = { tag: "public", model: { name: "m", digest: "sha256:ab" }, seed: 1, temperature: 0, dataset: { name: "d", version: "1", license: "Apache-2.0", source: "https://example.org/d" }, scores: { acc: [1, 0, 1, 1] } };
    const c = makeCard(base);
    expect(validateCard(c)).toEqual([]);
    expect(c.n).toBe(4);
    expect(() => makeCard({ ...base, model: { name: "m", digest: "" } })).toThrow(/digest/);
  });
});

describe("plan:check — ✅ only on a public or heldout report", () => {
  const plan = (task: Record<string, unknown>) => ({ phases: [{ tasks: [{ id: "W9.9", title: "x", ...task }] }] });
  const files: Record<string, Card> = { "eval/cards/dev.json": card({ tag: "dev" }), "eval/cards/pub.json": card(), "eval/cards/held.json": card({ tag: "heldout" }), "eval/cards/bad.json": without(card(), "seed") };
  const read = (p: string) => {
    if (!(p in files)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return { card: files[p] };
  };

  it("a dev report cannot turn ✅* into ✅", () => {
    expect(checkEvalClaims(plan({ status: "✅* #1", dodMock: true, dod: ["npm run eval:x"], evalCards: ["eval/cards/dev.json"] }), read)).toEqual([]);
    const p = checkEvalClaims(plan({ status: "✅ #1", dod: ["npm run eval:x"], evalCards: ["eval/cards/dev.json"] }), read);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/✅ on a dev report/);
  });

  it("a public or heldout card makes ✅", () => {
    expect(checkEvalClaims(plan({ status: "✅ #1", dod: ["npm run eval:x"], evalCards: ["eval/cards/pub.json"] }), read)).toEqual([]);
    expect(checkEvalClaims(plan({ status: "✅ #1", dod: ["npm run eval:x"], evalCards: ["eval/cards/held.json"] }), read)).toEqual([]);
  });

  it("an incomplete or missing card refuses ✅", () => {
    expect(checkEvalClaims(plan({ status: "✅ #1", dod: ["true"], evalCards: ["eval/cards/bad.json"] }), read)[0]).toMatch(/incomplete/);
    expect(checkEvalClaims(plan({ status: "✅ #1", dod: ["true"], evalCards: ["eval/cards/none.json"] }), read)[0]).toMatch(/cannot be read/);
  });

  it("a ✅ whose dod runs an eval must cite its card", () => {
    expect(checkEvalClaims(plan({ status: "✅ #1", dod: ["npm run models:day -- --quick"] }), read)[0]).toMatch(/without evalCards/);
    expect(checkEvalClaims(plan({ status: "✅ #1", dod: ["npm run test -- foo"] }), read)).toEqual([]);
  });

  it("the checked-in plan follows the rule", () => {
    const p = JSON.parse(readFileSync(join(ROOT, "plan/plan.json"), "utf8"));
    expect(checkEvalClaims(p, (f: string) => JSON.parse(readFileSync(join(ROOT, f), "utf8")))).toEqual([]);
  });

  it("plan:check itself refuses the dev ✅", () => {
    const root = join(tmp, "planroot");
    mkdirSync(join(root, "plan"), { recursive: true });
    mkdirSync(join(root, "eval/cards"), { recursive: true });
    writeFileSync(join(root, "eval/cards/dev.json"), JSON.stringify({ card: card({ tag: "dev" }) }));
    writeFileSync(join(root, "plan/plan.json"), JSON.stringify({ ...plan({ status: "✅ #1", dod: ["npm run eval:x"], evalCards: ["eval/cards/dev.json"] }), dodGrandfathered: [], dodRevoked: [] }));
    expect(() => planRun({ root, check: true })).toThrow(/dev report/);
  });
});
