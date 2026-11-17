/**
 * Audit W10.C7 (plans W3.4, W4.22): every Swift file of the iOS app is in
 * an Xcode target. Before, LumenIntents, LumenNative, iCloudSync and the
 * widget were not in project.pbxproj, so Siri's intents and the widget
 * never compiled. The project file is parsed (its OpenStep plist syntax),
 * not grepped. Compiling is the Mac's (10.M).
 *
 * W11.P8 / W11.P9 add the shared capture queue (App + LumenShare), the native
 * capture sheet, the Control Center and Lock Screen widgets, and our own
 * share extension (LumenShare).
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parseOpenStep, type V } from "./helpers/openStep";

const ROOT = process.cwd();
const project = parseOpenStep(readFileSync(join(ROOT, "ios/App/App.xcodeproj/project.pbxproj"), "utf8")) as Record<string, V>;
const objects = project.objects as Record<string, Record<string, V>>;
const obj = (id: string) => {
  const o = objects[id];
  if (!o) throw new Error(`dangling reference ${id}`);
  return o;
};
const targets = () => Object.entries(objects).filter(([, o]) => o.isa === "PBXNativeTarget");
const target = (name: string) => targets().find(([, o]) => o.name === name)!;
const phase = (t: Record<string, V>, isa: string) => (t.buildPhases as string[]).map(obj).find((p) => p.isa === isa)!;
/** A file reference's path from the project root (its groups' paths joined). */
function pathOf(refId: string): string {
  const parents = new Map<string, string>();
  for (const [id, o] of Object.entries(objects)) for (const c of (o.children as string[] | undefined) ?? []) parents.set(c, id);
  const parts: string[] = [];
  for (let id: string | undefined = refId; id; id = parents.get(id)) {
    const o = obj(id);
    if (typeof o.path === "string") parts.unshift(o.path);
  }
  return parts.join("/");
}
const sourcesOf = (name: string) => ((phase(target(name)[1], "PBXSourcesBuildPhase").files as string[]) ?? []).map((bf) => "ios/App/" + pathOf(obj(bf).fileRef as string));

function swiftFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      // CapApp-SPM is a Swift package Xcode builds through its Package.swift, not a target of this project.
      if (e !== "CapApp-SPM" && !e.endsWith(".xcodeproj")) swiftFiles(p, out);
    } else if (e.endsWith(".swift")) out.push(relative(ROOT, p).split("\\").join("/"));
  }
  return out;
}

describe("the iOS project (W10.C7)", () => {
  it("parses, and every reference points at an object", () => {
    for (const [id, o] of Object.entries(objects)) {
      expect(id, id).toMatch(/^[0-9A-F]{24}$/);
      for (const k of ["fileRef", "target", "targetProxy", "productReference", "buildConfigurationList"]) if (typeof o[k] === "string") obj(o[k] as string);
      for (const k of ["files", "children", "buildPhases", "dependencies", "buildConfigurations", "targets"]) for (const r of (o[k] as string[] | undefined) ?? []) obj(r);
    }
  });

  it("0 Swift files outside a target: the app's in App, the widgets' in LumenWidgets, the share sheet's in LumenShare", () => {
    const inTargets = new Set([...sourcesOf("App"), ...sourcesOf("LumenWidgets"), ...sourcesOf("LumenShare")]);
    const all = swiftFiles(join(ROOT, "ios/App"));
    expect(all.filter((f) => !inTargets.has(f))).toEqual([]);
    // W13.M2–M5 (#1230): the document camera, the Live Activity, the Spotlight entity, the iPad scenes and key commands.
    expect(sourcesOf("App").sort()).toEqual([
      "ios/App/App/AppDelegate.swift",
      "ios/App/App/DocScanner.swift",
      "ios/App/App/KeyCommands.swift",
      "ios/App/App/KeyCommandsData.swift",
      "ios/App/App/LanDiscovery.swift",
      "ios/App/App/LiveCapture.swift",
      "ios/App/App/LumenIntents.swift",
      "ios/App/App/LumenNative.swift",
      "ios/App/App/NativeCapture.swift",
      "ios/App/App/NoteEntity.swift",
      "ios/App/App/SceneDelegate.swift",
      "ios/App/App/iCloudSync.swift",
      "ios/App/Shared/CaptureActivity.swift",
      "ios/App/Shared/CaptureQueue.swift",
    ]);
    expect(sourcesOf("LumenWidgets").sort()).toEqual(["ios/App/LumenWidgets/CaptureLiveActivity.swift", "ios/App/LumenWidgets/LumenControls.swift", "ios/App/LumenWidgets/LumenWidgets.swift", "ios/App/Shared/CaptureActivity.swift"]);
    expect(sourcesOf("LumenShare").sort()).toEqual(["ios/App/LumenShare/ShareViewController.swift", "ios/App/Shared/CaptureQueue.swift"]);
    // The old, unbuilt ShareExtension (SLComposeServiceViewController) is gone.
    expect(() => statSync(join(ROOT, "ios/ShareExtension"))).toThrow();
  });

  it("the widgets and the share sheet are app extensions the app builds first and embeds", () => {
    const [, app] = target("App");
    for (const name of ["LumenWidgets", "LumenShare"]) {
      const [wid, w] = target(name);
      expect(w.productType).toBe("com.apple.product-type.app-extension");
      expect(obj(w.productReference as string).path).toBe(`${name}.appex`);
      const dep = (app.dependencies as string[]).map(obj).find((d) => d.target === wid);
      expect(dep, name).toBeTruthy();
      expect(obj(dep!.targetProxy as string).remoteGlobalIDString).toBe(wid);
    }
    const embed = (app.buildPhases as string[]).map(obj).find((p) => p.isa === "PBXCopyFilesBuildPhase")!;
    expect(embed.dstSubfolderSpec).toBe("13"); // PlugIns
    expect((embed.files as string[]).map((f) => obj(obj(f).fileRef as string).path)).toEqual(["LumenWidgets.appex", "LumenShare.appex"]);
    expect((obj(project.rootObject as string).targets as string[]).map((t) => obj(t).name)).toEqual(["App", "LumenWidgets", "LumenShare"]);
  });

  it("each target has its Info.plist, entitlements with the App Group, bundle id and version in lock-step", () => {
    const settings = (name: string) => (obj(target(name)[1].buildConfigurationList as string).buildConfigurations as string[]).map((c) => obj(c).buildSettings as Record<string, string>);
    for (const s of settings("LumenWidgets")) {
      expect(s.PRODUCT_BUNDLE_IDENTIFIER).toBe("com.lumen.editor.LumenWidgets");
      expect(s.INFOPLIST_FILE).toBe("LumenWidgets/Info.plist");
      expect(s.CODE_SIGN_ENTITLEMENTS).toBe("LumenWidgets/LumenWidgets.entitlements");
    }
    for (const s of settings("LumenShare")) {
      expect(s.PRODUCT_BUNDLE_IDENTIFIER).toBe("com.lumen.editor.LumenShare");
      expect(s.INFOPLIST_FILE).toBe("LumenShare/Info.plist");
      expect(s.CODE_SIGN_ENTITLEMENTS).toBe("LumenShare/LumenShare.entitlements");
    }
    for (const s of settings("App")) expect(s.CODE_SIGN_ENTITLEMENTS).toBe("App/App.entitlements");
    // The extension's version must match the app's (App Store rule): the release bump changes all of them.
    const versions = new Set([...settings("App"), ...settings("LumenWidgets"), ...settings("LumenShare")].map((s) => `${s.MARKETING_VERSION}/${s.CURRENT_PROJECT_VERSION}`));
    expect(versions.size).toBe(1);
    const info = readFileSync(join(ROOT, "ios/App/LumenWidgets/Info.plist"), "utf8");
    expect(info).toMatch(/<key>NSExtensionPointIdentifier<\/key>\s*<string>com\.apple\.widgetkit-extension<\/string>/);
    expect(info).toMatch(/<key>CFBundleShortVersionString<\/key>\s*<string>\$\(MARKETING_VERSION\)<\/string>/);
    const share = readFileSync(join(ROOT, "ios/App/LumenShare/Info.plist"), "utf8");
    expect(share).toMatch(/<key>NSExtensionPointIdentifier<\/key>\s*<string>com\.apple\.share-services<\/string>/);
    expect(share).toMatch(/<key>NSExtensionPrincipalClass<\/key>\s*<string>\$\(PRODUCT_MODULE_NAME\)\.ShareViewController<\/string>/);
    for (const k of ["SupportsText", "SupportsWebURLWithMaxCount", "SupportsImageWithMaxCount", "SupportsFileWithMaxCount"]) expect(share, k).toContain(`<key>NSExtensionActivation${k}</key>`);
    for (const f of ["ios/App/App/App.entitlements", "ios/App/LumenWidgets/LumenWidgets.entitlements", "ios/App/LumenShare/LumenShare.entitlements"]) {
      expect(readFileSync(join(ROOT, f), "utf8")).toMatch(/<key>com\.apple\.security\.application-groups<\/key>\s*<array>\s*<string>group\.com\.lumen\.editor<\/string>/);
    }
    // The group the app reads (AppDelegate's shared defaults) is the one granted.
    expect(readFileSync(join(ROOT, "ios/App/App/AppDelegate.swift"), "utf8")).toContain('suiteName: "group.com.lumen.editor"');
  });

  it("the Hebrew and English strings are in both targets' resources, and Hebrew is a known region", () => {
    const res = (name: string) => ((phase(target(name)[1], "PBXResourcesBuildPhase").files as string[]) ?? []).map((bf) => obj(obj(bf).fileRef as string)).filter((o) => o.isa === "PBXVariantGroup");
    const langs = (g: Record<string, V>) => (g.children as string[]).map((c) => obj(c).name).sort();
    expect(res("App").map((g) => [g.name, langs(g)]).filter(([n]) => n !== "Main.storyboard" && n !== "LaunchScreen.storyboard")).toEqual([
      ["Localizable.strings", ["en", "he"]],
      ["AppShortcuts.strings", ["en", "he"]],
    ]);
    expect(res("LumenWidgets").map((g) => [g.name, langs(g)])).toEqual([["Localizable.strings", ["en", "he"]]]);
    expect(res("LumenShare").map((g) => [g.name, langs(g)])).toEqual([["Localizable.strings", ["en", "he"]]]);
    expect(obj(project.rootObject as string).knownRegions).toContain("he");
  });

  it("W11.P8: Control Center and Lock Screen capture open the native sheet, not the WebView", () => {
    const controls = readFileSync(join(ROOT, "ios/App/LumenWidgets/LumenControls.swift"), "utf8");
    expect(controls).toMatch(/@available\(iOS 18\.0, \*\)\s*struct LumenCaptureControl: ControlWidget/);
    expect(controls).toContain("ControlWidgetButton(action: OpenCaptureSheetIntent())");
    expect(controls).toContain('OpenURLIntent(CaptureLink.url("control"))');
    expect(controls).toMatch(/supportedFamilies\(\[\.accessoryCircular, \.accessoryRectangular, \.accessoryInline\]\)/);
    expect(controls).toContain('widgetURL(CaptureLink.url("lockscreen"))');
    expect(controls).toContain('"lumen://capture?native=1&source=\\(source)"');
    const bundle = readFileSync(join(ROOT, "ios/App/LumenWidgets/LumenWidgets.swift"), "utf8");
    expect(bundle).toMatch(/@main\s*struct LumenWidgetBundle: WidgetBundle[\s\S]*LumenWidget\(\)[\s\S]*LumenLockScreenCapture\(\)[\s\S]*LumenCaptureControl\(\)/);
    expect(bundle.match(/@main/g)).toHaveLength(1);
    // The app answers that link with the native sheet before the WebView sees any link.
    const delegate = readFileSync(join(ROOT, "ios/App/App/AppDelegate.swift"), "utf8");
    expect(delegate.indexOf("NativeCapture.handles(url)")).toBeGreaterThan(0);
    expect(delegate.indexOf("NativeCapture.handles(url)")).toBeLessThan(delegate.indexOf("LumenLaunch.deliver(url)"));
    const sheet = readFileSync(join(ROOT, "ios/App/App/NativeCapture.swift"), "utf8");
    expect(sheet).toContain("CaptureQueue.addText(text.text, source: source)");
    expect(sheet).toContain("textAlignment = .natural");
    // "Add to inbox" still runs without opening the app, now into the App Group queue.
    const intents = readFileSync(join(ROOT, "ios/App/App/LumenIntents.swift"), "utf8");
    expect(intents).toMatch(/struct AddToInboxIntent[\s\S]*?openAppWhenRun = false[\s\S]*?CaptureQueue\.addText\(text, source: "siri"\)/);
  });
});
