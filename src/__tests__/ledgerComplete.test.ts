/** 2.4 — the privacy ledger sees worker downloads and the web clipper; local-only refuses the clipper. */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { __resetLedger, guardedFetch, ledgerEntries, listenToWorkerLedger, PrivacyBlockedError } from "../ai/privacyLedger";
import { installWorkerLedger, type WorkerLedgerMessage } from "../ai/workerLedger";
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

  it("the transformers and web-llm workers install the bridge before anything else", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    for (const f of ["transformers.worker.ts", "webllm.worker.ts"]) {
      const src = readFileSync(join(__dirname, "../ai", f), "utf8");
      const firstImport = src.split("\n").find((l) => l.startsWith("import "));
      expect(firstImport, f).toMatch(/^import "\.\/workerLedgerInstall";/);
    }
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
});
