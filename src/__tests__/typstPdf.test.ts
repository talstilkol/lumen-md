/**
 * W12.F2: Typst → PDF in the browser through a vendored typst.ts, loaded on
 * demand from this origin. The compiler is a stand-in here (the wasm is
 * vendored on the Mac: plan/mac-pack/FC2.json); what is checked is the
 * loading — same origin only, fonts first, TTF/OTF only, once — and that a
 * build without it says so instead of failing silently.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { __resetTypst, loadTypstCompiler, markdownToTypstPdf, TYPST_BASE, TypstUnavailableError, type TypstDeps } from "../storage/typstPdf";
import { fontFiles } from "../../scripts/typst/vendor.mjs";

const ok = (body: unknown) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200 });

function deps(over: Partial<TypstDeps> = {}) {
  const urls: string[] = [];
  const made: Array<{ wasmUrl: string; fonts: Uint8Array[] }> = [];
  const compiled: string[] = [];
  const d: TypstDeps = {
    fetch: async (url) => {
      urls.push(url);
      if (url.endsWith("fonts.json")) return ok({ fonts: [{ file: "DavidLibre-Regular.ttf" }] });
      if (url.endsWith(".ttf")) return new Response(new Uint8Array([0, 1, 0, 0]));
      return new Response("", { status: 404 });
    },
    importVendor: async (url) => {
      urls.push(url);
      return { createCompiler: async (o) => (made.push(o), { pdf: async (main: string) => (compiled.push(main), new TextEncoder().encode("%PDF-1.7")) }) };
    },
    ...over,
  };
  return { d, urls, made, compiled };
}

beforeEach(() => __resetTypst());

describe("loading the compiler", () => {
  it("reads fonts.json, the fonts and the module from /vendor/typst/ only, once", async () => {
    const x = deps();
    await loadTypstCompiler(x.d);
    await loadTypstCompiler(x.d);
    expect(x.urls).toEqual([`${TYPST_BASE}fonts.json`, `${TYPST_BASE}fonts/DavidLibre-Regular.ttf`, `${TYPST_BASE}typst.mjs`]);
    expect(x.urls.every((u) => u.startsWith("/vendor/typst/"))).toBe(true);
    expect(x.made).toEqual([{ wasmUrl: "/vendor/typst/compiler.wasm", fonts: [new Uint8Array([0, 1, 0, 0])] }]);
  });

  it("a build without the vendored folder, or with a bad font entry, is 'unavailable', and the next try starts over", async () => {
    await expect(loadTypstCompiler(deps({ fetch: async () => new Response("", { status: 404 }) }).d)).rejects.toBeInstanceOf(TypstUnavailableError);
    await expect(loadTypstCompiler(deps({ fetch: async (u) => (u.endsWith("fonts.json") ? ok({ fonts: [{ file: "../../evil.woff2" }] }) : ok("")) }).d)).rejects.toMatchObject({ reason: "no-fonts" });
    const x = deps({ importVendor: async () => Promise.reject(new TypeError("Failed to fetch dynamically imported module")) });
    await expect(loadTypstCompiler(x.d)).rejects.toMatchObject({ reason: "not-installed" });
    await expect(loadTypstCompiler(deps().d)).resolves.toBeTruthy();
  });

  it("compiles the app's own Typst for a Hebrew note", async () => {
    const x = deps();
    const pdf = await markdownToTypstPdf("# שלום\n\nפסקה בעברית עם English.", "הערה", x.d);
    expect(new TextDecoder().decode(pdf)).toBe("%PDF-1.7");
    expect(x.compiled[0]).toContain('lang: "he"');
    expect(x.compiled[0]).toContain("פסקה בעברית");
  });
});

describe("vendoring", () => {
  it("keeps only the font files Typst reads, and the folder is git-ignored", () => {
    expect(fontFiles(["b.otf", "A.TTF", "c.woff2", "OFL.txt"])).toEqual(["A.TTF", "b.otf"]);
    expect(readFileSync(join(__dirname, "../../.gitignore"), "utf8")).toMatch(/^public\/vendor\/typst\/$/m);
  });

  it("the export command reports a missing compiler instead of failing silently", async () => {
    const toast = vi.fn();
    vi.doMock("../ui/AiToast", () => ({ showAiToast: toast }));
    vi.doMock("../storage/exportReady", () => ({ exportReadyText: async (s: string) => s }));
    const { exportAs } = await import("../commands/domains/exportActions");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    await exportAs({ name: "note.md", content: "# x" }, "typst-pdf");
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("Typst PDF is not installed"), "error");
    vi.unstubAllGlobals();
  });
});
