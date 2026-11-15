/**
 * W10.E20 (plan W2.21) — the start's lazy chunks listed in index.html for
 * public/boot.js. The bundle below is a synthetic one, shaped like Rolldown's
 * output (fileName, facadeModuleId, imports); the real list comes from
 * `vite build` (Mac).
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BOOT_PRELOAD_ID, bootPreloadList, bootPreloadPlugin, injectBootPreload, type ChunkInfo } from "../build/bootPreload";

const ROOT = join(__dirname, "..", "..");
const chunk = (fileName: string, facadeModuleId: string | null, imports: string[] = []): ChunkInfo => ({ type: "chunk", fileName, facadeModuleId, imports });
const SYNTHETIC: Record<string, ChunkInfo> = Object.fromEntries(
  [
    chunk("assets/index-1.js", "/repo/index.html", ["assets/vendor-react-2.js", "assets/app-3.js"]),
    chunk("assets/vendor-react-2.js", null),
    chunk("assets/app-3.js", null, ["assets/vendor-react-2.js"]),
    chunk("assets/location-4.js", "/repo/src/storage/vault/location.ts", ["assets/app-3.js", "assets/idb-5.js"]),
    chunk("assets/idb-5.js", null),
    chunk("assets/vaultDocs-6.js", "/repo/src/store/vaultDocs.ts", ["assets/idb-5.js"]),
    chunk("assets/Editor-7.js", "/repo/src/editor/Editor.tsx", ["assets/vendor-codemirror-8.js", "assets/vendor-react-2.js"]),
    chunk("assets/vendor-codemirror-8.js", null),
    chunk("assets/WysiwygEditor-9.js", "C:\\repo\\src\\editor\\WysiwygEditor.tsx", ["assets/vendor-milkdown-10.js"]),
    chunk("assets/vendor-milkdown-10.js", null),
    chunk("assets/locale-he-ai-11.js", "/repo/src/i18n/locales/he/ai.json"),
    chunk("assets/locale-he-ui-12.js", "/repo/src/i18n/locales/he/ui.json"),
    chunk("assets/locale-zh-CN-ui-13.js", "/repo/src/i18n/locales/zh-CN/ui.json"),
    chunk("assets/SettingsScreen-14.js", "/repo/src/ui/SettingsScreen.tsx"),
  ].map((c) => [c.fileName, c]),
);
SYNTHETIC["assets/index.css"] = { type: "asset", fileName: "assets/index.css" };

describe("the list (synthetic bundle)", () => {
  const list = bootPreloadList(SYNTHETIC, "assets/index-1.js");

  it("each start chunk with its own imports, minus what the entry already loads", () => {
    expect(list.always).toEqual(["/assets/location-4.js", "/assets/idb-5.js", "/assets/vaultDocs-6.js"]);
    expect(list.editors).toEqual({ source: ["/assets/Editor-7.js", "/assets/vendor-codemirror-8.js"], wysiwyg: ["/assets/WysiwygEditor-9.js", "/assets/vendor-milkdown-10.js"] });
  });

  it("every language but English (in the entry), all its domains; nothing that is not on the start path", () => {
    expect(list.locales).toEqual({ he: ["/assets/locale-he-ai-11.js", "/assets/locale-he-ui-12.js"], "zh-CN": ["/assets/locale-zh-CN-ui-13.js"] });
    expect(JSON.stringify(list)).not.toContain("SettingsScreen");
    expect(JSON.stringify(list)).not.toContain("index.css");
  });

  it("under another base, the paths carry it", () => {
    expect(bootPreloadList(SYNTHETIC, "assets/index-1.js", "/app/").always[0]).toBe("/app/assets/location-4.js");
  });
});

describe("in index.html", () => {
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  const list = bootPreloadList(SYNTHETIC, "assets/index-1.js");

  it("a data tag (not a script that runs: the CSP allows none inline) right before boot.js, in <head>", () => {
    const out = injectBootPreload(html, list);
    const tag = out.indexOf(`<script type="application/json" id="${BOOT_PRELOAD_ID}">`);
    expect(tag).toBeGreaterThan(0);
    expect(tag).toBeLessThan(out.indexOf('<script src="/boot.js"></script>'));
    expect(out.indexOf("</head>")).toBeGreaterThan(tag);
    const json = out.slice(out.indexOf(">", tag) + 1, out.indexOf("</script>", tag));
    expect(JSON.parse(json)).toEqual(list);
    // The charset stays in the first 1024 bytes.
    expect(out.indexOf("<meta charset")).toBeLessThan(1024);
  });

  it("text in a file name cannot close the tag; a page without boot.js is unchanged", () => {
    const out = injectBootPreload(html, { always: ["/assets/</script><b>.js"], editors: {}, locales: {} });
    expect(out).not.toContain("</script><b>");
    expect(injectBootPreload("<html><head></head></html>", list)).toBe("<html><head></head></html>");
  });

  it("the plugin: builds only, index.html only, and it is in vite.config.ts", () => {
    const p = bootPreloadPlugin();
    expect(p.apply).toBe("build");
    const hook = p.transformIndexHtml as { order: string; handler: (h: string, ctx: unknown) => string };
    expect(hook.order).toBe("post");
    const ctx = { path: "/index.html", bundle: SYNTHETIC, chunk: SYNTHETIC["assets/index-1.js"] };
    expect(hook.handler(html, ctx)).toContain(`id="${BOOT_PRELOAD_ID}"`);
    expect(hook.handler(html, { ...ctx, path: "/public/landing.html" })).toBe(html);
    expect(hook.handler(html, { path: "/index.html" })).toBe(html);
    expect(readFileSync(join(ROOT, "vite.config.ts"), "utf8")).toMatch(/\n\s+bootPreloadPlugin\(\),\n/);
  });

  it("the module paths it looks for exist", () => {
    for (const f of ["src/storage/vault/location.ts", "src/store/vaultDocs.ts", "src/editor/Editor.tsx", "src/editor/WysiwygEditor.tsx"]) expect(() => readFileSync(join(ROOT, f))).not.toThrow();
  });
});
