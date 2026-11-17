/**
 * W13.K4: desktop builds for every CPU — universal macOS, Windows and Linux
 * x64 + ARM64 — named so they never overwrite each other, served by the
 * updater to both Mac CPUs, and checked by the binary's own header.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs helpers without types
import { archMatches, binaryArchs, missingRustTargets, releaseName, targetsFor } from "../../scripts/lib/desktopTargets.mjs";
// @ts-expect-error — plain .mjs helpers without types
import { latestJson, platformsOf } from "../../scripts/lib/tauriSigning.mjs";
// @ts-expect-error — plain .mjs helpers without types
import { classify } from "../../scripts/lib/downloads.mjs";
import { readFileSync } from "node:fs";

describe("which targets a release machine builds", () => {
  it("a Mac: the universal app; Windows: x64 and ARM64; Linux: its own CPU", () => {
    expect(targetsFor("darwin", "arm64")).toEqual(["universal-apple-darwin"]);
    expect(targetsFor("win32", "x64")).toEqual(["x86_64-pc-windows-msvc", "aarch64-pc-windows-msvc"]);
    expect(targetsFor("linux", "x64")).toEqual(["x86_64-unknown-linux-gnu"]);
    expect(targetsFor("linux", "arm64")).toEqual(["aarch64-unknown-linux-gnu"]);
    expect(targetsFor("linux", "x64", "x86_64-unknown-linux-gnu,aarch64-unknown-linux-gnu")).toHaveLength(2);
    expect(() => targetsFor("linux", "x64", "riscv64gc-unknown-linux-gnu")).toThrow(/unknown desktop target/);
  });

  it("the universal app needs both Mac Rust targets; only the missing ones are added", () => {
    expect(missingRustTargets("x86_64-apple-darwin\n", ["universal-apple-darwin"])).toEqual(["aarch64-apple-darwin"]);
    expect(missingRustTargets("aarch64-apple-darwin\nx86_64-apple-darwin\n", ["universal-apple-darwin"])).toEqual([]);
    expect(missingRustTargets("", ["x86_64-pc-windows-msvc", "aarch64-pc-windows-msvc"])).toEqual(["x86_64-pc-windows-msvc", "aarch64-pc-windows-msvc"]);
  });

  it("release.mjs builds each target and copies its bundles under names that do not collide", () => {
    const rel = readFileSync("scripts/release.mjs", "utf8");
    expect(rel).toMatch(/for \(const target of targets\)/);
    expect(rel).toMatch(/"--target", target/);
    expect(releaseName("Lumen.app.tar.gz", "universal-apple-darwin", "0.3.0")).toBe("Lumen_0.3.0_universal.app.tar.gz");
    expect(releaseName("Lumen.app.tar.gz.sig", "aarch64-apple-darwin", "0.3.0")).toBe("Lumen_0.3.0_aarch64.app.tar.gz.sig");
    expect(releaseName("Lumen_0.3.0_arm64-setup.exe", "aarch64-pc-windows-msvc", "0.3.0")).toBe("Lumen_0.3.0_arm64-setup.exe");
    expect(releaseName("Lumen_0.3.0_universal.dmg", "universal-apple-darwin", "0.3.0")).toBe("Lumen_0.3.0_universal.dmg");
  });
});

describe("the downloads page and the updater", () => {
  it("the downloads page tells ARM64, x64 and universal apart", () => {
    expect(classify("Lumen_0.3.0_universal.dmg")).toMatchObject({ platform: "macos", arch: "universal" });
    expect(classify("Lumen_0.3.0_arm64-setup.exe")).toMatchObject({ platform: "windows", arch: "arm64" });
    expect(classify("Lumen_0.3.0_arm64_en-US.msi")).toMatchObject({ platform: "windows", arch: "arm64" });
    expect(classify("lumen_0.3.0_arm64.deb")).toMatchObject({ platform: "linux", arch: "arm64" });
    expect(classify("lumen_0.3.0_aarch64.AppImage")).toMatchObject({ platform: "linux", arch: "arm64" });
  });

  it("a universal update bundle serves both Mac CPUs; an arch-specific one wins for its own", () => {
    expect(platformsOf("Lumen_0.3.0_universal.app.tar.gz.sig")).toEqual(["darwin-aarch64", "darwin-x86_64"]);
    const uni = latestJson({ tag: "v0.3.0", repo: "o/r", sigs: [{ name: "Lumen_0.3.0_universal.app.tar.gz.sig", signature: "u" }, { name: "Lumen_0.3.0_arm64-setup.exe.sig", signature: "w" }, { name: "Lumen_0.3.0_x64-setup.exe.sig", signature: "x" }] });
    expect(Object.keys(uni.platforms).sort()).toEqual(["darwin-aarch64", "darwin-x86_64", "windows-aarch64", "windows-x86_64"]);
    expect(uni.platforms["darwin-x86_64"].url).toMatch(/universal\.app\.tar\.gz$/);
    for (const order of [
      [{ name: "Lumen_0.3.0_universal.app.tar.gz.sig", signature: "u" }, { name: "Lumen_0.3.0_aarch64.app.tar.gz.sig", signature: "a" }],
      [{ name: "Lumen_0.3.0_aarch64.app.tar.gz.sig", signature: "a" }, { name: "Lumen_0.3.0_universal.app.tar.gz.sig", signature: "u" }],
    ]) {
      const j = latestJson({ tag: "v0.3.0", repo: "o/r", sigs: order });
      expect(j.platforms["darwin-aarch64"].signature).toBe("a");
      expect(j.platforms["darwin-x86_64"].signature).toBe("u");
    }
  });
});

/** Minimal binary headers, as the linkers write them. */
const fat = (cpus: number[]) => {
  const b = Buffer.alloc(8 + cpus.length * 20);
  b.writeUInt32BE(0xcafebabe, 0);
  b.writeUInt32BE(cpus.length, 4);
  cpus.forEach((c, i) => b.writeUInt32BE(c, 8 + i * 20));
  return b;
};
const thin = (cpu: number) => {
  const b = Buffer.alloc(32);
  b.writeUInt32LE(0xfeedfacf, 0);
  b.writeUInt32LE(cpu, 4);
  return b;
};
const pe = (machine: number) => {
  const b = Buffer.alloc(0x100);
  b.write("MZ", 0, "latin1");
  b.writeUInt32LE(0x80, 0x3c);
  b.writeUInt32LE(0x00004550, 0x80);
  b.writeUInt16LE(machine, 0x84);
  return b;
};
const elf = (machine: number) => {
  const b = Buffer.alloc(64);
  b.set([0x7f, 0x45, 0x4c, 0x46, 2, 1], 0);
  b.writeUInt16LE(machine, 18);
  return b;
};

describe("the binary is what its name says (the install check)", () => {
  it("reads Mach-O (fat and thin), PE and ELF", () => {
    expect(binaryArchs(fat([0x0100000c, 0x01000007]))).toEqual(["arm64", "x64"]);
    expect(binaryArchs(thin(0x0100000c))).toEqual(["arm64"]);
    expect(binaryArchs(pe(0xaa64))).toEqual(["arm64"]);
    expect(binaryArchs(pe(0x8664))).toEqual(["x64"]);
    expect(binaryArchs(elf(0xb7))).toEqual(["arm64"]);
    expect(binaryArchs(elf(0x3e))).toEqual(["x64"]);
    expect(binaryArchs(Buffer.from("not a binary"))).toEqual([]);
    // A Java class file starts with CAFEBABE too, then its version (a big number), not a CPU count.
    const cls = Buffer.alloc(16);
    cls.writeUInt32BE(0xcafebabe, 0);
    cls.writeUInt32BE(0x00000041, 4);
    expect(binaryArchs(cls)).toEqual([]);
  });

  it("a universal name needs both CPUs; an ARM64 name refuses an x64 binary", () => {
    expect(archMatches("Lumen_0.3.0_universal.dmg", ["arm64", "x64"])).toBe(true);
    expect(archMatches("Lumen_0.3.0_universal.dmg", ["arm64"])).toBe(false);
    expect(archMatches("Lumen_0.3.0_arm64_en-US.msi", ["x64"])).toBe(false);
    expect(archMatches("Lumen_0.3.0_arm64_en-US.msi", ["arm64"])).toBe(true);
    expect(archMatches("lumen_0.3.0_amd64.deb", ["x64"])).toBe(true);
  });
});
