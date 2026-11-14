/**
 * Plan W10.C31 (audit W1.13, W3.4): voice capture from Android's Quick
 * Settings and iOS Shortcuts. The native code builds only on the Mac
 * (Android SDK, Xcode); here the sources, the manifest and the strings are
 * checked, and the link both hand the app is run through the real parser.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseNativeUrl } from "../mobile/nativeActions";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("Android: the Quick Settings tile", () => {
  it("is a TileService that opens the app with the voice capture link", () => {
    const src = read("android/app/src/main/java/com/lumen/editor/VoiceTileService.java");
    expect(src).toMatch(/public class VoiceTileService extends TileService/);
    expect(src).toContain("LumenActions.stamped(LumenActions.VOICE");
    expect(src).toContain("startActivityAndCollapse(PendingIntent.getActivity(");
    expect(src).toMatch(/PendingIntent\.FLAG_IMMUTABLE/);
    expect(src).toContain("MainActivity.class");
  });

  it("is declared with the tile permission and action, an icon and a label in English and Hebrew", () => {
    const m = read("android/app/src/main/AndroidManifest.xml");
    const service = /<service\s+android:name="\.VoiceTileService"[\s\S]*?<\/service>/.exec(m)?.[0] ?? "";
    expect(service).toContain('android:permission="android.permission.BIND_QUICK_SETTINGS_TILE"');
    expect(service).toContain('<action android:name="android.service.quicksettings.action.QS_TILE" />');
    expect(service).toContain('android:exported="true"');
    expect(service).toContain('android:icon="@drawable/ic_tile_voice"');
    expect(read("android/app/src/main/res/drawable/ic_tile_voice.xml")).toContain("<vector");
    for (const f of ["values", "values-iw"]) {
      const s = read(`android/app/src/main/res/${f}/strings.xml`);
      expect(s, f).toMatch(/<string name="tile_voice">[^<]+<\/string>/);
      expect(s, f).toMatch(/<string name="tile_voice_subtitle">[^<]+<\/string>/);
    }
  });
});

describe("iOS: Record to inbox", () => {
  it("is an App Intent with a Siri phrase that names the app, in English and Hebrew", () => {
    const intents = read("ios/App/App/LumenIntents.swift");
    expect(intents).toMatch(/struct RecordToInboxIntent: AppIntent[\s\S]*?openAppWhenRun = true[\s\S]*?LumenLaunch\.deliver\(URL\(string: "lumen:\/\/capture\?mode=voice"\)!\)/);
    expect(intents).toMatch(/AppShortcut\(intent: RecordToInboxIntent\(\), phrases: \["Record to \\\(\.applicationName\) inbox"/);
    expect(read("ios/App/App/he.lproj/AppShortcuts.strings")).toContain('"Record to ${applicationName} inbox" = "הקלטה לתיבה של ${applicationName}";');
    expect(read("ios/App/App/he.lproj/Localizable.strings")).toContain('"Record to Lumen inbox" = ');
  });
});

describe("the link both hand the app", () => {
  it("opens the capture box recording a voice note (the native twin of /?capture=voice)", () => {
    // The tile stamps the tap time (LumenActions.stamped): the app logs tap → recording.
    expect(parseNativeUrl("lumen://capture?mode=voice&t=1763200000000")).toEqual({ action: { kind: "capture", mode: "voice", text: null }, tappedAt: 1763200000000 });
    expect(parseNativeUrl("lumen://capture?mode=voice")).toMatchObject({ action: { kind: "capture", mode: "voice" } });
  });
});
