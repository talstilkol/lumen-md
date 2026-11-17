/**
 * W10.E42 (plan W2.5): partial niqqud by part of speech: nouns only, verbs only.
 *
 * The lexicon below is a SYNTHETIC fixture in the pack's real shape
 * ([word, pointed, part of speech, definitions, synonyms], with Hebrew
 * Wiktionary's "חלק דיבר" names). It is not the Wiktionary pack. The engine
 * is a stand-in for the niqqud model that points from a fixed table; the
 * code under test (the modes, the tagger, the offsets) is the real one.
 */
import { describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { runNikudCommand, type NikudCommandDeps } from "../editor/nikudCommand";
import { __resetNikud, pointHebrewDetailed } from "../ai/nikudService";
import { addNikud, addNikudDetailed, type NikudEngine } from "../text/nikudRun";
import { keepWordsOfClass, lexiconTagger, posClass, PARTIAL_MODES } from "../text/nikudPos";
import { buildIndex, type LexiconPack } from "../lexicon/lexicon";
import { removeNikud } from "../text/nikud";

const PACK: LexiconPack = {
  format: "lumen-lexicon/1",
  source: "synthetic test fixture",
  built: "2026-11-15",
  license: "CC-BY-SA-4.0",
  attribution: "synthetic",
  count: 6,
  words: 5,
  entries: [
    ["בית", "בַּיִת", "שם עצם", ["מבנה למגורים"], []],
    ["ספר", "סֵפֶר", "שם עצם", ["חיבור כתוב"], []],
    ["ספר", "סִפֵּר", "פועל", ["אמר, תיאר"], []],
    ["הלך", "הָלַךְ", "פועל", ["צעד"], []],
    ["יפה", "יָפֶה", "שם תואר", ["נאה"], []],
    ["ירושלים", "יְרוּשָׁלַיִם", "שם פרטי", ["עיר"], []],
  ],
};
const tagger = lexiconTagger(buildIndex(PACK));

/** How the stand-in model points each word. */
const POINTED: Record<string, string> = {
  ספר: "סִפֵּר",
  בית: "בַּיִת",
  ובבית: "וּבַבַּיִת",
  הלך: "הָלַךְ",
  יפה: "יָפֶה",
  ירושלים: "יְרוּשָׁלַיִם",
  אתמול: "אֶתְמוֹל",
};
const engine: NikudEngine = {
  maxlen: 200,
  async run(batch) {
    return batch.map((chunk) => ({ text: chunk.replace(/[א-ת]+/g, (w) => POINTED[w] ?? w), unsure: [...chunk].map(() => false) }));
  },
};

describe("partial niqqud by part of speech (W10.E42)", () => {
  it("three partial modes exist", () => {
    expect(PARTIAL_MODES).toEqual(["ambiguous", "nouns", "verbs"]);
  });

  it("maps Hebrew Wiktionary's part-of-speech names to classes", () => {
    expect(posClass("שם עצם")).toBe("noun");
    expect(posClass("שם־עצם")).toBe("noun");
    expect(posClass("שם פרטי")).toBe("noun");
    expect(posClass("פועל")).toBe("verb");
    expect(posClass("שם תואר")).toBe("other");
    expect(posClass("תואר הפועל")).toBe("other");
    expect(posClass("")).toBeNull();
  });

  it("the lexicon tagger: one class, a peeled prefix, a homograph settled by the model's pointing, an unknown word", async () => {
    const tags = await tagger([
      { plain: "בית", pointed: "בַּיִת" },
      { plain: "ובבית", pointed: "וּבַבַּיִת" },
      { plain: "ספר", pointed: "סִפֵּר" },
      { plain: "ספר", pointed: "סֵפֶר" },
      { plain: "ספר", pointed: "סְפַר" },
      { plain: "אתמול", pointed: "אֶתְמוֹל" },
      { plain: "יפה", pointed: "יָפֶה" },
    ]);
    expect(tags).toEqual(["noun", "noun", "verb", "noun", null, null, "other"]);
  });

  it("nouns only: nouns keep their points, every other word is plain", async () => {
    const text = "ספר בית ובבית, הלך יפה אתמול לירושלים ירושלים";
    const out = await addNikud(text, engine, { partial: "nouns", tagger });
    expect(out).toBe("ספר בַּיִת וּבַבַּיִת, הלך יפה אתמול לירושלים יְרוּשָׁלַיִם");
    expect(removeNikud(out)).toBe(text);
  });

  it("verbs only: the verb reading of the homograph is kept, nouns are plain", async () => {
    const out = await addNikud("ספר בית הלך יפה", engine, { partial: "verbs", tagger });
    expect(out).toBe("סִפֵּר בית הָלַךְ יפה");
  });

  it("the alternatives list keeps the same words, with offsets into the new text", async () => {
    const d = await addNikudDetailed("ספר בית הלך", engine, { partial: "verbs", tagger });
    expect(d.text).toBe("סִפֵּר בית הָלַךְ");
    expect(d.words.map((w) => d.text.slice(w.from, w.to))).toEqual(["סִפֵּר", "הָלַךְ"]);
    for (const w of d.words) expect(w.alternatives[0].text).toBe(d.text.slice(w.from, w.to));
  });

  it("full and ambiguous modes are unchanged; nouns/verbs without a tagger is an error, not a silent full pointing", async () => {
    expect(await addNikud("ספר בית", engine)).toBe("סִפֵּר בַּיִת");
    expect(await addNikud("ספר בית", engine, { partial: true })).toBe("ספר בית");
    expect(await addNikud("ספר בית", engine, { partial: "ambiguous" })).toBe("ספר בית");
    await expect(addNikud("ספר בית", engine, { partial: "nouns" })).rejects.toThrow(/part-of-speech tagger/);
  });

  it("a tagger that drops a word is refused", async () => {
    await expect(keepWordsOfClass({ text: "בַּיִת הָלַךְ", words: [] }, "nouns", () => ["noun"])).rejects.toThrow(/1 classes for 2 words/);
  });
});

describe("nouns / verbs through the service and the editor action (W10.E42)", () => {
  const consent = () => ({ confirm: vi.fn(async () => true), t: (k: string) => k });

  it("without the Hebrew dictionary: NikudUnavailableError(\"lexicon\") before any consent dialog or model download", async () => {
    __resetNikud();
    const c = consent();
    const loadModel = vi.fn();
    await expect(pointHebrewDetailed("ספר בית", { consent: c, loadModel, base: "https://models.example/" }, { partial: "nouns" })).rejects.toMatchObject({ name: "NikudUnavailableError", reason: "lexicon" });
    expect(c.confirm).not.toHaveBeenCalled();
    expect(loadModel).not.toHaveBeenCalled();
  });

  it("with it: the worker points everything (partial off) and only the nouns keep their points", async () => {
    __resetNikud();
    vi.stubGlobal("navigator", { storage: { getDirectory: async () => ({ getDirectoryHandle: async () => { throw new DOMException("x", "NotFoundError"); } }) } });
    const posted: Array<Record<string, unknown>> = [];
    const fakeWorker = {
      onmessage: null as ((e: MessageEvent) => void) | null,
      postMessage(m: Record<string, unknown>) {
        posted.push(m);
        const value = m.type === "point" ? { text: String(m.text).replace(/[א-ת]+/g, (w) => POINTED[w] ?? w), words: [] } : true;
        queueMicrotask(() => this.onmessage?.({ data: { type: "result", id: m.id, value } } as MessageEvent));
      },
      terminate() {},
    };
    const deps = { consent: consent(), loadModel: async () => new ArrayBuffer(8), base: "https://models.example/", createWorker: () => fakeWorker as unknown as Worker };
    const r = await pointHebrewDetailed("ספר בית הלך", deps, { partial: "nouns", tagger: async () => tagger });
    expect(r.text).toBe("ספר בַּיִת הלך");
    expect(posted.find((m) => m.type === "point")).toMatchObject({ partial: false });
    vi.unstubAllGlobals();
  });

  it("the editor action passes the mode through", async () => {
    const view = new EditorView({ state: EditorState.create({ doc: "ספר בית" }) });
    const point = vi.fn<NikudCommandDeps["point"]>(async (t) => t);
    await runNikudCommand(view, "verbs", { point, unpoint: removeNikud });
    await runNikudCommand(view, "nouns", { point, unpoint: removeNikud });
    await runNikudCommand(view, "partial", { point, unpoint: removeNikud });
    expect(point.mock.calls.map((c) => c[1])).toEqual(["verbs", "nouns", true]);
  });
});
