/**
 * Plan W7.5 acceptance 3 against a real local model: the 20 golden
 * questions on 5 laws (src/__tests__/fixtures/knesset/askTheLaw.json), each
 * through the app's search, answer and critic (askTheLawEval.ts). Target:
 * ≥ 18 answers verified by the critic with the golden law and section.
 *
 *   LUMEN_EVAL_LAW=1 npx vitest run --config vitest.eval.config.ts src/agents/eval/askTheLaw.eval.ts
 *
 *   LUMEN_EVAL_OLLAMA_URL   default http://localhost:11434
 *   LUMEN_EVAL_MODEL        default qwen2.5:7b (must be pulled)
 *   LUMEN_EVAL_OUT          report directory, default eval/results
 *
 * Writes <out>/ask-the-law@<model>.json ({task, total, correct, need, pass, rows}).
 * The fixtures are excerpts (see fixtures/knesset/SOURCES.md), not the
 * consolidated texts.
 */
import { describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runLawQuestion, savedLaws, scoreLaw, type LawGolden, type LawRow } from "./askTheLawEval";
import type { LawChat } from "../../sources/knesset/answer";

const url = process.env.LUMEN_EVAL_OLLAMA_URL || "http://localhost:11434";
const model = process.env.LUMEN_EVAL_MODEL || "qwen2.5:7b";
const outDir = process.env.LUMEN_EVAL_OUT || "eval/results";
const FIX = join(__dirname, "../../__tests__/fixtures/knesset");

// skip-reason: an opt-in eval against a real local model (LUMEN_EVAL_LAW=1), not a unit test | task: W7.5 | until: 2027-05-16
describe.skipIf(!process.env.LUMEN_EVAL_LAW)(`ask the law — ${model} @ ${url}`, () => {
  it("answers the 20 golden questions; ≥ 18 verified with the right section", async () => {
    // privacy-ledger: Ollama of the eval harness: runs in Node (vitest eval), where no ledger is installed
    const tags = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(3000) }).catch((e: Error) => e);
    expect(tags instanceof Error ? `Ollama unreachable at ${url}: ${tags.message}` : "ok").toBe("ok");
    const golden = JSON.parse(readFileSync(join(FIX, "askTheLaw.json"), "utf8")) as LawGolden;
    const saved = savedLaws(golden, JSON.parse(readFileSync(join(FIX, "laws.v4.json"), "utf8")));
    const chat: LawChat = async (messages, signal) => {
      // privacy-ledger: Ollama of the eval harness: runs in Node (vitest eval), where no ledger is installed
      const r = await fetch(`${url}/api/chat`, { method: "POST", signal, body: JSON.stringify({ model, messages, stream: false, options: { temperature: 0, seed: 1 } }) });
      if (!r.ok) throw new Error(`Ollama ${r.status}`);
      return ((await r.json()) as { message?: { content?: string } }).message?.content ?? "";
    };
    const rows: LawRow[] = [];
    for (const g of golden.questions) {
      const row = await runLawQuestion(g, saved, chat);
      rows.push(row);
      // hygiene-allow: progress output of a CLI eval run
      console.log(`${row.correct ? "✓" : "✗"} ${row.q} → ${row.gotLaw ?? "-"} §${row.gotSection ?? "-"} (${row.critic})`);
    }
    const score = scoreLaw(rows);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, `ask-the-law@${model.replace(/[^\w.-]+/g, "_")}.json`), JSON.stringify({ ...score, model, url, date: new Date().toISOString(), rows }, null, 2) + "\n");
    expect(score.total).toBe(20);
    expect(score.correct).toBeGreaterThanOrEqual(score.need);
  });
});
