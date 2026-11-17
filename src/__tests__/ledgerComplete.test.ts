/** 2.4 — the privacy ledger sees worker downloads and the web clipper; local-only refuses the clipper. */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { __resetLedger, guardedFetch, ledgerEntries, listenToWorkerLedger, PrivacyBlockedError } from "../ai/privacyLedger";
import { installWorkerLedger, reportWorkerDownload, __resetWorkerLedger, type WorkerLedgerMessage } from "../ai/workerLedger";
import { setAiPolicy } from "../ai/policy";

/** One in-memory channel: what the worker posts, the window hears. */
function pipe() {
  const target = new EventTarget();
  return {
    postMessage: (m: WorkerLedgerMessage) => target.dispatchEvent(new MessageEvent("message", { data: m })),
    addEventListener: target.addEventListener.bind(target) as BroadcastChannel["addEventListener"],
  };
}

beforeEach(() => {
  localStorage.clear();
  __resetLedger();
  __resetWorkerLedger();
  setAiPolicy("local-first");
});

describe("worker requests reach the ledger", () => {
  it("a model download made inside a worker is recorded, with its status and size, under the worker's name", async () => {
    const ch = pipe();
    listenToWorkerLedger(ch);
    const inner = vi.fn(async () => new Response("weights", { status: 200, headers: { "content-length": "7" } }));
    const scope = { fetch: inner as unknown as typeof fetch, name: "transformers" };
    expect(installWorkerLedger(scope, ch)).toBe(true);
    expect(installWorkerLedger(scope, ch)).toBe(false); // once
    const res = await scope.fetch("https://huggingface.co/onnx-community/whisper-base/resolve/main/model.onnx");
    expect(await res.text()).toBe("weights");
    expect(inner).toHaveBeenCalledTimes(1);
    expect(ledgerEntries()).toEqual([
      expect.objectContaining({ host: "huggingface.co", category: "model-download", decision: "allowed", status: 200, bytesIn: 7, reason: expect.stringContaining("worker: transformers") }),
    ]);
  });

  it("same-origin and other untracked requests from a worker are not listed", async () => {
    const ch = pipe();
    listenToWorkerLedger(ch);
    const scope = { fetch: (async () => new Response("x")) as unknown as typeof fetch, name: "w" };
    installWorkerLedger(scope, ch);
    await scope.fetch("/assets/ort-wasm.wasm");
    expect(ledgerEntries()).toEqual([]);
  });

  it("a download the worker's fetch cannot see (web-llm's Cache.add) is reported by the worker itself", async () => {
    expect(reportWorkerDownload("https://huggingface.co/mlc-ai/x/resolve/main/")).toBeNull(); // not installed
    const ch = pipe();
    listenToWorkerLedger(ch);
    installWorkerLedger({ fetch: (async () => new Response("")) as unknown as typeof fetch, name: "webllm" }, ch);
    const settle = reportWorkerDownload("https://huggingface.co/mlc-ai/Qwen3-4B-q4f16_1-MLC/resolve/main/");
    expect(settle).toBeTypeOf("function");
    // Recorded at the start, with no status until the load settles.
    expect(ledgerEntries()).toEqual([
      expect.objectContaining({ host: "huggingface.co", category: "model-download", decision: "allowed", bytesIn: null, reason: expect.stringContaining("worker: webllm") }),
    ]);
    expect(ledgerEntries()[0].status ?? null).toBeNull();
    settle!(200);
    settle!(0); // settles once
    expect(ledgerEntries()[0].status).toBe(200);
  });

  it("a failed model load is never recorded as a successful download", async () => {
    const ch = pipe();
    listenToWorkerLedger(ch);
    installWorkerLedger({ fetch: (async () => new Response("")) as unknown as typeof fetch, name: "webllm" }, ch);
    reportWorkerDownload("https://huggingface.co/mlc-ai/bad-model/resolve/main/")!(0);
    expect(ledgerEntries()[0].status).toBe(0);
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const worker = readFileSync(join(__dirname, "../ai/webllm.worker.ts"), "utf8");
    expect(worker).toMatch(/settle\?\.\(200\)[\s\S]*catch[\s\S]*settle\?\.\(0\)/);
  });

  it("the web-llm worker reports an uncached model before loading it, and the window adds no probe round trip", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const worker = readFileSync(join(__dirname, "../ai/webllm.worker.ts"), "utf8");
    const load = worker.slice(worker.indexOf("async function ensureLoaded"), worker.indexOf("CreateMLCEngine(modelId"));
    expect(load).toMatch(/hasModelInCache\(modelId\)[\s\S]*reportWorkerDownload\(/);
    const client = readFileSync(join(__dirname, "../ai/webllmEngine.ts"), "utf8");
    expect(client).not.toMatch(/noteModelDownload|recordWorkerRequest/);
  });

  it("every worker installs the bridge before anything else: 0 workers without the ledger (W10.D22)", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join, relative, dirname } = await import("node:path");
    const src = join(__dirname, "..");
    const workers: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) {
          if (e.name !== "__tests__") walk(join(dir, e.name));
        } else if (e.name.endsWith(".worker.ts")) workers.push(join(dir, e.name));
      }
    };
    walk(src);
    // The six the audit named are among them (2.4), and nothing was missed by the walk.
    const names = workers.map((w) => relative(src, w).replace(/\\/g, "/"));
    for (const w of ["ai/dictation/dictation.worker.ts", "ai/tts/piper.worker.ts", "ai/nikud.worker.ts", "ai/hebrewSpell.worker.ts", "plugins/ruby/ruby.worker.ts", "agents/python/python.worker.ts", "ai/transformers.worker.ts", "ai/webllm.worker.ts"]) expect(names).toContain(w);
    // Every module worker by name, and the floor at today's count (22 *.worker.ts; R8-L2 restores the >=20 of
    // #961 and tightens it to the count: a regression that drops a worker's ledger bridge with its file fails here).
    for (const w of ["agents/python/python.worker.ts", "ai/dictation/dictation.worker.ts", "ai/englishSpell.worker.ts", "ai/hebrewSpell.worker.ts", "ai/nikud.worker.ts", "ai/search.worker.ts", "ai/transformers.worker.ts", "ai/tts/kokoro.worker.ts", "ai/tts/piper.worker.ts", "ai/webllm.worker.ts", "ai/yiddishSpell.worker.ts", "entities/extract/extract.worker.ts", "graph/layout.worker.ts", "lsp/tsCheck.worker.ts", "plugins/graphviz.worker.ts", "plugins/lua/lua.worker.ts", "plugins/ruby/ruby.worker.ts", "plugins/runtime/host.worker.ts", "renderer/render.worker.ts", "search/asOf.worker.ts", "storage/vault/vault-io.worker.ts", "storage/vaultIndex.worker.ts"]) expect(names).toContain(w);
    expect(workers.length).toBeGreaterThanOrEqual(22);
    const without: string[] = [];
    for (const w of workers) {
      const text = readFileSync(w, "utf8");
      const firstImport = text.split("\n").find((l) => /^import\s/.test(l));
      // The first import (ES modules evaluate in import order), by its path from this worker.
      let want = relative(dirname(w), join(src, "ai", "workerLedgerInstall")).replace(/\\/g, "/");
      if (!want.startsWith(".")) want = `./${want}`;
      if (firstImport?.trim().split(";")[0] !== `import "${want}"`) without.push(relative(src, w));
      // A dynamic import or a fetch before it would run first.
      const before = text.slice(0, text.indexOf(firstImport ?? "\u0000"));
      if (/\bimport\(|\bfetch\(/.test(before.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""))) without.push(`${relative(src, w)} (code before it)`);
    }
    expect(without).toEqual([]);
  });
});

describe("the web clipper goes through the ledger", () => {
  it("under local-only the page is never fetched; the block is recorded", async () => {
    setAiPolicy("local-only");
    const f = vi.spyOn(globalThis, "fetch");
    await expect(guardedFetch("https://news.example/story", {}, { category: "third-party", reason: "Web clipper" })).rejects.toBeInstanceOf(PrivacyBlockedError);
    expect(f).not.toHaveBeenCalled();
    expect(ledgerEntries()).toEqual([expect.objectContaining({ host: "news.example", category: "third-party", decision: "blocked" })]);
    f.mockRestore();
  });

  it("otherwise it goes out once and is recorded with its status", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html></html>", { status: 200 }));
    const res = await guardedFetch("https://news.example/story", { credentials: "omit" }, { category: "third-party", reason: "Web clipper" });
    expect(res.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(1);
    expect(ledgerEntries()).toEqual([expect.objectContaining({ host: "news.example", decision: "allowed", status: 200 })]);
    f.mockRestore();
  });

  it("after a cross-site redirect the entry names the site the page came from", async () => {
    const r = new Response("<html></html>", { status: 200 });
    Object.defineProperty(r, "redirected", { value: true });
    Object.defineProperty(r, "url", { value: "https://www.news.example/2026/story" });
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(r);
    await guardedFetch("https://short.example/abc", { credentials: "omit" }, { category: "third-party", reason: "Web clipper" });
    expect(ledgerEntries()).toEqual([
      expect.objectContaining({ host: "www.news.example", reason: "Web clipper (redirected from short.example)", status: 200 }),
    ]);
    f.mockRestore();
  });

  it("a same-site redirect keeps the entry as it was", async () => {
    const r = new Response("<html></html>", { status: 200 });
    Object.defineProperty(r, "redirected", { value: true });
    Object.defineProperty(r, "url", { value: "https://news.example/story/" });
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(r);
    await guardedFetch("https://news.example/story", { credentials: "omit" }, { category: "third-party", reason: "Web clipper" });
    expect(ledgerEntries()).toEqual([expect.objectContaining({ host: "news.example", reason: "Web clipper" })]);
    f.mockRestore();
  });

  it("clipUrl under local-only refuses before fetching", async () => {
    setAiPolicy("local-only");
    const { clipUrl } = await import("../research/clipper");
    const f = vi.spyOn(globalThis, "fetch");
    const meta = document.createElement("meta");
    meta.httpEquiv = "Content-Security-Policy";
    meta.content = "connect-src 'self' https://news.example";
    document.head.appendChild(meta);
    try {
      await expect(clipUrl("https://news.example/story", { extract: async () => ({ error: "no-service" }) })).rejects.toMatchObject({ name: "PrivacyBlockedError" });
      expect(f).not.toHaveBeenCalled();
    } finally {
      meta.remove();
      f.mockRestore();
    }
  });

  it("clipUrl under local-only refuses before the research service's extractor too, without the generic blocked toast", async () => {
    setAiPolicy("local-only");
    const { installPrivacyLedger } = await import("../ai/privacyLedger");
    const blocked = vi.fn();
    installPrivacyLedger(blocked);
    const { clipUrl } = await import("../research/clipper");
    const extract = vi.fn(async () => ({ title: "t", text: "body" }));
    await expect(clipUrl("https://news.example/story", { extract })).rejects.toMatchObject({ name: "PrivacyBlockedError" });
    expect(extract).not.toHaveBeenCalled();
    expect(ledgerEntries()).toEqual([expect.objectContaining({ host: "news.example", category: "third-party", decision: "blocked" })]);
    expect(blocked).not.toHaveBeenCalled(); // the clip command shows its own hint; one toast, not two
  });

  it("otherwise the extractor route still clips", async () => {
    const { clipUrl } = await import("../research/clipper");
    const clip = await clipUrl("https://news.example/story", { extract: async () => ({ title: "Story", text: "Body text", finalUrl: "https://news.example/story" }) });
    expect(clip.title).toBe("Story");
    expect(clip.markdown).toContain("Body text");
  });

  it("the panel's footer no longer says worker downloads are missing, in any language", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    // privacy.footer is lazy English (startup budget, train 2): the panel's strings register it.
    await import("../ui/privacyLedgerPanelStrings");
    const { en } = await import("../i18n").then((m) => ({ en: (m as unknown as { t: (k: string) => string }).t("privacy.footer") }));
    expect(en).toMatch(/workers are listed/);
    for (const loc of ["he", "ar", "de", "fr", "ja", "ru", "zh-CN"]) {
      // The per-domain layout (plan 0.3): the footer is in <loc>/settings.json.
      const d = JSON.parse(readFileSync(join(__dirname, "../i18n/locales", loc, "settings.json"), "utf8")) as Record<string, string>;
      expect(d["privacy.footer"], loc).not.toMatch(/לא מופיעות|غير مدرجة|fehlen|ne sont pas listées|含まれません|не показаны|不在列表中/);
    }
  });
});
