// @vitest-environment node
/**
 * Plan 13.3 — Android and iOS in the release, and the Safari eviction reminder.
 *
 * The APK, AAB and IPA are built on the release machine (scripts/mobile-build.mjs,
 * run by `release.mjs build --mobile`; its commands are mobileBuild.test.ts's).
 * Here: no GitHub workflow is left in the release path (W1.24, W10.E61), and
 * the native projects hold their signing contract.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { REMINDER_EVERY_MS, isWebKitBrowser, shouldRemind, type ReminderEnv } from "../storage/evictionReminder";
import { readLocale } from "../../scripts/lib/i18n-files.mjs";

const ROOT = resolve(__dirname, "..", "..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const WORKFLOWS = join(ROOT, ".github/workflows");

describe("mobile builds in the release, no GitHub Actions (13.3, W1.24, W10.E61)", () => {
  it("0 workflows in the release path: release, tauri, mobile and deploy are gone, none runs on a release tag or builds a release", () => {
    for (const f of ["release.yml", "tauri.yml", "mobile.yml", "deploy.yml"]) expect(existsSync(join(WORKFLOWS, f)), f).toBe(false);
    for (const f of existsSync(WORKFLOWS) ? readdirSync(WORKFLOWS) : []) {
      const text = read(`.github/workflows/${f}`);
      expect(text, f).not.toMatch(/release\.mjs (build|publish)|mobile-build\.mjs|tauri:build|gradlew|xcodebuild|flyctl deploy/);
      expect(text, f).not.toMatch(/tags:\s*\[\s*["']v\*["']\s*\]/);
    }
    // What deploy.yml did is a release subcommand now.
    expect(read("scripts/release.mjs")).toContain('run("flyctl", ["deploy", "--remote-only", "--app", app]);');
  });

  it("release.mjs build --mobile runs the local mobile build on the release's web build and puts AAB, APK and IPA in release/", () => {
    const rel = read("scripts/release.mjs");
    expect(rel).toContain('flag("--mobile")');
    expect(rel).toMatch(/"scripts\/mobile-build\.mjs", t, "--version", version, "--skip-web"/);
    expect(rel).toContain('"--no-upload"');
    expect(rel).toMatch(/\.\(aab\|apk\|ipa\)\$/);
    // the copy happens before SHA256SUMS is written, so the sums cover the mobile files
    expect(rel.indexOf('flag("--mobile")')).toBeLessThan(rel.indexOf('writeFileSync(path.join(OUT, "SHA256SUMS")'));
  });

  it("Android: the Gradle project signs only when the four ANDROID_* variables are set", () => {
    const gradle = read("android/app/build.gradle");
    expect(gradle).toContain('System.getenv("ANDROID_KEYSTORE_PATH")');
    for (const v of ["ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD"]) expect(gradle).toContain(`System.getenv("${v}")`);
    expect(gradle).toMatch(/if \(keystorePath\) \{\s*signingConfig signingConfigs\.release/);
    // No key material in the repo.
    expect(gradle).not.toMatch(/storePassword\s+"/);
    expect(existsSync(join(ROOT, "android/app/release.keystore"))).toBe(false);
    // Versions come from the release pipeline (13.4), with defaults.
    expect(gradle).toContain('project.hasProperty("versionCode")');
    expect(read("android/app/src/main/res/values/strings.xml")).toContain('<string name="app_name">Lumen</string>');
    expect(JSON.parse(read("capacitor.config.json")).appId).toBe("com.lumen.editor");
    expect(read("android/app/build.gradle")).toContain('applicationId "com.lumen.editor"');
  });

  it("iOS: the scheme xcodebuild is given exists and points at the App target; the export template names the app", () => {
    const scheme = read("ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme");
    const target = /([0-9A-F]{24}) \/\* App \*\/ = \{\s*isa = PBXNativeTarget;/.exec(read("ios/App/App.xcodeproj/project.pbxproj"))![1];
    expect(scheme).toContain(`BlueprintIdentifier = "${target}"`);
    expect(read("ios/exportOptions.plist")).toContain("<key>com.lumen.editor</key>");
  });

  it("the signing variables are documented in both languages, and the docs name no workflow", () => {
    for (const f of ["docs/src/content/docs/self-hosting/mobile.md", "docs/src/content/docs/he/self-hosting/mobile.md"]) {
      const doc = read(f);
      for (const v of ["ANDROID_KEYSTORE_PATH", "ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD", "release.mjs build --mobile"]) expect(doc, `${f}: ${v}`).toContain(v);
      expect(doc, f).not.toContain(".github/workflows/mobile.yml");
    }
  });
});

describe("Safari eviction reminder (13.3.3)", () => {
  const safari = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0 Mobile/15E148 Safari/604.1";
  const chrome = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
  const firefox = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4; rv:125.0) Gecko/20100101 Firefox/125.0";
  const base: ReminderEnv = { status: "denied", userAgent: safari, standalone: false, native: false, now: 1_000_000_000_000, shownAt: null };

  it("recognises Safari and every iOS browser, not Chrome or Firefox", () => {
    expect(isWebKitBrowser(safari)).toBe(true);
    expect(isWebKitBrowser(iphone)).toBe(true);
    expect(isWebKitBrowser(chrome)).toBe(false);
    expect(isWebKitBrowser(firefox)).toBe(false);
  });

  it("reminds when storage is not persisted in a WebKit browser that is neither installed nor native", () => {
    expect(shouldRemind(base)).toBe(true);
    expect(shouldRemind({ ...base, status: "unsupported" })).toBe(true);
    expect(shouldRemind({ ...base, status: "persisted" })).toBe(false);
    expect(shouldRemind({ ...base, standalone: true })).toBe(false);
    expect(shouldRemind({ ...base, native: true })).toBe(false);
    expect(shouldRemind({ ...base, userAgent: chrome })).toBe(false);
  });

  it("at most once a week", () => {
    expect(shouldRemind({ ...base, shownAt: base.now - REMINDER_EVERY_MS + 1 })).toBe(false);
    expect(shouldRemind({ ...base, shownAt: base.now - REMINDER_EVERY_MS })).toBe(true);
  });

  it("is loaded lazily after the persistence request, and its strings are in every locale", () => {
    const main = read("src/main.tsx");
    expect(main).toMatch(/requestPersistentStorage\(\)\.then\(\(status\) => \{\s*if \(status !== "persisted"\) void import\("\.\/storage\/evictionReminder"\)/);
    // English ships with the lazy chunk (src/i18n/lazy/eviction.json), not the startup bundle.
    const en = read("src/i18n/lazy/eviction.json");
    expect(read("src/i18n/index.ts")).not.toContain('"storage.eviction.');
    for (const lang of ["he", "ar", "ru", "fr", "de", "ja", "zh-CN"]) {
      // The per-domain layout (plan 0.3): every domain file of the language.
      const bundle = readLocale(lang) as Record<string, string>;
      for (const k of ["storage.eviction.title", "storage.eviction.body", "storage.eviction.export"]) {
        expect(en, `en ${k}`).toContain(`"${k}":`);
        expect(bundle[k], `${lang} ${k}`).toBeTruthy();
      }
    }
  });
});
