/**
 * W13.W10 — Harper for local English grammar, inside the suggestion engine.
 *
 * What runs here: everything around harper.js, against a stand-in with
 * harper.js's API (`LocalLinter`, `Lint.span()/message()/lint_kind()/
 * suggestions()`, code-point spans): the mapping to the Suggestion contract
 * and to GrammarMatch, English-only spans in mixed Hebrew/English text, the
 * worker's "not installed" answer, the AbortSignal, the grammar engine's
 * local path (Harper + nspell, 0 requests), and the 150-sentence set.
 * What is owed to the Mac (harper.js cannot be installed here): latency
 * ≤ 50 ms per paragraph and recall ≥ 0.7 on that set with the real
 * package — scripts/writing/harper-eval.mjs measures both and writes the card.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { codePointOffsets, englishSpans, harperCheck, lintLatency, recallOn, toGrammarMatches, type HarperLint, type HarperLinterLike } from "../agents/writing/harper/harperEngine";
import { createHarperHost, type HarperModule } from "../agents/writing/harper/harperWorkerCore";
import { __deliver, __setHarperTransport, harperGrammarMatches, harperSuggestions } from "../ai/harper/harperService";
import { checkGrammar, clearGrammarCache } from "../ai/grammar";
import { harperSet } from "./fixtures/writing/harperSet";

/** A stand-in with harper.js's shapes: repeated words and "a" before a vowel; spans in code points. */
class FakeLinter implements HarperLinterLike {
  calls: string[] = [];
  async setup() {}
  async lint(text: string): Promise<HarperLint[]> {
    this.calls.push(text);
    const toCp = (u: number) => [...text.slice(0, u)].length;
    const out: HarperLint[] = [];
    const mk = (s: number, e: number, kind: string, message: string, repl: Array<[number, string]>): HarperLint => ({
      span: () => ({ start: s, end: e }),
      message: () => message,
      lint_kind: () => kind,
      lint_kind_pretty: () => kind,
      suggestions: () => repl.map(([k, t]) => ({ kind: () => k, get_replacement_text: () => t })),
    });
    for (const m of text.matchAll(/\b(\w+) \1\b/gi)) {
      const s = toCp(m.index ?? 0);
      out.push(mk(s, s + [...m[0]].length, "Repetition", `“${m[1]}” is repeated.`, [[0, m[1]]]));
    }
    for (const m of text.matchAll(/\ba (?=[aeiou])/gi)) {
      const s = toCp(m.index ?? 0);
      out.push(mk(s, s + 1, "Agreement", "Use “an” before a vowel sound.", [[0, "an"]]));
    }
    return out;
  }
}

describe("mapping Harper's lints", () => {
  it("code-point spans become UTF-16 offsets (emoji and Hebrew before the error)", async () => {
    expect(codePointOffsets("a😀b")).toEqual([0, 1, 3, 4]);
    const text = "😀 We saw a owl in the garden today.";
    const [s] = await harperCheck(text, new FakeLinter(), { model: "fake" });
    expect(text.slice(s.range.from, s.range.to)).toBe("a");
    expect(s).toMatchObject({ kind: "grammar:Agreement", replacement: "an", agentId: "harperGrammar", model: "fake" });
    expect(s.rationale).toMatch(/Harper, on this device/);
  });

  it("Remove and InsertAfter suggestions", async () => {
    const lint = (kind: number, t: string): HarperLint => ({ span: () => ({ start: 4, end: 7 }), message: () => "m", lint_kind: () => "Style", suggestions: () => [{ kind: () => kind, get_replacement_text: () => t }] });
    const one = (l: HarperLint): HarperLinterLike => ({ lint: async () => [l] });
    const text = "The cat sat on the mat today, quietly.";
    expect((await harperCheck(text, one(lint(1, ""))))[0].replacement).toBe("");
    expect((await harperCheck(text, one(lint(2, "s"))))[0].replacement).toBe("cats");
    expect((await harperCheck(text, one({ ...lint(0, ""), suggestions: () => [] })))[0].replacement).toBeNull();
  });

  it("GrammarMatch for the editor's grammar layer", async () => {
    const text = "We waited waited for the train.";
    const m = toGrammarMatches(await harperCheck(text, new FakeLinter()));
    expect(m).toEqual([{ offset: 3, length: 13, message: "“waited” is repeated.", replacements: ["waited"], rule: { id: "harper:Repetition", category: "GRAMMAR" } }]);
  });
});

describe("mixed text: only the English runs", () => {
  it("Hebrew is never sent to Harper; English runs keep their offsets", async () => {
    const text = "היום כתבתי פסקה בעברית. She ate a apple after the the walk. ושוב עברית בסוף.\n\n`a apple in code` and https://a.example/a-apple";
    const fake = new FakeLinter();
    const s = await harperCheck(text, fake);
    expect(fake.calls.every((c) => !/[א-ת]/.test(c))).toBe(true);
    expect(fake.calls.some((c) => c.includes("code"))).toBe(false);
    expect(s.map((x) => text.slice(x.range.from, x.range.to)).sort()).toEqual(["a", "the the"]);
  });
  it("a short Latin name in Hebrew is not a run", () => {
    expect(englishSpans("נפגשנו עם Dana ב-React אתמול.")).toEqual([]);
    const para = "A whole English paragraph, with commas.";
    expect(englishSpans(para)).toEqual([{ from: 0, to: para.length }]);
  });
});

describe("the worker", () => {
  const fakeModule: HarperModule = { LocalLinter: FakeLinter as unknown as HarperModule["LocalLinter"], binary: {}, version: "0.0-test" };
  it("answers 'not-installed' when harper.js is not on this origin, and never retries the load", async () => {
    let loads = 0;
    const handle = createHarperHost(async () => {
      loads++;
      throw new Error("404");
    });
    expect(await handle({ type: "lint", id: 1, text: "a apple" })).toEqual({ type: "not-installed", id: 1 });
    expect(await handle({ type: "lint", id: 2, text: "a apple" })).toEqual({ type: "not-installed", id: 2 });
    expect(loads).toBe(1);
  });
  it("lints with the loaded module and names its version", async () => {
    const handle = createHarperHost(async () => fakeModule);
    const r = await handle({ type: "lint", id: 3, text: "We saw a owl." });
    expect(r).toMatchObject({ type: "lints", id: 3, version: "harper.js@0.0-test" });
    expect(r.type === "lints" && r.lints[0]).toMatchObject({ start: 7, end: 8, kind: "Agreement", replacements: [{ kind: 0, text: "an" }] });
  });
});

describe("the service and the grammar engine", () => {
  const host = createHarperHost(async () => ({ LocalLinter: FakeLinter as unknown as HarperModule["LocalLinter"], binary: {}, version: "0.0-test" }));
  const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
  beforeEach(() => {
    __setHarperTransport((req) => void host(req).then((r) => setTimeout(() => __deliver(r), 0)));
    clearGrammarCache();
    localStorage.setItem("lumen.ai.policy", "local-only");
    vi.stubGlobal("fetch", fetchSpy);
    fetchSpy.mockClear();
  });
  afterEach(() => {
    __setHarperTransport(null);
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("suggestions through the worker protocol", async () => {
    const text = "שלום. We saw a owl near the the river bank.";
    const s = await harperSuggestions(text);
    expect(s.map((x) => text.slice(x.range.from, x.range.to)).sort()).toEqual(["a", "the the"]);
    expect(s[0].model).toBe("harper.js@0.0-test");
  });

  it("AbortSignal: rejects at once and the late reply is dropped", async () => {
    const ac = new AbortController();
    const p = harperSuggestions("We saw a owl near the river bank.", { signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toThrow(/abort/i);
    await expect(harperGrammarMatches("We saw a owl near the river bank.", ac.signal)).rejects.toThrow(/abort/i);
  });

  it("local-only checkGrammar: Harper's grammar joins the local spelling, 0 requests", async () => {
    const text = "This note has enough words to be checked, and we saw a owl near the river.";
    const m = await checkGrammar(text);
    expect(m.map((x) => [text.slice(x.offset, x.offset + x.length), x.rule.id])).toContainEqual(["a", "harper:Agreement"]);
    expect(fetchSpy).not.toHaveBeenCalled();
  }, 20_000);

  it("not installed: the grammar engine carries on without it", async () => {
    __setHarperTransport((req) => setTimeout(() => __deliver({ type: "not-installed", id: req.id }), 0));
    expect(await harperGrammarMatches("We saw a owl near the river bank.")).toEqual([]);
  });
});

describe("the English set (150 errors + 50 clean) and the Mac measurement", () => {
  const set = harperSet();
  it("150 labelled errors in three kinds, 50 clean sentences; each label points at the error", () => {
    expect(set.filter((x) => x.error).length).toBe(150);
    expect(set.filter((x) => !x.error).length).toBe(50);
    for (const k of ["repetition", "spelling", "article"]) expect(set.filter((x) => x.kind === k).length).toBe(50);
    const art = set.find((x) => x.id === "art-1")!;
    expect(art.text.slice(art.error!.from, art.error!.to)).toBe("a");
    const rep = set.find((x) => x.id === "rep-1")!;
    expect(rep.text.slice(rep.error!.from, rep.error!.to)).toBe("ate ate");
  });

  it("the stand-in finds the repetitions and articles (two of three kinds) and no clean sentence", async () => {
    const fake = new FakeLinter();
    const items = set.filter((x) => x.error && x.kind !== "spelling");
    const found = await Promise.all(items.map(async (x) => (await harperCheck(x.text, fake)).map((s) => s.range)));
    // The stand-in knows only vowel letters, so "a hour" / "a honest" escape it; the real Harper is measured on the Mac.
    expect(recallOn(items.map((x) => ({ text: x.text, error: x.error! })), found)).toBeGreaterThanOrEqual(0.95);
    for (const c of set.filter((x) => !x.error)) expect(await harperCheck(c.text, fake)).toEqual([]);
  });

  it("latency measurement runs (the ≤ 50 ms check itself is the Mac's, with the real linter)", async () => {
    const r = await lintLatency(new FakeLinter(), set.slice(0, 20).map((x) => x.text));
    expect(r.n).toBe(20);
    expect(r.p95).toBeGreaterThanOrEqual(r.p50);
  });

  it("eval/fixtures/writing/harperGrammar/en.jsonl is this set (harper-eval.mjs reads it)", () => {
    const file = resolve(__dirname, "../../eval/fixtures/writing/harperGrammar/en.jsonl");
    const lines = set.map((x) => JSON.stringify({ id: x.id, text: x.text, kind: x.kind, error: x.error }));
    if (process.env.LUMEN_WRITE_CARDS) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${lines.join("\n")}\n`);
    }
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8").trim().split("\n")).toEqual(lines);
  });
});
