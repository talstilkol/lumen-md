/**
 * W11.I10: the model catalog after Gemma 4 and Qwen3.5 (research R2.4, R4).
 *  - every Ollama catalog entry has a verified licence in models/registry.json (gate 0.10);
 *  - Gemma 4 is Apache-2.0 (it left the Gemma Terms), Gemma 1–3 stay conditional;
 *  - Qwen3.5 gets think: false; qwen2.5:7b is legacy (still the default until W11.I12 measures);
 *  - the new entries are never auto-picked before they are measured;
 *  - the in-browser default stays ≤ 1.5 GB.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OLLAMA_CATALOG, licenceClassOf, ollamaLicence, recommendOllamaModel, thinkDefaultFor } from "../ai/modelCatalog";
import { WEBLLM_CATALOG, catalogEntryFor, recommendWebLlmModel, type Hardware } from "../ai/modelManager";

const base = vi.hoisted(() => ({ url: "http://127.0.0.1:11434" }));
vi.mock("../ai/ollamaProvider", () => ({ getBaseUrl: () => base.url }));
import { ollamaExecutor, __resetOllamaState } from "../agents/executors/ollama";

const registry = JSON.parse(readFileSync(join(process.cwd(), "models/registry.json"), "utf8")) as { models: Array<{ id: string; class: string; license: string; verified: boolean }> };
const byId = new Map(registry.models.map((m) => [m.id, m]));
const NEW = ["gemma4:e2b", "gemma4:e4b", "gemma4:26b", "qwen3.5:4b", "qwen3.5:9b", "hf.co/dicta-il/DictaLM-3.0-24B-Thinking-GGUF"];

describe("catalog entries and the licence registry", () => {
  it("lists Gemma 4, Qwen3.5 and the desktop pair", () => {
    for (const n of NEW) expect(OLLAMA_CATALOG.some((e) => e.name === n), n).toBe(true);
    expect(OLLAMA_CATALOG.filter((e) => e.desktop).map((e) => e.name).sort()).toEqual(["gemma4:26b", "hf.co/dicta-il/DictaLM-3.0-24B-Thinking-GGUF"]);
  });

  it("0 entries without a verified licence: every catalog entry is in the registry, verified, with the same class", () => {
    const missing = OLLAMA_CATALOG.filter((e) => {
      const r = byId.get(e.name);
      return !r || !r.verified || r.class === "unknown" || r.class !== e.licence?.class || r.license !== e.licence?.name;
    }).map((e) => e.name);
    expect(missing).toEqual([]);
  });

  it("the browser routes for Gemma 4 E2B are registered (web-llm 0.2.86, transformers.js) with a verified Apache-2.0 licence", () => {
    for (const id of ["gemma-4-E2B-it-q4f16_1-MLC", "onnx-community/gemma-4-E2B-it-ONNX"]) expect(byId.get(id), id).toMatchObject({ license: "Apache-2.0", class: "allowed", verified: true });
  });
});

describe("licences by name", () => {
  it("Gemma 4 is Apache-2.0 under any tag or Hugging Face name; Gemma 1-3 stay conditional", () => {
    for (const n of ["gemma4:e2b", "gemma4:31b", "gemma4:26b-a4b-it-q8_0", "gemma4:latest", "hf.co/unsloth/gemma-4-E4B-it-GGUF:Q4_K_M"]) expect(licenceClassOf(n), n).toBe("allowed");
    expect(ollamaLicence("gemma4:e4b")?.name).toBe("Apache-2.0");
    for (const n of ["gemma3:12b", "gemma3:latest", "gemma2:9b", "hf.co/bartowski/gemma-2-9b-it-GGUF", "codegemma:7b"]) expect(licenceClassOf(n), n).toBe("conditional");
  });

  it("Qwen3.5 sizes are Apache-2.0", () => {
    expect(licenceClassOf("qwen3.5:4b")).toBe("allowed");
    expect(licenceClassOf("qwen3.5:9b-q8_0")).toBe("allowed");
  });
});

describe("defaults", () => {
  it("new entries are never auto-picked before they are measured (W11.I12 decides)", () => {
    for (const hebrew of [true, false]) for (const ramGB of [4, 8, 16, 32, 64]) for (const tools of [true, false]) expect(NEW, `${hebrew} ${ramGB} ${tools}`).not.toContain(recommendOllamaModel({ hebrew, ramGB, tools }).name);
  });

  it("qwen2.5:7b is marked legacy and is still the non-Hebrew default", () => {
    const e = OLLAMA_CATALOG.find((x) => x.name === "qwen2.5:7b")!;
    expect(e.legacy).toBe(true);
    expect(e.label).toContain("legacy");
    expect(recommendOllamaModel({ hebrew: false, ramGB: 8 }).name).toBe("qwen2.5:7b");
  });

  it("the in-browser default (the tiny tier on a 4 GB device) is at most 1.5 GB", () => {
    const hw: Hardware = { webgpu: true, f16: true, maxBufferMB: 2048, deviceMemoryGB: 4, cores: 4, mobile: false };
    const entry = catalogEntryFor(recommendWebLlmModel("tiny", hw, { multilingual: true }))!;
    expect(entry.vramMB.f16).toBeLessThanOrEqual(1536);
    expect(WEBLLM_CATALOG.length).toBeGreaterThan(5);
  });

  it("Gemma 4 E2B/E4B record audio input as a later path for dictation correction", () => {
    for (const n of ["gemma4:e2b", "gemma4:e4b"]) expect(OLLAMA_CATALOG.find((e) => e.name === n)?.future).toMatch(/audio input/);
  });
});

describe("Qwen3.5 thinking is off", () => {
  let bodies: Array<Record<string, unknown>>;
  beforeEach(() => {
    __resetOllamaState();
    bodies = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        if (path === "/api/chat") {
          bodies.push(JSON.parse(String(init?.body)));
          return new Response(JSON.stringify({ message: { role: "assistant", content: "ok" }, done: true }), { status: 200 });
        }
        if (path === "/api/tags") return new Response(JSON.stringify({ models: [] }), { status: 200 });
        if (path === "/api/version") return new Response(JSON.stringify({ version: "0.12.0" }), { status: 200 });
        return new Response("{}", { status: 200 });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("thinkDefaultFor: false for Qwen3.5 (any quantisation tag), nothing for the others", () => {
    expect(thinkDefaultFor("qwen3.5:4b")).toBe(false);
    expect(thinkDefaultFor("qwen3.5:9b-q8_0")).toBe(false);
    expect(thinkDefaultFor("qwen3:8b")).toBeUndefined();
    expect(thinkDefaultFor("gemma4:e2b")).toBeUndefined();
  });

  it("the executor sends think: false to Qwen3.5 unless the request asks, and nothing extra to other models", async () => {
    await ollamaExecutor.chat({ messages: [{ role: "user", content: "hi" }], model: "qwen3.5:4b" });
    await ollamaExecutor.chat({ messages: [{ role: "user", content: "hi" }], model: "qwen3.5:4b", think: true });
    await ollamaExecutor.chat({ messages: [{ role: "user", content: "hi" }], model: "qwen3:8b" });
    expect(bodies.map((b) => b.think)).toEqual([false, true, undefined]);
  });
});
