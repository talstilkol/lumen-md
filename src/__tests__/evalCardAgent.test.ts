/**
 * `npm run eval:card -- --agent <id>` (W13.W6's dod): the card of one
 * writing agent, from eval/cards/writing/<id>.json or any report whose
 * card names the agent; exit 1 when the agent has none or its card is
 * incomplete.
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — plain .mjs script without type declarations
import { agentReports, main as evalCard } from "../../scripts/eval-card.mjs";

const tmp = mkdtempSync(join(tmpdir(), "lumen-evalcard-agent-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const quiet = { log: () => {}, err: () => {} };
const card = (over: Record<string, unknown> = {}) => ({
  schema: 1,
  tag: "dev",
  model: { name: "rules", digest: "n/a" },
  seed: 1,
  temperature: 0,
  dataset: { name: "x", version: "1", license: "MIT" },
  n: 3,
  metrics: { precision: { value: 1, ci95: [1, 1], method: "bootstrap" } },
  ...over,
});

describe("eval:card --agent", () => {
  const root = join(tmp, "root");
  mkdirSync(join(root, "eval/cards/writing"), { recursive: true });
  mkdirSync(join(root, "eval/results"), { recursive: true });
  writeFileSync(join(root, "eval/cards/writing/good.json"), JSON.stringify({ card: card() }));
  writeFileSync(join(root, "eval/cards/writing/bad.json"), JSON.stringify({ card: card({ n: 0 }) }));
  writeFileSync(join(root, "eval/results/named.json"), JSON.stringify({ card: card({ agent: "named" }) }));

  it("finds the agent's file and reports that name it", () => {
    expect(agentReports("good", { root })).toEqual(["eval/cards/writing/good.json"]);
    expect(agentReports("named", { root })).toEqual(["eval/results/named.json"]);
    expect(agentReports("none", { root })).toEqual([]);
  });

  it("exit 0 on a complete card, 1 on an incomplete one or none", () => {
    expect(evalCard(["--agent", "good"], { root, ...quiet })).toBe(0);
    expect(evalCard(["--agent", "named"], { root, ...quiet })).toBe(0);
    expect(evalCard(["--agent", "bad"], { root, ...quiet })).toBe(1);
    expect(evalCard(["--agent", "none"], { root, ...quiet })).toBe(1);
    expect(evalCard(["--agent"], { root, ...quiet })).toBe(2); // a usage error (W13.W12 shares --agent)
  });

  it("checks only that agent, not every report", () => {
    // bad.json is incomplete, yet --agent good passes: the other cards are not read.
    expect(evalCard([], { root, ...quiet })).toBe(1);
    expect(evalCard(["--agent", "good"], { root, ...quiet })).toBe(0);
  });
});
