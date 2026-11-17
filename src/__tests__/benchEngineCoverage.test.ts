/**
 * Plan 7.8, W10.E34 / W10.E35: every engine in models/registry.json has a
 * bench, and the scorers of the new engines' sets run the app's own code on
 * the committed dev items. The engines themselves run in a real browser
 * (`npm run bench:models`); here they are only imported and read.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
// @ts-expect-error — plain .mjs module without type declarations
import { TASKS } from "../../scripts/bench/tasks.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import { loadSet } from "../../scripts/lib/golden.mjs";
import type { BenchEngine, BenchFamily } from "../bench/types";

const ROOT = resolve(__dirname, "../..");
const GOLDEN = join(ROOT, "eval/golden");
type Entry = { id: string; delivery: string; runs: string; kind: string };
const registry = (JSON.parse(readFileSync(join(ROOT, "models/registry.json"), "utf8")) as { models: Entry[] }).models;
const dev = (set: string) => loadSet(GOLDEN, set, { split: "dev" }) as { items: Array<Record<string, unknown> & { id: string; part: string }>; corpus?: unknown };

async function engines(): Promise<Array<{ file: string; engine: BenchEngine; family?: BenchFamily }>> {
  const dir = join(ROOT, "src/bench/engines");
  const out = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts")).sort()) {
    const mod = (await import(`../bench/engines/${f.replace(/\.ts$/, "")}`)) as { engine: BenchEngine; family?: BenchFamily };
    out.push({ file: f.replace(/\.ts$/, ""), ...mod });
  }
  return out;
}

describe("every registry engine has a bench (W10.E35)", () => {
  it("each entry the app ships (delivery is not \"none\") is a model of an engine or of a family's variant", async () => {
    const all = await engines();
    const covered = new Set<string>();
    for (const { engine, family } of all) {
      engine.models.forEach((m) => covered.add(m));
      for (const v of family?.variants ?? []) family!.variant(v).models.forEach((m) => covered.add(m));
    }
    const missing = registry.filter((m) => m.delivery !== "none" && !covered.has(m.id)).map((m) => m.id);
    expect(missing).toEqual([]);
    // "none": catalogue entries the app has no code for (TTS voices, NLLB, jina, eld, DictaLM 12B/24B, …).
    // They stay out until a feature branch ships them, and with it their engine.
    const none = registry.filter((m) => m.delivery === "none").map((m) => m.id);
    expect(none.every((id) => !covered.has(id)), "a bench for a model the app does not run").toBe(true);
  }, 120_000);

  it("every engine and variant: a registry model, a golden set and a scorer; one model per variant", async () => {
    const ids = new Set(registry.map((m) => m.id));
    const sets = readdirSync(GOLDEN);
    for (const { file, engine, family } of await engines()) {
      const list = [engine, ...(family?.variants ?? []).map((v) => family!.variant(v))];
      for (const e of list) {
        expect(e.id === file || e.id.startsWith(`${file}:`), e.id).toBe(true);
        expect(sets, e.id).toContain(e.set);
        expect(Object.keys(TASKS), e.id).toContain(e.task ?? e.set);
        for (const m of e.models) expect(ids.has(m), `${e.id}: ${m}`).toBe(true);
      }
      for (const v of family?.variants ?? []) expect(family!.variant(v).models).toEqual([v]);
    }
  }, 120_000);
});

describe("the new sets' scorers (W10.E34, W10.E35)", () => {
  it("nikud: the app's nikud.ts, bundled for Node, scores the committed dev items", async () => {
    const { items } = dev("nikud");
    expect(items.length).toBeGreaterThan(0);
    const p = await TASKS.nikud.payload({ items });
    expect(p.items[0].input.text).not.toMatch(/[ְ-ׇ]/);
    const perfect = await TASKS.nikud.score(items, Object.fromEntries(items.map((it) => [it.id, it.text])));
    expect(perfect.skeleton_ok).toBe(1);
    expect(perfect.benyehuda_der).toBe(0);
    expect(perfect.benyehuda_word_acc).toBe(1);
    // The unpointed input back: the skeleton holds, every pointed letter is wrong.
    const bare = await TASKS.nikud.score(items, Object.fromEntries(p.items.map((x: { id: string; input: { text: string } }) => [x.id, x.input.text])));
    expect(bare.skeleton_ok).toBe(1);
    expect(bare.benyehuda_der).toBeGreaterThan(0.5);
  }, 120_000);

  it("langid, typos-he and lexicon-coverage from the page's answers", () => {
    const lang = dev("langid").items;
    expect(TASKS.langid.score(lang, Object.fromEntries(lang.map((it) => [it.id, it.lang]))).hard_accuracy).toBe(1);
    expect(TASKS.langid.score(lang, {}).hard_accuracy).toBe(0);
    const typos = dev("typos-he").items as Array<{ id: string; part: string; clean: string; errors: Array<{ start: number; end: number; nonword: boolean }> }>;
    const exact = Object.fromEntries(typos.map((it) => [it.id, { text: it.errors.map((e) => ({ offset: e.start, length: e.end - e.start })), clean: [] }]));
    const q = TASKS["typos-he"].score(typos, exact);
    expect(q.recall_nonword).toBe(1);
    expect(q.fp_per_token).toBe(0);
    const words = TASKS["lexicon-coverage"].payload({ items: typos }).items as Array<{ id: string; input: { words: string[] } }>;
    const all = Object.fromEntries(words.map((x) => [x.id, x.input.words.length]));
    expect(TASKS["lexicon-coverage"].score(typos, all).coverage).toBe(1);
    expect(TASKS["lexicon-coverage"].score(typos, {}).coverage).toBe(0);
  });

  it("ner-pii: the set's rules on the page's spans", async () => {
    const { items } = dev("ner-pii");
    // @ts-expect-error — plain .mjs module without type declarations
    const { goldOf } = await import("../../scripts/golden/evals/ner-pii.mjs");
    const q = await TASKS["ner-pii"].score(items, Object.fromEntries(items.map((it) => [it.id, goldOf(it)])));
    expect(q["recall.names"]).toBe(1);
    expect(q["falseRedactions.negatives"]).toBe(0);
  });

  it("data-analysis: reference programs in the payload, the app's matchesGolden() on the answers", async () => {
    const { items, corpus } = dev("data-analysis");
    const p = TASKS["data-analysis"].payload({ items, corpus });
    expect(p.items.length).toBeGreaterThan(0);
    expect(p.items[0].input.csv).toMatch(/,/);
    expect(p.items[0].input.code).toMatch(/inputs/);
    expect((await TASKS["data-analysis"].score(items, Object.fromEntries(items.map((it) => [it.id, it.answer])))).accuracy).toBe(1);
    expect((await TASKS["data-analysis"].score(items, {})).accuracy).toBe(0);
  }, 120_000);

  it("mt-en-he scores against the Hebrew side", () => {
    const { items } = dev("mt-he-en");
    const p = TASKS["mt-en-he"].payload({ items });
    expect(p.items[0].input.text).toBe(items.find((it) => it.id === p.items[0].id)!.en);
    expect(TASKS["mt-en-he"].score(items, Object.fromEntries(items.map((it) => [it.id, it.he]))).chrf).toBe(100);
  });
});
