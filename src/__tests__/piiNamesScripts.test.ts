/**
 * Review 12, H2 (from the reviewer's probe zzRev12Ner): namesLanguages
 * returned [] for Russian, Arabic, all-caps and all-lowercase Latin text, so
 * no finder was needed and the redactor claimed names were hidden while
 * every name went to the cloud. Now another script, or Latin with no
 * capitalised word, is "other": no engine covers it, the finder throws
 * NamesUnsupportedError, the preview says names are not hidden and the log
 * records names=false. The texts are synthetic.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { NamesUnsupportedError, namesEngine, namesLanguages } from "../ai/piiNer";
import { __setNer, __setPreview, redactForCloud, redactionLog, setPreviewEnabled } from "../ai/piiRedactor";
import { resetExecutors } from "../agents/executors";
import type { NerFn } from "../ai/pii";

function model(names: string[], seen: string[]): NerFn {
  return async (text) => {
    seen.push(text);
    return names.flatMap((n) => (text.includes(n) ? [{ start: text.indexOf(n), end: text.indexOf(n) + n.length, type: "PERSON" as const }] : []));
  };
}
const only = (map: Record<string, NerFn>) => async (id: string) => map[id] ?? null;
const noOllama = async () => false;
const CASES = [
  ["russian", "Иван Петров позвонил Марии Ивановой."],
  ["arabic", "اتصل أحمد محمد بسارة علي."],
  ["caps", "JOHN SMITH CALLED DANA LEVI."],
  ["lower", "dana levi asked yossi cohen"],
] as const;

beforeEach(() => {
  resetExecutors();
  localStorage.setItem("lumen.ai.cache", "off");
  __setNer(undefined);
  __setPreview(null);
  setPreviewEnabled(false);
});

describe("names in scripts and cases no engine reads are never claimed hidden (review 12, H2)", () => {
  it("other scripts and case-less Latin are 'other'; ordinary English stays 'en'", () => {
    expect(namesLanguages(CASES[0][1])).toEqual(["other"]);
    expect(namesLanguages(CASES[1][1])).toEqual(["other"]);
    expect(namesLanguages(CASES[2][1])).toEqual(["en", "other"]);
    expect(namesLanguages(CASES[3][1])).toEqual(["en", "other"]);
    expect(namesLanguages("Dana Levi asked Yossi Cohen to call her back.")).toEqual(["en"]);
    expect(namesLanguages("דנה לוי met John Smith today.")).toEqual(["he", "en"]);
    expect(namesLanguages("שלום, ראו https://example.com/page או `npm ci`")).toEqual(["he"]);
  });

  for (const [label, text] of CASES) {
    it(`${label}: with both models cached, the preview and the log say names are NOT hidden`, async () => {
      const seen: string[] = [];
      const { ner } = await namesEngine({ cached: only({ "dictabert-ner": model([], seen), "bert-base-ner": model([], seen) }), ollamaUp: noOllama });
      await expect(ner!(text)).rejects.toBeInstanceOf(NamesUnsupportedError);
      setPreviewEnabled(true);
      const said: boolean[] = [];
      __setPreview(async (_m, _c, names) => (said.push(names), true));
      __setNer(ner);
      const before = redactionLog().length;
      await redactForCloud([{ role: "user", content: `${text} 054-1471258` }], "anthropic");
      expect(said).toEqual([false]);
      expect(redactionLog().slice(before).map((r) => r.names)).toEqual([false]);
    });
  }

  it("a local Ollama model does not cover other scripts either", async () => {
    const { ner } = await namesEngine({ cached: only({}), ollamaUp: async () => true, ask: async () => [] });
    await expect(ner!(CASES[0][1])).rejects.toBeInstanceOf(NamesUnsupportedError);
  });
});
