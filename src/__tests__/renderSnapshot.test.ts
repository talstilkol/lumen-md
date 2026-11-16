/**
 * Plan 8.1 — identical output: the full preview pipeline over 50
 * documents, serialised with the static block stand-ins, must match the
 * snapshots taken before the pipeline moved into a worker. A snapshot
 * changes only when the rendering is meant to change; regenerate with
 * `npx vitest run -u src/__tests__/renderSnapshot.test.ts`.
 *
 * The test also runs the exact path the browser takes: the worker's
 * request handler, with the reply passed through structuredClone (what
 * postMessage does), when the pipeline exposes it.
 */
import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderMarkdown } from "../renderer/pipeline";
import { StaticRenderContext } from "../renderer/components";
import { renderDocs } from "./fixtures/renderDocs";

const docs = renderDocs();

async function html(markdown: string): Promise<string> {
  const tree = await renderMarkdown(markdown, () => false);
  return renderToStaticMarkup(createElement(StaticRenderContext.Provider, { value: true }, tree));
}

describe("render snapshots (50 documents)", () => {
  it("is a 50-document set", () => {
    expect(docs.length).toBe(50);
    expect(new Set(docs.map((d) => d.name)).size).toBe(50);
  });

  it("every document has its snapshot, and every snapshot its document (W10.Z3)", () => {
    const snaps = readdirSync(join(__dirname, "__snapshots__", "render")).filter((f: string) => f.endsWith(".html")).map((f: string) => f.slice(0, -5)).sort();
    expect(docs.map((d) => d.name).sort()).toEqual(snaps);
  });

  for (const doc of docs) {
    it(doc.name, async () => {
      await expect(await html(doc.markdown)).toMatchFileSnapshot(`__snapshots__/render/${doc.name}.html`);
    }, 30_000);
  }
});
