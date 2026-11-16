/**
 * Audit r3, W10.C23: the name finder is chosen by the text's language, not by
 * what happens to be cached. Before the fix, Hebrew text on a device with
 * only bert-base-NER (English) cached ran the English model: the redactor
 * reported names=true and hid nothing. Now a text whose language no engine
 * here reads gets no finder, the preview says names are not hidden, and the
 * log records names=false (fail closed). The texts are synthetic.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { namesEngine, namesLanguages } from "../ai/piiNer";
import { __setNer, __setPreview, redactForCloud, redactionLog, setPreviewEnabled } from "../ai/piiRedactor";
import { resetExecutors } from "../agents/executors";
import type { NerFn } from "../ai/pii";

const HE = "דנה לוי ביקשה מיוסי כהן להתקשר אליה בחזרה.";
const EN = "Dana Levi asked Yossi Cohen to call her back.";
const MIXED = "דנה לוי met John Smith today.";

/** A fake model that "finds" the given names and records each text it saw. */
function model(names: string[], seen: string[]): NerFn {
  return async (text) => {
    seen.push(text);
    return names.flatMap((n) => (text.includes(n) ? [{ start: text.indexOf(n), end: text.indexOf(n) + n.length, type: "PERSON" as const }] : []));
  };
}
const only = (map: Record<string, NerFn>) => async (id: string) => map[id] ?? null;
const noOllama = async () => false;

beforeEach(() => {
  resetExecutors();
  localStorage.setItem("lumen.ai.cache", "off");
  __setNer(undefined);
  __setPreview(null);
  setPreviewEnabled(false);
});

describe("W10.C23: the name engine follows the text's language", () => {
  it("detects the languages a text's names may be in (fail closed: mixed needs both)", () => {
    expect(namesLanguages(HE)).toEqual(["he"]);
    expect(namesLanguages(EN)).toEqual(["en"]);
    expect(namesLanguages(MIXED)).toEqual(["he", "en"]);
    expect(namesLanguages("שלום, ראו https://Example.com/Page או mail@Example.com")).toEqual(["he"]);
    expect(namesLanguages("12-345-678 054-1471258")).toEqual([]);
  });

  it("Hebrew text with only the English model cached: no finder runs, and the preview warns", async () => {
    const seen: string[] = [];
    const { engine, ner } = await namesEngine({ cached: only({ "bert-base-ner": model(["דנה לוי"], seen) }), ollamaUp: noOllama });
    expect(engine).toBe("bert-base-ner");
    await expect(ner!(HE)).rejects.toMatchObject({ name: "NamesUnsupportedError" });
    expect(seen).toEqual([]); // the English model never sees Hebrew text
    // Through the redactor: names=false in the preview and the log.
    setPreviewEnabled(true);
    const said: boolean[] = [];
    __setPreview(async (_m, _c, names) => (said.push(names), true));
    __setNer(ner);
    const before = redactionLog().length;
    await redactForCloud([{ role: "user", content: `${HE} 054-1471258` }], "anthropic");
    expect(said).toEqual([false]);
    expect(redactionLog().slice(before).map((r) => r.names)).toEqual([false]);
  });

  it("English text with only the Hebrew model cached: no finder runs either", async () => {
    const seen: string[] = [];
    const { ner } = await namesEngine({ cached: only({ "dictabert-ner": model([], seen) }), ollamaUp: noOllama });
    await expect(ner!(EN)).rejects.toMatchObject({ name: "NamesUnsupportedError" });
    expect(seen).toEqual([]);
  });

  it("each language gets its own model; a mixed text runs both", async () => {
    const heSeen: string[] = [];
    const enSeen: string[] = [];
    const { ner } = await namesEngine({ cached: only({ "dictabert-ner": model(["דנה לוי"], heSeen), "bert-base-ner": model(["John Smith"], enSeen) }), ollamaUp: noOllama });
    expect((await ner!(HE)).map((s) => HE.slice(s.start, s.end))).toEqual(["דנה לוי"]);
    expect((await ner!(EN)).length).toBe(0);
    const spans = await ner!(MIXED);
    expect(spans.map((s) => MIXED.slice(s.start, s.end))).toEqual(["דנה לוי", "John Smith"]);
    expect(heSeen).toEqual([HE, MIXED]);
    expect(enSeen).toEqual([EN, MIXED]);
  });

  it("Hebrew text with the English model cached falls back to Ollama on this machine, which reads both", async () => {
    const seen: string[] = [];
    const { ner } = await namesEngine({ cached: only({ "bert-base-ner": model([], seen) }), ollamaUp: async () => true, ask: async () => ["דנה לוי", "יוסי כהן"] });
    const spans = await ner!(HE);
    expect(spans.map((s) => HE.slice(s.start, s.end))).toEqual(["דנה לוי", "יוסי כהן"]);
    expect(seen).toEqual([]);
  });

  it("a mixed text with only one language covered is not claimed (fail closed)", async () => {
    const { ner } = await namesEngine({ cached: only({ "dictabert-ner": model(["דנה לוי"], []) }), ollamaUp: noOllama });
    await expect(ner!(MIXED)).rejects.toMatchObject({ name: "NamesUnsupportedError", languages: ["en"] });
  });
});
