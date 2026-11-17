/**
 * W13.M5: iPad — the palette's shortcuts as UIKeyCommands (listed while ⌘
 * is held, in English and Hebrew), and windows as UIScenes (several notes
 * side by side). The Swift table is generated from src/lib/shortcuts.ts;
 * UPDATE_IOS_KEYS=1 rewrites it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KEY_COMMAND_TITLES, installKeyCommandBridge, keyCommandSpecs, keydownFor, swiftSource } from "../mobile/keyCommands";
import { SHORTCUTS, appShortcutFor } from "../lib/shortcuts";
import { parseNativeUrl, safeVaultPath } from "../mobile/nativeActions";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const locale = (lang: string) => {
  const out: Record<string, string> = {};
  for (const f of ["common.json", "cmd.json", "toast.json", "files.json", "ai.json", "editor.json", "settings.json", "canvas.json"]) {
    try {
      Object.assign(out, JSON.parse(read(`src/i18n/locales/${lang}/${f}`)));
    } catch {
      /* why: a domain file this language does not have */
    }
  }
  return out;
};
const EN = locale("en");
const HE = locale("he");
const tr = (k: string, lang: "en" | "he") => (lang === "he" ? HE[k] : EN[k]) ?? "";
const SWIFT = "ios/App/App/KeyCommandsData.swift";

describe("UIKeyCommands for the palette's shortcuts", () => {
  const specs = keyCommandSpecs(tr);

  it("20 shortcuts, each with an English and a Hebrew title", () => {
    expect(specs.length).toBeGreaterThanOrEqual(20);
    for (const s of specs) {
      expect(s.titleEn, s.id).toMatch(/\S/);
      expect(s.titleHe, s.id).toMatch(/[א-ת]|WYSIWYG/);
    }
    expect(new Set(specs.map((s) => s.id)).size).toBe(specs.length);
  });

  it("no two commands share a key, and no editor key is taken from the WebView", () => {
    const keys = specs.map((s) => `${[...s.modifiers].sort().join("+")}+${s.input}`);
    expect(new Set(keys).size).toBe(keys.length);
    const editor = new Set(SHORTCUTS.filter((s) => s.scope === "editor").map((s) => s.id));
    for (const s of specs) expect(editor.has(s.id), s.id).toBe(false);
    expect(specs.map((s) => s.id)).not.toContain("edit.bold");
  });

  it("modifiers map to UIKit's (Mod → command, Alt → alternate)", () => {
    const today = specs.find((s) => s.id === "note.today")!;
    expect(today).toMatchObject({ input: "d", modifiers: ["command", "alternate"], menu: "go" });
    expect(specs.find((s) => s.id === "help.open")).toMatchObject({ input: "F1", modifiers: [] });
  });

  it("every registered shortcut has a title key that exists in both languages", () => {
    for (const [id, key] of Object.entries(KEY_COMMAND_TITLES)) {
      expect(EN[key], `${id} → ${key} (en)`).toBeTruthy();
      expect(HE[key], `${id} → ${key} (he)`).toBeTruthy();
    }
    expect(() => keyCommandSpecs(() => "x")).not.toThrow();
  });

  it(`${SWIFT} is generated from the table`, () => {
    const want = swiftSource(specs);
    if (process.env.UPDATE_IOS_KEYS) writeFileSync(join(ROOT, SWIFT), want);
    expect(read(SWIFT)).toBe(want);
    expect((want.match(/\.init\(id:/g) ?? []).length).toBe(specs.length);
  });

  it("a key command runs as the same key press the hardware keyboard sends", () => {
    for (const s of SHORTCUTS.filter((x) => x.scope === "app")) {
      const init = keydownFor(s.combo);
      expect(appShortcutFor(init as { key: string }), s.id).toBe(s.id);
    }
    expect(keydownFor("Mod+Alt+D")).toMatchObject({ code: "KeyD", metaKey: true, altKey: true });
    const seen: KeyboardEvent[] = [];
    const on = (e: Event) => seen.push(e as KeyboardEvent);
    window.addEventListener("keydown", on);
    const stop = installKeyCommandBridge();
    window.dispatchEvent(new CustomEvent("lumen:key-command", { detail: { id: "palette.toggle" } }));
    window.dispatchEvent(new CustomEvent("lumen:key-command", { detail: { id: "edit.bold" } }));
    window.dispatchEvent(new CustomEvent("lumen:key-command", { detail: { id: 42 } }));
    stop();
    window.removeEventListener("keydown", on);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ key: "k", metaKey: true });
  });

  it("the view controller registers them and iPadOS's menu builder lists them", () => {
    const vc = read("ios/App/App/LumenNative.swift");
    expect(vc).toMatch(/override var keyCommands: \[UIKeyCommand\]\?/);
    expect(read("ios/App/App/KeyCommands.swift")).toMatch(/wantsPriorityOverSystemBehavior = true/);
    expect(read("ios/App/App/AppDelegate.swift")).toMatch(/override func buildMenu\(with builder: UIMenuBuilder\)/);
  });
});

describe("several windows (UIScene)", () => {
  it("Info.plist declares a scene manifest that supports multiple scenes, with the SceneDelegate", () => {
    const plist = read("ios/App/App/Info.plist");
    expect(plist).toMatch(/<key>UIApplicationSupportsMultipleScenes<\/key>\s*<true\/>/);
    expect(plist).toMatch(/<string>\$\(PRODUCT_MODULE_NAME\)\.SceneDelegate<\/string>/);
    expect(plist).toMatch(/<string>com\.lumen\.editor\.window<\/string>/);
  });

  it("every new Swift file is compiled by the App target", () => {
    const pbx = read("ios/App/App.xcodeproj/project.pbxproj");
    for (const f of ["KeyCommands.swift", "KeyCommandsData.swift", "SceneDelegate.swift"]) {
      expect(pbx, f).toContain(`/* ${f} */ = {isa = PBXFileReference;`);
      const phase = /504EC3001FED79650016851F \/\* Sources \*\/ = \{[\s\S]*?\};/.exec(pbx)![0];
      expect(phase, f).toContain(`/* ${f} in Sources */`);
    }
  });

  it("a window opened for a note opens that note: lumen://open?path=…", () => {
    expect(parseNativeUrl("lumen://open?path=Projects%2F%D7%A4%D7%AA%D7%A7.md")?.action).toEqual({ kind: "open", path: "Projects/פתק.md" });
    for (const bad of ["../etc/passwd", "/abs.md", "a/../b.md", "file:x.md", "a//b.md", ""]) expect(safeVaultPath(bad), bad).toBeNull();
    expect(parseNativeUrl("lumen://open")).toBeNull();
    expect(read("ios/App/App/SceneDelegate.swift")).toMatch(/requestSceneSessionActivation/);
  });
});
