/**
 * W10.B6 (coordinator decision): Hebrew → English keyword search finds 0/30
 * on the held-out probe (hebrewMorph.test.ts), so cross-lingual search is
 * only claimed with a multilingual embedding model (bge-m3 / EmbeddingGemma),
 * and when one is present the Hebrew query takes the embedding path.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CROSS_LINGUAL_MODELS, crossLingualPath, isMultilingualEmbedding } from "../search/crossLingual";

// The Ollama server's model list (what `ollama list` would return here).
let installed: string[] = [];
vi.mock("../ai/ollamaProvider", () => ({
  getBaseUrl: () => "http://127.0.0.1:11434",
  isOllamaAvailable: async () => true,
  listOllamaModels: async () => installed.map((name) => ({ name, size: 1, digest: "x", modifiedAt: "" })),
}));

import { __providers } from "../ai/embeddingProvider";

const lazy = JSON.parse(readFileSync(join(__dirname, "../i18n/lazy/searchDialog.json"), "utf8")) as Record<string, string>;
const he = JSON.parse(readFileSync(join(__dirname, "../i18n/locales/he/files.json"), "utf8")) as Record<string, string>;
const doc = (p: string) => readFileSync(join(__dirname, "../../docs/src/content/docs", p), "utf8");

describe("which models bridge Hebrew and English", () => {
  it("bge-m3 and EmbeddingGemma count as multilingual; English-only models don't", () => {
    expect(isMultilingualEmbedding("ollama:bge-m3:latest")).toBe(true);
    expect(isMultilingualEmbedding("ollama:embeddinggemma:300m")).toBe(true);
    expect(isMultilingualEmbedding("ollama:nomic-embed-text")).toBe(false);
    expect(isMultilingualEmbedding("ollama:mxbai-embed-large")).toBe(false);
    expect(CROSS_LINGUAL_MODELS).toEqual(["bge-m3", "embeddinggemma"]);
  });

  it("with Ollama holding an English-only and a multilingual model, smart search embeds with the multilingual one", async () => {
    installed = ["nomic-embed-text:latest", "embeddinggemma:300m"];
    expect(await __providers.ollamaEmbeddingModel()).toBe("embeddinggemma:300m");
    installed = ["mxbai-embed-large", "bge-m3:latest", "nomic-embed-text"];
    expect(await __providers.ollamaEmbeddingModel()).toBe("bge-m3:latest");
    installed = ["nomic-embed-text"];
    expect(await __providers.ollamaEmbeddingModel()).toBe("nomic-embed-text");
  });
});

describe("the path a Hebrew query takes to English notes", () => {
  beforeEach(() => {
    installed = [];
  });
  const gemma = { id: "ollama:embeddinggemma:300m", multilingual: true };
  const nomic = { id: "ollama:nomic-embed-text", multilingual: false };

  it("a multilingual model whose index is built: the embedding path", () => {
    expect(crossLingualPath("מתכון לעוגה", gemma, gemma.id)).toEqual({ path: "embedding", model: gemma.id });
  });

  it("no multilingual model: keyword only, and the reason is the missing model", () => {
    expect(crossLingualPath("מתכון לעוגה", nomic, nomic.id)).toEqual({ path: "keyword-only", reason: "needs-model" });
    expect(crossLingualPath("מתכון לעוגה", null, null)).toEqual({ path: "keyword-only", reason: "needs-model" });
  });

  it("a multilingual model, but the index was built with another (or none): keyword only until it is rebuilt", () => {
    expect(crossLingualPath("מתכון לעוגה", gemma, nomic.id)).toEqual({ path: "keyword-only", reason: "reindex", model: gemma.id });
    expect(crossLingualPath("מתכון לעוגה", gemma, null)).toMatchObject({ reason: "reindex" });
  });

  it("an English query is not cross-lingual here", () => {
    expect(crossLingualPath("cake recipe", nomic, nomic.id)).toEqual({ path: "same-language" });
  });
});

describe("the UI and the docs say what it needs, and don't claim it works without it", () => {
  it("the status lines (en, he) name the multilingual models", () => {
    for (const k of ["searchDialog.crossLingual.keyword", "searchDialog.monolingualEmbeddings"]) {
      for (const s of [lazy[k], he[k]]) {
        expect(s, k).toMatch(/bge-m3/);
        expect(s, k).toMatch(/EmbeddingGemma/);
      }
    }
    // The old line said Hebrew questions find English notes "by keywords": at 0/30 they don't.
    expect(lazy["searchDialog.monolingualEmbeddings"]).not.toMatch(/find English notes by keywords/);
    expect(lazy["searchDialog.reindex"] ?? lazy["searchDialog.crossLingual.reindex"]).toBeTruthy();
  });

  it("the search docs (en, he) give the status: 0/30 by keywords, and the multilingual model it needs", () => {
    for (const p of ["workspace/search.md", "he/workspace/search.md"]) {
      const d = doc(p);
      expect(d, p).toMatch(/0\/30/);
      expect(d, p).toMatch(/bge-m3/);
      expect(d, p).toMatch(/EmbeddingGemma/);
    }
  });
});
