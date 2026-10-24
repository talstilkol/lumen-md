/**
 * Plan 8.1 — identical output: the full preview pipeline over 50
 * documents, serialised with the static block stand-ins, must match the
 * snapshots taken before the pipeline moved into a worker. A snapshot
 * changes only when the rendering is meant to change; regenerate with
 * `npx vitest run -u src/__tests__/renderSnapshot.test.ts`.
 *
 * The 50 run through the path the browser takes — the worker's request
 * handler, its reply copied by structuredClone as postMessage does — and
 * the welcome notes and synthetic documents also through the in-thread
 * fallback that runs where no worker can start.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderMarkdown } from "../renderer/pipeline";
import { __resetRenderClient } from "../renderer/renderClient";
import { handleRenderRequest, type RenderRequest } from "../renderer/renderProtocol";
import { StaticRenderContext } from "../renderer/components";
import { setShikiLoaders } from "../renderer/shikiWorker";
import { renderDocs } from "./fixtures/renderDocs";
// @ts-expect-error — plain .mjs module without types
import { grammarsOf } from "../../scripts/copy-shiki-grammars.mjs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const docs = renderDocs();

async function html(markdown: string): Promise<string> {
  const tree = await renderMarkdown(markdown, () => false);
  return renderToStaticMarkup(createElement(StaticRenderContext.Provider, { value: true }, tree));
}

/**
 * The browser's path, in-thread: the worker's own handler, with the reply
 * copied the way postMessage copies it (structuredClone), delivered
 * asynchronously to the client's onmessage.
 */
let served = 0;
class FakeRenderWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  postMessage(req: RenderRequest) {
    void handleRenderRequest(req).then((res) => {
      served++;
      setTimeout(() => this.onmessage?.({ data: structuredClone(res) }), 0);
    });
  }
  terminate() {}
}

describe("render snapshots (50 documents)", () => {
  it("is a 50-document set", () => {
    expect(docs.length).toBe(50);
    expect(new Set(docs.map((d) => d.name)).size).toBe(50);
  });

  describe("through the render worker (handler + structuredClone)", () => {
    beforeAll(() => {
      // In Node the worker's Shiki gets its wasm and grammars from the
      // packages the copy script reads, instead of fetching public/shiki/.
      const require = createRequire(import.meta.url);
      const grammars = new Map<string, { order: string[]; grammars: Map<string, string> }>();
      const of = async (lang: string) => {
        let g = grammars.get(lang);
        if (!g) {
          try {
            g = await grammarsOf(lang);
          } catch {
            return null;
          }
          grammars.set(lang, g!);
        }
        return g!;
      };
      setShikiLoaders({
        // A Node Buffer: the engine accepts it as wasm bytes (an ArrayBuffer
        // sliced from it fails the engine's realm-bound instanceof check under jsdom).
        wasm: () => readFile(require.resolve("shiki/dist/onig.wasm")),
        grammarsFor: async (lang) => (await of(lang))?.order ?? null,
        grammar: async (name) => {
          for (const g of grammars.values()) if (g.grammars.has(name)) return JSON.parse(g.grammars.get(name)!);
          return null;
        },
      });
      vi.stubGlobal("Worker", FakeRenderWorker);
      __resetRenderClient();
    });
    afterAll(() => {
      __resetRenderClient();
      vi.unstubAllGlobals();
    });

    for (const doc of docs) {
      it(doc.name, async () => {
        const out = await html(doc.markdown);
        if (process.env.SNAP_DUMP) (await import("node:fs")).writeFileSync(`${process.env.SNAP_DUMP}/${doc.name}.html`, out);
        await expect(out).toMatchFileSnapshot(`__snapshots__/render/${doc.name}.html`);
      }, 30_000);
    }

    it("every document went through the worker path", () => {
      expect(served).toBe(docs.length);
    });
  });

  describe("on the main thread (no Worker)", () => {
    beforeAll(() => {
      vi.stubGlobal("Worker", undefined);
      __resetRenderClient();
    });
    afterAll(() => {
      __resetRenderClient();
      vi.unstubAllGlobals();
    });

    for (const doc of docs.filter((d) => /^(welcome-en|welcome-he|syn-)/.test(d.name))) {
      it(doc.name, async () => {
        await expect(await html(doc.markdown)).toMatchFileSnapshot(`__snapshots__/render/${doc.name}.html`);
      }, 30_000);
    }
  });
});
