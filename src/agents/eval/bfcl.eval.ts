/**
 * Plan W11.I15 — BFCL v4 on real local models (research R4.11). Not part of
 * the normal test run: `npm run eval:bfcl` sets LUMEN_EVAL_BFCL=1.
 *
 *   LUMEN_EVAL_OLLAMA_URL   default http://localhost:11434
 *   LUMEN_EVAL_MODELS       default gemma4:e4b,qwen3.5:4b,qwen2.5:7b (must be pulled)
 *   LUMEN_EVAL_CATEGORIES   default simple,multiple,parallel,multi_turn
 *   LUMEN_EVAL_LIMIT        entries per category (default: all — 400/200/200/200)
 *   LUMEN_EVAL_SEED         default 1; temperature is 0
 *   LUMEN_EVAL_OUT          default eval/results
 *
 * Every model runs twice, without and with toolRepair, and each run writes
 * one report with an eval card (W11.I18, tag public, BFCL's commit as the
 * version, a bootstrap interval per category). Target for the chosen
 * default: ≥ 90 % ast_simple and ≥ 80 % ast_multiple.
 */

import { describe, it, expect } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CATEGORIES, CLASS_DOCS, FILES, METRIC, parseJsonl, runBfcl, scoresByCategory, type BfclAnswer, type BfclCategory, type BfclData, type BfclEngine, type BfclEntry, type BfclFunction, type EngineMessage } from "./bfcl";
// @ts-expect-error — plain .mjs module without type declarations
import { makeCard } from "../../../scripts/lib/evalCard.mjs";

const DIR = "eval/public/bfcl-v4";
const url = process.env.LUMEN_EVAL_OLLAMA_URL || "http://localhost:11434";
const models = (process.env.LUMEN_EVAL_MODELS || "gemma4:e4b,qwen3.5:4b,qwen2.5:7b").split(",").map((s: string) => s.trim()).filter(Boolean);
const cats = (process.env.LUMEN_EVAL_CATEGORIES || CATEGORIES.join(",")).split(",").map((s: string) => s.trim()) as BfclCategory[];
const limit = Number(process.env.LUMEN_EVAL_LIMIT || 0);
const seed = Number(process.env.LUMEN_EVAL_SEED || 1);
const outDir = process.env.LUMEN_EVAL_OUT || "eval/results";

function load(): BfclData {
  const read = (p: string) => readFileSync(join(DIR, p), "utf8");
  const entries = cats.flatMap((c) => {
    const all = parseJsonl<BfclEntry>(read(`data/${FILES[c]}`));
    return limit ? all.slice(0, limit) : all;
  });
  const answers = new Map(cats.flatMap((c) => parseJsonl<BfclAnswer>(read(`possible_answer/${FILES[c]}`))).map((a) => [a.id, a]));
  const classDocs = Object.fromEntries(Object.entries(CLASS_DOCS).map(([c, f]) => [c, parseJsonl<BfclFunction>(read(`multi_turn_func_doc/${f}`))]));
  return { entries, answers, classDocs };
}

/** Ollama's native tool calling (/api/chat with `tools`), temperature 0 and a fixed seed. */
function ollamaEngine(model: string): BfclEngine {
  const toOllama = (m: EngineMessage) =>
    m.role === "assistant" && m.toolCalls ? { role: "assistant", content: "", tool_calls: m.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.args } })) } : { role: m.role, content: m.content };
  return {
    id: `ollama:${model}`,
    async step(messages, tools) {
      // privacy-ledger: the local Ollama the eval was pointed at (loopback by default)
      const res = await fetch(`${url}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, stream: false, messages: messages.map(toOllama), tools: tools.map((t) => ({ type: "function", function: t })), options: { temperature: 0, seed } }),
      });
      if (!res.ok) throw new Error(`ollama ${res.status}`);
      const body = (await res.json()) as { message?: { tool_calls?: { function: { name: string; arguments: unknown } }[] } };
      return (body.message?.tool_calls ?? []).map((c) => ({ name: c.function.name, args: c.function.arguments }));
    },
  };
}

// skip-reason: an opt-in eval against real local models (LUMEN_EVAL_BFCL=1), not a unit test | task: W11.I15 | until: 2027-05-15
describe.skipIf(!process.env.LUMEN_EVAL_BFCL)(`BFCL v4 — ${models.join(", ")} @ ${url}`, () => {
  it("runs every model with and without toolRepair and writes a carded report per run", async () => {
    const manifest = JSON.parse(readFileSync(join(DIR, "manifest.json"), "utf8")) as { commit: string; license: string; source: string };
    // privacy-ledger: the same local Ollama
    const tags = (await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(3000) }).then((r) => r.json())) as { models?: { name: string; digest: string }[] };
    const data = load();
    const date = new Date().toISOString().slice(0, 10);
    mkdirSync(outDir, { recursive: true });
    const lines: string[] = [];
    for (const model of models) {
      const tag = tags.models?.find((m) => m.name === model || m.name === `${model}:latest`);
      expect(tag ? "ok" : `model ${model} is not pulled — run: ollama pull ${model}`).toBe("ok");
      for (const repair of [false, true]) {
        const rows = await runBfcl(data, ollamaEngine(model), { repair }, (r) => {
          // hygiene-allow: progress output of a CLI eval run
          console.log(`${r.valid ? "ok  " : "FAIL"}  ${model}${repair ? " +repair" : ""}  ${r.id}${r.errorType ? `  ${r.errorType}` : ""}`);
        });
        const scores = Object.fromEntries(Object.entries(scoresByCategory(rows)).map(([c, xs]) => [METRIC[c as BfclCategory], xs]));
        const card = makeCard({
          tag: "public",
          model: { name: model, digest: `ollama:${tag?.digest}` },
          seed,
          temperature: 0,
          dataset: { name: `bfcl-v4${limit ? `-first${limit}` : ""}`, version: manifest.commit, license: manifest.license, source: manifest.source },
          scores,
        });
        const name = `bfcl-v4-${model.replace(/[^\w.-]+/g, "_")}-${repair ? "repair" : "raw"}-${date}`;
        writeFileSync(join(outDir, `${name}.json`), JSON.stringify({ card, kind: "model", url, repair, note: "multi_turn_calls is the Lumen harness's ordered call match with stubbed results, not BFCL's execution-based multi-turn accuracy", rows }, null, 2));
        const m = card.metrics as Record<string, { value: number; ci95: [number, number] }>;
        lines.push(`| ${model} | ${repair ? "yes" : "no"} | ${Object.values(METRIC).map((k) => (m[k] ? `${(m[k].value * 100).toFixed(1)} % [${(m[k].ci95[0] * 100).toFixed(1)}, ${(m[k].ci95[1] * 100).toFixed(1)}]` : "—")).join(" | ")} |`);
      }
    }
    const md = [`# BFCL v4 — ${date}`, "", `BFCL commit ${manifest.commit}. AST accuracy with bootstrap 95% intervals. multi_turn_calls is ours (stubbed results), not the leaderboard's multi-turn score.`, "", "| Model | toolRepair | ast_simple | ast_multiple | ast_parallel | multi_turn_calls |", "|---|---|---|---|---|---|", ...lines].join("\n");
    writeFileSync(join(outDir, `bfcl-v4-${date}.md`), md + "\n");
    // hygiene-allow: tells the person running the eval where the report is
    console.log(`\n${md}\n`);
  }, 12 * 60 * 60 * 1000);
});
