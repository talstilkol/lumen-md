/** T27 — Hebrew model catalog, Hebrew-aware picks, and the answer-language rule. */
import { describe, it, expect } from "vitest";
import { hebrewSupportOf, prefersHebrew, recommendOllamaModel } from "../ai/modelCatalog";
import { pickModel } from "../agents/executors/ollama";
import { recommendWebLlmModel, type Hardware } from "../ai/modelManager";
import { sameScript } from "../agents/runtime";

describe("model catalog", () => {
  it("recommends the best Hebrew model that fits the RAM", () => {
    expect(recommendOllamaModel({ hebrew: true, ramGB: 16 }).name).toBe("gemma3:12b");
    expect(recommendOllamaModel({ hebrew: true, ramGB: 8 }).name).toBe("aya-expanse:8b");
    expect(recommendOllamaModel({ hebrew: true, ramGB: 4 }).hebrew).not.toBe("none");
    expect(recommendOllamaModel({ hebrew: false, ramGB: 16 }).name).toBe("qwen2.5:7b");
    expect(recommendOllamaModel({ hebrew: true, ramGB: 16, tools: true }).tools).toBe(true);
  });

  it("knows installed names, tags and families", () => {
    expect(hebrewSupportOf("aya-expanse:8b")).toBe("strong");
    expect(hebrewSupportOf("gemma3:latest")).toBe("strong");
    expect(hebrewSupportOf("llama3.2:3b")).toBe("basic");
    expect(hebrewSupportOf("dictalm2.0-instruct:q4")).toBe("strong");
    expect(hebrewSupportOf("mystery:1b")).toBeNull();
  });

  it("detects Hebrew notes from the locale or the note", () => {
    expect(prefersHebrew("he", "")).toBe(true);
    expect(prefersHebrew("en", "שלום לכם, זה פתק ארוך מספיק בעברית כדי להחליט")).toBe(true);
    expect(prefersHebrew("en", "An English note that is long enough to decide.")).toBe(false);
    expect(prefersHebrew("en", "שלום")).toBe(false);
  });
});

describe("Hebrew-aware picks", () => {
  const installed = [
    { name: "llama3.1:8b", params: 8, family: "llama" },
    { name: "aya-expanse:8b", params: 8, family: "cohere" },
    { name: "qwen2.5:7b", params: 7.6, family: "qwen2" },
  ];
  it("prefers the model with better Hebrew in the same tier", () => {
    expect(pickModel("small", installed, null, { hebrew: true })).toBe("aya-expanse:8b");
    expect(pickModel("small", installed, null)).not.toBe("aya-expanse:8b");
  });
  it("still honours an explicitly configured model of the tier", () => {
    expect(pickModel("small", installed, "llama3.1:8b", { hebrew: true })).toBe("llama3.1:8b");
  });
  it("prefers a multilingual in-browser model", () => {
    const hw: Hardware = { webgpu: true, f16: true, maxBufferMB: 4096, deviceMemoryGB: 16, cores: 8, mobile: false };
    expect(recommendWebLlmModel("small", hw, { multilingual: true })).toMatch(/Qwen3-4B|Llama-3\.2-3B/);
  });
});

describe("answer in the input's language", () => {
  const he = "פגישת צוות: דנה תשלח את ההצעה ללקוח עד יום חמישי, יואב יבדוק את הבאג.";
  it("rejects a Latin answer to Hebrew input", () => {
    const r = sameScript(he, "Dana will send the proposal to the client by Thursday and Yoav checks the bug.");
    expect(r.ok).toBe(false);
  });
  it("accepts a Hebrew answer, JSON with English keys, and short answers", () => {
    expect(sameScript(he, "דנה תשלח את ההצעה עד יום חמישי").ok).toBe(true);
    expect(sameScript(he, { tasks: [{ title: "לשלוח הצעת מחיר ללקוח", owner: "דנה" }] }).ok).toBe(true);
    expect(sameScript(he, "OK").ok).toBe(true);
    expect(sameScript("An English input sentence here.", "Whatever language answer is fine here").ok).toBe(true);
  });
});

describe("language check exemptions (review fixes)", () => {
  const he = "כתוב לי פונקציית ג׳אווהסקריפט שמחברת שני מספרים ומחזירה את התוצאה, בבקשה.";
  it("does not count code as Latin prose", () => {
    expect(sameScript(he, "```js\nfunction add(a, b) {\n  return a + b; // returns the sum of both numbers\n}\n```").ok).toBe(true);
    expect(sameScript(he, "הנה הפונקציה:\n```js\nfunction add(a, b) { return a + b; }\n```\nהיא מחזירה את הסכום.").ok).toBe(true);
    expect(sameScript(he, "קראו ל־`computeTheTotalAmountOfEverything()` כדי לקבל סכום").ok).toBe(true);
    // Prose outside the code still counts.
    expect(sameScript(he, "Here is the function you asked for, it adds both numbers:\n```js\nadd()\n```").ok).toBe(false);
  });

  it("translation templates are language-independent", async () => {
    const { templaterAgent } = await import("../agents/defs");
    const lang = templaterAgent.language as (i: { text: string; extra: { templateId: string } }) => string;
    expect(lang({ text: "x", extra: { templateId: "he.translate_to_en" } })).toBe("any");
    expect(lang({ text: "x", extra: { templateId: "he.summarize" } })).toBe("input");
  });
});

