/**
 * W13.K2: the Quick Look extension is wired into the macOS bundle. The
 * renderer itself is tested with `rustc --test src-tauri/preview/src/lib.rs`
 * (std only, in STD_CRATES); the bundle is built and checked on the Mac
 * (`npm run tauri:build`, then the space bar on a Hebrew note in Finder).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error — plain .mjs without types
import { STD_CRATES } from "../../scripts/lib/rustStd.mjs";

const conf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const plist = readFileSync("src-tauri/quicklook/LumenPreview/Info.plist", "utf8");
const appPlist = readFileSync("src-tauri/Info.plist", "utf8");
const swift = readFileSync("src-tauri/quicklook/LumenPreview/PreviewProvider.swift", "utf8");
const lib = readFileSync("src-tauri/preview/src/lib.rs", "utf8");

describe("the Quick Look extension in the app bundle", () => {
  it("is built before bundling and copied to Contents/PlugIns", () => {
    expect(conf.build.beforeBundleCommand).toBe("node scripts/macos/quicklook.mjs");
    expect(conf.bundle.macOS.files).toEqual({ "PlugIns/LumenPreview.appex": "./target/quicklook/LumenPreview.appex" });
    const script = readFileSync("scripts/macos/quicklook.mjs", "utf8");
    expect(script).toMatch(/process\.platform !== "darwin"/);
    expect(script).toMatch(/target\/quicklook/);
    expect(script).toMatch(/_NSExtensionMain/);
  });

  it("previews Markdown, .excalidraw and .base, and the app declares those types", () => {
    for (const t of ["net.daringfireball.markdown", "app.lumen.editor.excalidraw", "app.lumen.editor.base"]) {
      expect(plist).toContain(`<string>${t}</string>`);
      expect(appPlist).toContain(`<string>${t}</string>`);
    }
    expect(plist).toMatch(/com\.apple\.quicklook\.preview/);
    expect(plist).toMatch(/<key>QLIsDataBasedPreview<\/key>\s*<true\/>/);
  });

  it("the extension is sandboxed without network, and calls the renderer's exported C functions", () => {
    const ent = readFileSync("src-tauri/quicklook/LumenPreview/LumenPreview.entitlements", "utf8");
    expect(ent).toMatch(/com\.apple\.security\.app-sandbox<\/key>\s*<true\/>/);
    expect(ent).not.toMatch(/com\.apple\.security\.network/);
    for (const sym of ["lumen_preview_render", "lumen_preview_free"]) {
      expect(lib).toMatch(new RegExp(`#\\[no_mangle\\]\\s*pub unsafe extern "C" fn ${sym}\\(`));
      expect(swift).toContain(`@_silgen_name("${sym}")`);
    }
    expect(lib).toContain("default-src 'none'");
  });

  it("the renderer is one of the std-only crates the train tests", () => {
    expect(STD_CRATES).toContainEqual(["preview", "src-tauri/preview/src/lib.rs"]);
  });
});
