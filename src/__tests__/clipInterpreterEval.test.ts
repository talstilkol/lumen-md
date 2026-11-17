/**
 * W2.14: the clip-interpreter eval harness (src/agents/eval/clipInterpreter.eval.ts
 * runs it against a real local model on the Mac). Here: the scorer judges
 * answers the way the acceptance reads (≥ 85 % fields, < 10 s per clip,
 * 0 requests off the device), and the runner clips all 20 golden pages,
 * times them and records every request, with stand-in models.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { PAGES } from "./fixtures/clip-interpreter/pages";
import { runClipEval } from "../../scripts/eval/lib/clipInterpreterRun";
import { clipEvalMarkdown, isLocalUrl, judgeField, namesTerm, summarizeClipEval, type FieldExpectation, type PageResult } from "../../scripts/eval/lib/clipInterpreterScore";
import type { InterpretFn } from "../research/clipInterpreter";

const en: FieldExpectation = { kind: "sentence", lang: "en", anyOf: ["capital", "Italy"] };
const heList: FieldExpectation = { kind: "list", lang: "he", anyOf: ["תקציב", "כנסת"], min: 3, max: 5 };

describe("judging a prompt answer", () => {
  it("wants the page's language, the asked shape and a key term", () => {
    expect(judgeField("Rome is the capital of Italy.", en).ok).toBe(true);
    expect(judgeField("", en)).toEqual({ ok: false, why: "empty" });
    expect(judgeField("רומא היא בירת איטליה.", en).why).toMatch(/not English/);
    expect(judgeField("Rome is old. It is the capital of Italy.", en).why).toBe("more than one sentence");
    expect(judgeField("Rome, e.g. the capital of Italy.", en).ok).toBe(true);
    expect(judgeField("A city with many fountains.", en).why).toMatch(/names none/);
    expect(judgeField(`The capital ${"x".repeat(300)}`, en).why).toMatch(/characters/);
  });

  it("counts list items and matches Hebrew terms through prefixes, niqqud and final letters", () => {
    expect(judgeField("תקציב, כנסת, פוליטיקה", heList).ok).toBe(true);
    expect(judgeField("בתקציב, הכנסת, פוליטיקה", heList).ok).toBe(true);
    expect(judgeField("תקציב, כנסת", heList).why).toBe("2 items, want 3–5");
    expect(judgeField("budget, knesset, politics", heList).why).toMatch(/not Hebrew/);
    expect(namesTerm("הַתַּקְצִיב אושר", "תקציב")).toBe(true);
    expect(namesTerm("Diacritics restoration", "diacritic")).toBe(true);
    expect(namesTerm("runs locally on device", "on device")).toBe(true);
    expect(namesTerm("Rome is old", "capital")).toBe(false);
  });

  it("allows this device and the local network only", () => {
    expect(["http://localhost:11434/api/chat", "http://127.0.0.1:11434", "http://192.168.1.5:11434", "http://[::1]:11434", "http://mac.local:11434"].every(isLocalUrl)).toBe(true);
    expect(["https://api.openai.com/v1", "https://ollama.example.com", "not a url"].some(isLocalUrl)).toBe(false);
  });
});

describe("the run summary and its gates", () => {
  const ok = (ms: number): PageResult => ({ url: `https://x.example/${ms}`, ms, page: { title: ["Rome", "Rome"] }, model: { summary: ["Rome is the capital of Italy.", en] } });
  const twenty = (f: (i: number) => PageResult) => Array.from({ length: 20 }, (_, i) => f(i));

  it("passes 20 right, fast, local clips", () => {
    const s = summarizeClipEval(twenty(() => ok(2000)), ["http://localhost:11434/api/chat"]);
    expect(s).toMatchObject({ pages: 20, fields: 40, fieldsRight: 40, modelShare: 1, pass: true, reasons: [] });
    expect(clipEvalMarkdown("qwen2.5:3b", "2026-11-17", s)).toContain("Verdict: **PASS**");
  });

  it("fails a model whose page metadata is right but whose prompt answers are wrong", () => {
    const bad = (i: number): PageResult => ({ ...ok(1000), page: { a: ["x", "x"], b: ["y", "y"], c: ["z", "z"], d: ["w", "w"], e: ["v", "v"], f: ["u", "u"], g: ["t", "t"] }, model: { summary: [i < 16 ? "" : "Rome is the capital.", en] } });
    const s = summarizeClipEval(twenty(bad), []);
    // 140 + 4 of 160 fields right (90 %), but only 4 of 20 prompt answers.
    expect(s.share).toBeGreaterThan(0.85);
    expect(s.pass).toBe(false);
    expect(s.reasons).toEqual(["prompt fields right 20.0 % < 85 %"]);
  });

  it("fails a slow clip, a request off the device and a short set", () => {
    const s = summarizeClipEval(twenty((i) => ok(i === 3 ? 10_000 : 900)), ["http://localhost:11434", "https://api.openai.com/v1/chat"]);
    expect(s.reasons).toEqual(["1 clips took 10 s or more", "1 requests off the device"]);
    expect(s.msMax).toBe(10_000);
    expect(summarizeClipEval([ok(1)], []).reasons).toEqual(["1 pages, want 20"]);
  });
});

describe("the runner on the 20 golden pages", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("every page has a prompt expectation for each prompt field of its template", () => {
    expect(PAGES).toHaveLength(20);
    for (const p of PAGES) expect(Object.keys(p.model).length, p.url).toBeGreaterThan(0);
  });

  /** An oracle model: answers each prompt from the page's expectations (as a good model would). */
  const oracle = (): InterpretFn => {
    let i = 0;
    return async ({ user }) => {
      const p = PAGES[i++];
      const keys = [...user.matchAll(/^(p\d+): (.*)$/gm)].map((m) => [m[1], m[2]] as const);
      const answer = (prompt: string) => {
        const e = /topics/.test(prompt) ? p.model.topics : Object.values(p.model).find((x) => x.kind === "sentence")!;
        if (e.kind === "list") return [...e.anyOf, ...e.anyOf, ...e.anyOf].slice(0, 3).join(", ");
        return `${e.lang === "he" ? "הדף עוסק ב" : "The page is about "}${e.anyOf[0]}.`;
      };
      return JSON.stringify(Object.fromEntries(keys.map(([k, prompt]) => [k, answer(prompt)])));
    };
  };

  it("an oracle model passes every gate; requests made while clipping are recorded", async () => {
    let t = 0;
    vi.stubGlobal("fetch", async () => new Response("{}"));
    const ask = oracle();
    const viaFetch: InterpretFn = async (req) => {
      await fetch("http://localhost:11434/api/chat");
      return ask(req);
    };
    const run = await runClipEval(PAGES, viaFetch, { now: () => (t += 1500) });
    expect(run.unanswered).toEqual([]);
    expect(run.requests).toHaveLength(20);
    const s = summarizeClipEval(run.results, run.requests);
    // Every prompt answer judged right. (Page fields such as author come from Defuddle; without it, as in the offline shim, some are missed and still count.)
    expect(s.wrong.filter((w) => w.includes(" — "))).toEqual([]);
    expect(s.modelRight).toBe(s.modelFields);
    expect(s.pass).toBe(true);
    expect(s.msMax).toBe(1500);
  });

  it("a model that answers nothing fails, and a cloud call is caught", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}"));
    const silent: InterpretFn = async () => {
      await fetch("https://api.example.com/v1/chat");
      return "{}";
    };
    const run = await runClipEval(PAGES, silent);
    const s = summarizeClipEval(run.results, run.requests);
    expect(s.modelRight).toBe(0);
    expect(s.offDevice).toHaveLength(20);
    expect(s.pass).toBe(false);
  });

  it("restores fetch even when a clip throws", async () => {
    const before = globalThis.fetch;
    const ac = new AbortController();
    ac.abort();
    await expect(runClipEval(PAGES, oracle(), { signal: ac.signal })).rejects.toThrow();
    expect(globalThis.fetch).toBe(before);
  });
});
