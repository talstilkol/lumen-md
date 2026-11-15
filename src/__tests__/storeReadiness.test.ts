/**
 * Plan W11.P11: store readiness in the code. Google Play needs API 36 and
 * 16 KB pages; Apple needs a privacy manifest with the reason for each
 * required-reason API. The files are parsed and their values checked here;
 * the Archive in Xcode 26 and the submissions are W11.M10 and W11.O7.
 *
 * The ELF and zip files in the 16 KB tests are SYNTHETIC: built here, byte by
 * byte, in the ELF64 and zip formats, with the alignments under test.
 * @vitest-environment node
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { deflateRawSync } from "node:zlib";
import { parseOpenStep, type V } from "./helpers/openStep";
// @ts-expect-error — plain .mjs helpers without types
import { PAGE_16K, check16k, elfLoadAlignments, zipEntries } from "../../scripts/lib/align16k.mjs";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("Android: API 36 (Play's requirement from 31.8.2026)", () => {
  const vars = read("android/variables.gradle");
  const num = (k: string) => Number(new RegExp(`\\b${k}\\s*=\\s*(\\d+)`).exec(vars)?.[1]);

  it("compileSdk and targetSdk are 36, minSdk stays 24", () => {
    expect(num("compileSdkVersion")).toBe(36);
    expect(num("targetSdkVersion")).toBe(36);
    expect(num("minSdkVersion")).toBe(24);
    // The app module reads them from there, not from literals of its own.
    const app = read("android/app/build.gradle");
    expect(app).toMatch(/compileSdk\s*=?\s*rootProject\.ext\.compileSdkVersion/);
    expect(app).toMatch(/targetSdkVersion\s+rootProject\.ext\.targetSdkVersion/);
  });

  it("the Android Gradle Plugin is 8.5.1 or later, which 16 KB-aligns uncompressed native libraries", () => {
    const v = /com\.android\.tools\.build:gradle:(\d+)\.(\d+)\.(\d+)/.exec(read("android/build.gradle"))!.slice(1).map(Number);
    expect(v[0] * 10000 + v[1] * 100 + v[2]).toBeGreaterThanOrEqual(80501);
    // Nothing turns legacy (compressed, extracted) packaging back on for all libraries.
    expect(read("android/app/build.gradle")).not.toMatch(/useLegacyPackaging\s*=?\s*true/);
    expect(read("android/app/src/main/AndroidManifest.xml")).not.toContain('android:extractNativeLibs="true"');
  });
});

// ── 16 KB: synthetic ELF and zip files ──────────────────────────────

/** A minimal ELF64 little-endian shared object with PT_LOAD segments of these alignments. */
function elf64(aligns: number[], extra: { type: number; align: number }[] = []): Buffer {
  const ph = [...aligns.map((a) => ({ type: 1, align: a })), ...extra];
  const b = Buffer.alloc(64 + 56 * ph.length);
  b.writeUInt32BE(0x7f454c46, 0);
  b[4] = 2; // 64-bit
  b[5] = 1; // little-endian
  b[6] = 1;
  b.writeUInt16LE(3, 0x10); // ET_DYN
  b.writeUInt16LE(183, 0x12); // EM_AARCH64
  b.writeBigUInt64LE(64n, 0x20); // e_phoff
  b.writeUInt16LE(64, 0x34);
  b.writeUInt16LE(56, 0x36); // e_phentsize
  b.writeUInt16LE(ph.length, 0x38); // e_phnum
  ph.forEach((p, i) => {
    const h = 64 + i * 56;
    b.writeUInt32LE(p.type, h);
    b.writeBigUInt64LE(BigInt(p.align), h + 0x30);
  });
  return b;
}

/** A minimal ELF32 little-endian object (armeabi-v7a), one PT_LOAD. */
function elf32(align: number): Buffer {
  const b = Buffer.alloc(52 + 32);
  b.writeUInt32BE(0x7f454c46, 0);
  b[4] = 1;
  b[5] = 1;
  b.writeUInt32LE(52, 0x1c);
  b.writeUInt16LE(32, 0x2a);
  b.writeUInt16LE(1, 0x2c);
  b.writeUInt32LE(1, 52);
  b.writeUInt32LE(align, 52 + 0x1c);
  return b;
}

/** A zip with these entries; `pad` puts a stored entry's data at a multiple of it (as zipalign does, with the extra field). */
function zip(entries: { name: string; data: Buffer; deflate?: boolean; pad?: number }[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let off = 0;
  for (const e of entries) {
    const body = e.deflate ? deflateRawSync(e.data) : e.data;
    const name = Buffer.from(e.name);
    let extraLen = 0;
    if (e.pad) {
      const start = off + 30 + name.length;
      extraLen = (e.pad - (start % e.pad)) % e.pad;
      if (extraLen > 0 && extraLen < 4) extraLen += e.pad; // an extra field needs 4 bytes of header
    }
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(e.deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(extraLen, 28);
    const extra = Buffer.alloc(extraLen);
    if (extraLen) {
      extra.writeUInt16LE(0xd935, 0); // zipalign's alignment extra field id
      extra.writeUInt16LE(extraLen - 4, 2);
    }
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(e.deflate ? 8 : 0, 10);
    c.writeUInt32LE(body.length, 20);
    c.writeUInt32LE(e.data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(off, 42);
    central.push(c, name);
    parts.push(local, name, extra, body);
    off += 30 + name.length + extraLen + body.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, eocd]);
}

describe("16 KB pages (scripts/check-16kb.mjs)", () => {
  const dex = { name: "classes.dex", data: Buffer.from("dex\n035\0") };

  it("reads ELF64 and ELF32 LOAD alignments, ignoring other segments", () => {
    expect(elfLoadAlignments(elf64([0x4000, 0x10000], [{ type: 2, align: 8 }]))).toEqual([0x4000, 0x10000]);
    expect(elfLoadAlignments(elf32(0x1000))).toEqual([0x1000]);
    expect(() => elfLoadAlignments(Buffer.from("not an elf file at all, really, no.................."))).toThrow("not an ELF file");
  });

  it("an APK with 16 KB-aligned libraries, stored on 16 KB boundaries, passes", () => {
    const apk = zip([dex, { name: "lib/arm64-v8a/libgood.so", data: elf64([0x4000, 0x4000]), pad: PAGE_16K }, { name: "lib/x86_64/libgood.so", data: elf64([0x10000]), pad: PAGE_16K }]);
    expect(zipEntries(apk).find((e: { name: string }) => e.name === "lib/arm64-v8a/libgood.so").dataOffset % PAGE_16K).toBe(0);
    const { rows, problems } = check16k({ kind: "apk", data: apk });
    expect(problems).toEqual([]);
    expect(rows.map((r: { name: string; ok: boolean }) => [r.name, r.ok])).toEqual([
      ["lib/arm64-v8a/libgood.so", true],
      ["lib/x86_64/libgood.so", true],
    ]);
  });

  it("a library linked for 4 KB pages fails, with the fix named", () => {
    const { problems } = check16k({ kind: "apk", data: zip([{ name: "lib/arm64-v8a/libold.so", data: elf64([0x1000, 0x4000]), pad: PAGE_16K }]) });
    expect(problems).toEqual([expect.stringContaining("lib/arm64-v8a/libold.so: a LOAD segment is aligned to 4096 bytes (needs 16384): relink with -Wl,-z,max-page-size=16384")]);
  });

  it("a stored library off a 16 KB boundary fails in an APK; compressed, or in an AAB, only the ELF counts", () => {
    const off = zip([dex, { name: "lib/arm64-v8a/libx.so", data: elf64([0x4000]), pad: 4 }]);
    expect(zipEntries(off)[1].dataOffset % PAGE_16K).not.toBe(0);
    expect(check16k({ kind: "apk", data: off }).problems).toEqual([expect.stringMatching(/stored uncompressed at offset \d+, not a multiple of 16 KB: zipalign -P 16/)]);
    expect(check16k({ kind: "aab", data: off }).problems).toEqual([]);
    const deflated = zip([dex, { name: "lib/arm64-v8a/libx.so", data: elf64([0x4000]), deflate: true }]);
    expect(check16k({ kind: "apk", data: deflated }).problems).toEqual([]);
    expect(check16k({ kind: "aab", data: zip([{ name: "base/lib/arm64-v8a/liby.so", data: elf64([0x1000]), deflate: true }]) }).problems).toHaveLength(1);
  });

  it("32-bit libraries and non-ELF files named .so are checked too", () => {
    const { problems } = check16k({ kind: "files", files: [{ name: "armeabi-v7a/liba.so", data: elf32(0x1000) }, { name: "x/libfake.so", data: Buffer.from("#!/bin/sh\n".padEnd(64, " ")) }] });
    expect(problems).toEqual([expect.stringContaining("armeabi-v7a/liba.so: a LOAD segment is aligned to 4096"), "x/libfake.so: not an ELF file"]);
  });

  const dir = mkdtempSync(join(tmpdir(), "lumen-16k-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("the command: exit 0 on a good build, 1 on a bad one, 1 when there is no library unless --allow-none", () => {
    const run = (...a: string[]) => spawnSync(process.execPath, [join(ROOT, "scripts/check-16kb.mjs"), ...a], { encoding: "utf8", env: { ...process.env, PATH: "" } });
    const good = join(dir, "good.apk");
    writeFileSync(good, zip([dex, { name: "lib/arm64-v8a/libgood.so", data: elf64([0x4000]), pad: PAGE_16K }]));
    const bad = join(dir, "bad.apk");
    writeFileSync(bad, zip([{ name: "lib/arm64-v8a/libold.so", data: elf64([0x1000]), pad: PAGE_16K }]));
    const none = join(dir, "none.apk");
    writeFileSync(none, zip([dex]));
    const libs = join(dir, "libs", "arm64-v8a");
    mkdirSync(libs, { recursive: true });
    writeFileSync(join(libs, "liba.so"), elf64([0x4000]));
    const r1 = run(good);
    expect([r1.status, r1.stdout]).toEqual([0, expect.stringContaining("16 KB check: ok (1 libraries)")]);
    expect(r1.stdout).toContain("zipalign is not on PATH");
    expect(run(bad).status).toBe(1);
    expect(run(none).status).toBe(1);
    expect(run(none, "--allow-none").status).toBe(0);
    const r2 = run(join(dir, "libs"));
    expect([r2.status, r2.stdout]).toEqual([0, expect.stringContaining("ok   arm64-v8a/liba.so")]);
    expect(readdirSync(dir).sort()).toEqual(["bad.apk", "good.apk", "libs", "none.apk"]);
  });
});

// ── iOS: the privacy manifests ──────────────────────────────────────

type P = string | boolean | P[] | { [k: string]: P };
/** The XML plists Xcode writes: dict, array, string, true, false (comments skipped). */
function parsePlist(xml: string): P {
  const body = xml.replace(/<!--[\s\S]*?-->/g, "").replace(/<\?xml[^>]*\?>|<!DOCTYPE[^>]*>/g, "");
  const tokens = [...body.matchAll(/<(\/?)(\w+)(?:\s[^>]*?)?(\/?)>|([^<]+)/g)];
  let i = 0;
  const skip = () => {
    while (i < tokens.length && tokens[i][4] !== undefined && !tokens[i][4].trim()) i++;
  };
  const value = (): P => {
    skip();
    const [, close, tag, selfClose] = tokens[i++];
    if (close) throw new Error(`unexpected </${tag}>`);
    if (tag === "true" || tag === "false") return tag === "true";
    if (selfClose) return tag === "array" ? [] : tag === "dict" ? {} : "";
    if (tag === "plist") {
      const v = value();
      skip();
      i++;
      return v;
    }
    if (tag === "string" || tag === "key") {
      const text = tokens[i][4] !== undefined ? tokens[i++][4] : "";
      i++;
      return text;
    }
    if (tag === "array") {
      const a: P[] = [];
      for (;;) {
        skip();
        if (tokens[i][1] === "/") return i++, a;
        a.push(value());
      }
    }
    if (tag === "dict") {
      const d: Record<string, P> = {};
      for (;;) {
        skip();
        if (tokens[i][1] === "/") return i++, d;
        const k = value() as string;
        d[k] = value();
      }
    }
    throw new Error(`unknown tag ${tag}`);
  };
  return value();
}

describe("iOS privacy manifests (Apple's required-reason APIs)", () => {
  const labels = JSON.parse(read("store/privacy-labels.json"));
  const manifest = (p: string) => parsePlist(read(p)) as Record<string, P>;
  const reasons = (m: Record<string, P>) => Object.fromEntries((m.NSPrivacyAccessedAPITypes as Record<string, P>[]).map((t) => [t.NSPrivacyAccessedAPIType, (t.NSPrivacyAccessedAPITypeReasons as string[]).slice().sort()]));
  // What each category's APIs look like in Swift (Apple's list, the parts this code could use).
  const CATEGORIES: Record<string, RegExp> = {
    NSPrivacyAccessedAPICategoryUserDefaults: /\bUserDefaults\b/,
    NSPrivacyAccessedAPICategoryFileTimestamp: /\b(modificationDate|creationDate|contentModificationDateKey|creationDateKey|fileSizeKey|attributesOfItem|getattrlist|fstat|lstat)\b/,
    NSPrivacyAccessedAPICategorySystemBootTime: /\b(systemUptime|mach_absolute_time)\b/,
    NSPrivacyAccessedAPICategoryDiskSpace: /\b(volumeAvailableCapacity\w*|systemFreeSize|systemSize|statfs|fstatfs)\b/,
    NSPrivacyAccessedAPICategoryActiveKeyboards: /\bactiveInputModes\b/,
  };
  // The Swift each target compiles, from project.pbxproj.
  const project = parseOpenStep(read("ios/App/App.xcodeproj/project.pbxproj")) as Record<string, V>;
  const objects = project.objects as Record<string, Record<string, V>>;
  const parents = new Map<string, string>();
  for (const [id, o] of Object.entries(objects)) for (const c of (o.children as string[] | undefined) ?? []) parents.set(c, id);
  const pathOf = (id: string) => {
    const parts: string[] = [];
    for (let x: string | undefined = id; x; x = parents.get(x)) if (typeof objects[x].path === "string") parts.unshift(objects[x].path as string);
    return "ios/App/" + parts.join("/");
  };
  const target = (name: string) => Object.values(objects).find((o) => o.isa === "PBXNativeTarget" && o.name === name)!;
  const phaseFiles = (name: string, isa: string) =>
    (((target(name).buildPhases as string[]).map((p) => objects[p]).find((p) => p.isa === isa)!.files as string[]) ?? []).map((bf) => pathOf(objects[bf].fileRef as string));

  for (const [name, file] of [
    ["App", "ios/App/App/PrivacyInfo.xcprivacy"],
    ["LumenShare", "ios/App/LumenShare/PrivacyInfo.xcprivacy"],
  ] as const) {
    it(`${name}: no tracking, nothing collected (as the store answers say), and a reason for exactly the APIs its Swift uses`, () => {
      const m = manifest(file);
      expect(m.NSPrivacyTracking).toBe(false);
      expect(m.NSPrivacyTrackingDomains).toEqual([]);
      // The store build is made without a crash-reporting key: the App Store answer is "no data collected".
      expect(labels.apple.dataNotCollected).toBe(true);
      expect(labels.apple.tracking).toBe(false);
      expect(m.NSPrivacyCollectedDataTypes).toEqual([]);
      // In the target's resources, so it ships in that bundle.
      expect(phaseFiles(name, "PBXResourcesBuildPhase")).toContain(file);
      const swift = phaseFiles(name, "PBXSourcesBuildPhase").map(read).join("\n");
      const used = Object.entries(CATEGORIES).filter(([, re]) => re.test(swift)).map(([c]) => c).sort();
      expect(Object.keys(reasons(m)).sort()).toEqual(used);
    });
  }

  it("the reasons are the ones Apple defines for what the code does", () => {
    expect(reasons(manifest("ios/App/App/PrivacyInfo.xcprivacy"))).toEqual({
      // CA92.1: the app's own values; 1C8F.1: the App Group it shares with its extensions.
      NSPrivacyAccessedAPICategoryUserDefaults: ["1C8F.1", "CA92.1"],
      // C617.1: files in the app's, its App Group's or its iCloud container.
      NSPrivacyAccessedAPICategoryFileTimestamp: ["C617.1"],
    });
    // The share extension compiles CaptureQueue.swift, whose one-time move reads the old UserDefaults queue.
    expect(reasons(manifest("ios/App/LumenShare/PrivacyInfo.xcprivacy"))).toEqual({ NSPrivacyAccessedAPICategoryUserDefaults: ["CA92.1"], NSPrivacyAccessedAPICategoryFileTimestamp: ["C617.1"] });
    // The App Group that 1C8F.1 is about is the one the app really uses.
    expect(read("ios/App/App/AppDelegate.swift")).toContain('UserDefaults(suiteName: "group.com.lumen.editor")');
  });

  it("parses what Xcode writes (a self-check of the parser)", () => {
    expect(parsePlist('<?xml version="1.0"?><plist version="1.0"><dict><key>a</key><array><string>x</string><true/></array><key>b</key><array/></dict></plist>')).toEqual({ a: ["x", true], b: [] });
  });
});
