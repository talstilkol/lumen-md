/**
 * Audit W10.C23 (plan 2.6): name redaction no longer dies silently when no
 * converted name model exists (CONVERTED_MODELS_BASE is null today).
 *  - The fallback is Ollama on this machine, through the agent runtime and
 *    the pii-names agent, whose answer is held to the text. Here Ollama is
 *    a scripted executor; the runtime, the agent and its validator are real.
 *  - With no name finder at all, the preview says names are not hidden.
 *  - bert-base-NER (English) is in the model registry, the conversion
 *    targets and the converted-model catalog.
 * The texts are synthetic.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { namesEngine, ollamaNamesFinder, spansOf } from "../ai/piiNer";
import { __setNer, __setPreview, redactForCloud, setPreviewEnabled } from "../ai/piiRedactor";
import { registerExecutor, resetExecutors } from "../agents/executors";
import { fakeExecutor, reply } from "./helpers/fakeExecutor";
import { CONVERTED_MODELS } from "../ai/convertedModels";
import { t } from "../i18n";

const TEXT = "Dana Levi asked Yossi Cohen to call Dana Levi back at 054-1471258.";

beforeEach(() => {
  resetExecutors();
  localStorage.setItem("lumen.ai.cache", "off");
  __setNer(undefined);
  __setPreview(null);
  setPreviewEnabled(false);
});

describe("the name finder's fallback (W10.C23)", () => {
  it("no converted model and no Ollama: engine none, no finder", async () => {
    expect(await namesEngine({ cached: async () => null })).toEqual({ engine: "none", ner: null });
  });

  it("a cached model comes first (Hebrew, then English)", async () => {
    const fake = async () => [];
    expect((await namesEngine({ cached: async (id) => (id === "dictabert-ner" ? fake : null) })).engine).toBe("dictabert");
    expect((await namesEngine({ cached: async (id) => (id === "bert-base-ner" ? fake : null) })).engine).toBe("bert-base-ner");
  });

  it("Ollama on this machine finds the names through the runtime; every occurrence is hidden", async () => {
    registerExecutor(fakeExecutor(() => reply('{"names": ["Dana Levi", "Yossi Cohen"]}')));
    const { engine, ner } = await namesEngine({ cached: async () => null });
    expect(engine).toBe("ollama");
    const spans = await ner!(TEXT);
    expect(spans.map((s) => TEXT.slice(s.start, s.end))).toEqual(["Dana Levi", "Yossi Cohen", "Dana Levi"]);
    __setNer(ner);
    const { messages } = await redactForCloud([{ role: "user", content: TEXT }], "anthropic");
    expect(messages[0].content).not.toMatch(/Dana|Yossi|054-1471258/);
  });

  it("a name the model made up is refused by the agent's check, so nothing false is hidden or claimed", async () => {
    registerExecutor(fakeExecutor(() => reply('{"names": ["Moshe Peretz"]}')));
    await expect(ollamaNamesFinder()(TEXT)).rejects.toThrow();
    expect(spansOf(TEXT, ["Moshe Peretz", "D"])).toEqual([]);
  });

  it("without a finder the preview says names are not hidden; with one it does not", async () => {
    setPreviewEnabled(true);
    const seen: boolean[] = [];
    __setPreview(async (_m, _c, names) => (seen.push(names), true));
    __setNer(null);
    await redactForCloud([{ role: "user", content: TEXT }], "anthropic");
    __setNer(async () => []);
    await redactForCloud([{ role: "user", content: TEXT }], "anthropic");
    expect(seen).toEqual([false, true]);
    expect(t("pii.preview.noNames")).toMatch(/^Names are not hidden/);
  });

  it("every state: the preview and the log say names are hidden exactly when every name in the text is hidden", async () => {
    // "0 states where the user thinks names are hidden and they are not" (W10.C23):
    // no finder, a finder that finds them, one that throws (Ollama stopped
    // mid-request: patterns only), one that fails on the second message only,
    // and one cut off by the user's Esc. (A finder that runs and misses a name
    // is a recall question, measured by piiGolden, not a state.)
    const { redactionLog } = await import("../ai/piiRedactor");
    setPreviewEnabled(true);
    const finds = async (text: string) => spansOf(text, ["Dana Levi", "Yossi Cohen"]);
    let calls = 0;
    const states: Array<[string, Parameters<typeof __setNer>[0], number]> = [
      ["no finder", null, 1],
      ["finds the names", finds, 2],
      ["throws: Ollama stopped", async () => Promise.reject(new Error("connection refused")), 2],
      ["fails on the second message only", async (text: string) => (++calls === 2 ? Promise.reject(new Error("timeout")) : finds(text)), 2],
    ];
    for (const [label, ner, n] of states) {
      calls = 0;
      const seen: boolean[] = [];
      __setPreview(async (msgs, _c, names) => {
        seen.push(names);
        // What the user is told must match what is about to leave the device.
        const sent = msgs.map((m) => m.content).join("\n");
        const leaked = sent.includes("Dana Levi") || sent.includes("Yossi Cohen");
        expect(names && leaked, `${label}: the preview claims names are hidden, but the text still has them`).toBe(false);
        return true;
      });
      __setNer(ner);
      const before = redactionLog().length;
      const messages = Array.from({ length: n }, () => ({ role: "user", content: TEXT }));
      const { messages: sent } = await redactForCloud(messages, "anthropic");
      const leaked = sent.some((m) => m.content.includes("Dana Levi"));
      expect(seen, label).toEqual([!leaked && ner !== null && ner !== undefined]);
      const rec = redactionLog().slice(before);
      expect(rec.length, label).toBe(1);
      expect(rec[0].names, label).toBe(seen[0]);
    }
    // Esc during the name search: nothing is sent and nothing is claimed.
    const ac = new AbortController();
    __setNer(async (_t, sig) => {
      ac.abort();
      throw sig?.reason ?? new DOMException("aborted", "AbortError");
    });
    await expect(redactForCloud([{ role: "user", content: TEXT }], "anthropic", ac.signal)).rejects.toThrow();
  });

  it("bert-base-NER (English, MIT) is registered for conversion, with its sha256 owed to the first run", () => {
    const reg = JSON.parse(readFileSync(join(process.cwd(), "models/registry.json"), "utf8"));
    const all = (reg.models ?? reg) as Array<{ id: string; license: string; hosting?: { via?: string; tag?: string }; notes?: string }>;
    const m = all.find((x) => x.id === "bert-base-ner")!;
    expect(m).toMatchObject({ license: "MIT", hosting: { via: "converted", tag: "models-bert-base-ner" } });
    expect(m.notes).toMatch(/sha256 .* first conversion run/);
    const targets = JSON.parse(readFileSync(join(process.cwd(), "models/convert-targets.json"), "utf8"));
    expect(JSON.stringify(targets)).toContain('"hf":"dslim/bert-base-NER"');
    expect(CONVERTED_MODELS.map((c) => c.id)).toContain("bert-base-ner");
  });
});
