/**
 * Plan W11.I11 — AlephBench on real local models (the Mac run, W11.M4). Not
 * part of the normal test run: LUMEN_EVAL_ALEPH=1 turns it on.
 *
 *   LUMEN_EVAL_ALEPH=1 npx vitest run --config vitest.eval.config.ts src/agents/eval/alephbench.eval.ts
 *
 *   LUMEN_EVAL_ALEPH_DIR    normalised JSONL, one file per subset (default eval/public/alephbench/normalized):
 *                           {"id","subset","input","context"?,"choices"?,"answer"} per line — see scripts/lib/alephbench.mjs
 *   LUMEN_EVAL_ALEPH_REV    the Hub revision the files came from (the card's dataset.version; required)
 *   LUMEN_EVAL_OLLAMA_URL   default http://localhost:11434
 *   LUMEN_EVAL_MODELS       default qwen3.5:4b,gemma4:e4b,qwen2.5:7b (must be pulled)
 *   LUMEN_EVAL_LIMIT        examples per subset (default: all)
 *   LUMEN_EVAL_SEED         default 1; temperature is 0
 *   LUMEN_EVAL_OUT          default eval/results
 *
 * Each model writes eval/results/alephbench-<model>-<date>.json with a card
 * (tag public, dataset "alephbench", metrics macro, nikud, subset_*), which
 * `npm run models:select -- --from eval/results` reads (W11.I12).
 */
import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error — plain .mjs module without type declarations
import { SUBSETS, cardScores, macroAverage, parseAlephJsonl, runAleph, scoresBySubset } from "../../../scripts/lib/alephbench.mjs";

/** scripts/lib/alephbench.mjs's example and engine (its JSDoc typedefs). */
interface AlephExample {
  id: string;
  subset: string;
  input: string;
  answer: string | number | string[];
}
interface AlephEngine {
  id: string;
  answer(prompt: string, e: AlephExample): Promise<string>;
}
// @ts-expect-error — plain .mjs module without type declarations
import { makeCard } from "../../../scripts/lib/evalCard.mjs";

const dir = process.env.LUMEN_EVAL_ALEPH_DIR || "eval/public/alephbench/normalized";
const rev = process.env.LUMEN_EVAL_ALEPH_REV || "";
const url = process.env.LUMEN_EVAL_OLLAMA_URL || "http://localhost:11434";
const models = (process.env.LUMEN_EVAL_MODELS || "qwen3.5:4b,gemma4:e4b,qwen2.5:7b").split(",").map((s) => s.trim()).filter(Boolean);
const limit = Number(process.env.LUMEN_EVAL_LIMIT || 0);
const seed = Number(process.env.LUMEN_EVAL_SEED || 1);
const outDir = process.env.LUMEN_EVAL_OUT || "eval/results";

function load(): AlephExample[] {
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".jsonl")) : [];
  const all: AlephExample[] = files.flatMap((f) => parseAlephJsonl(readFileSync(join(dir, f), "utf8")));
  return (SUBSETS as Array<{ id: string }>).flatMap((s) => {
    const xs = all.filter((e) => e.subset === s.id);
    return limit ? xs.slice(0, limit) : xs;
  });
}

function ollamaEngine(model: string): AlephEngine {
  return {
    id: `ollama:${model}`,
    async answer(prompt) {
      // privacy-ledger: the local Ollama the eval was pointed at (loopback by default)
      const res = await fetch(`${url}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, stream: false, think: false, messages: [{ role: "user", content: prompt }], options: { temperature: 0, seed } }),
      });
      if (!res.ok) throw new Error(`ollama ${res.status}`);
      const body = (await res.json()) as { message?: { content?: string } };
      return body.message?.content ?? "";
    },
  };
}

// skip-reason: an opt-in eval against real local models and the downloaded AlephBench (LUMEN_EVAL_ALEPH=1), not a unit test | task: W11.I11 | until: 2027-05-16
describe.skipIf(!process.env.LUMEN_EVAL_ALEPH)(`AlephBench — ${models.join(", ")} @ ${url}`, () => {
  it("runs every model over every subset and writes a carded report per model", async () => {
    expect(rev ? "ok" : "set LUMEN_EVAL_ALEPH_REV to the Hub revision the files came from").toBe("ok");
    const examples = load();
    const missing = (SUBSETS as Array<{ id: string }>).filter((s) => !examples.some((e) => e.subset === s.id)).map((s) => s.id);
    expect(missing, `subsets with no examples in ${dir}`).toEqual([]);
    // privacy-ledger: the same local Ollama
    const tags = (await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(3000) }).then((r) => r.json())) as { models?: { name: string; digest: string }[] };
    const date = new Date().toISOString().slice(0, 10);
    mkdirSync(outDir, { recursive: true });
    for (const model of models) {
      const tag = tags.models?.find((m) => m.name === model || m.name === `${model}:latest`);
      expect(tag ? "ok" : `model ${model} is not pulled — run: ollama pull ${model}`).toBe("ok");
      const rows = await runAleph(examples, ollamaEngine(model));
      const card = makeCard({
        tag: "public",
        model: { name: model, digest: `ollama:${tag?.digest}` },
        seed,
        temperature: 0,
        dataset: { name: `alephbench${limit ? `-first${limit}` : ""}`, version: rev, license: "per subset (see the dataset card)", source: "https://huggingface.co/datasets/HebArabNlpProject/AlephBench" },
        scores: cardScores(rows),
      });
      const macro = macroAverage(scoresBySubset(rows));
      writeFileSync(join(outDir, `alephbench-${model.replace(/[^\w.-]+/g, "_")}-${date}.json`), JSON.stringify({ card, kind: "model", url, macro, rows }, null, 2));
      // hygiene-allow: progress output of a CLI eval run
      console.log(`${model}: AlephBench macro ${(macro * 100).toFixed(1)}`);
    }
  }, 12 * 60 * 60 * 1000);
});
