// @vitest-environment node
/**
 * W10.E61 (plan W1.24): one downloads page with checksums and signatures,
 * built from the release's own SHA256SUMS. The release directory here is
 * SYNTHETIC (small stand-in files named like real bundles); the manifest code
 * and the `release.mjs downloads` command are the real ones.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
// @ts-expect-error — plain .mjs module without type declarations
import { EMPTY_DOWNLOADS, byPlatform, classify, downloadsManifest, humanSize } from "../../scripts/lib/downloads.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import { sha256sums } from "../../scripts/lib/release.mjs";

const ROOT = resolve(__dirname, "..", "..");
const FILES = {
  "Lumen_0.3.0_aarch64.dmg": "dmg-arm",
  "Lumen_0.3.0_x64.dmg": "dmg-x64",
  "Lumen_0.3.0_aarch64.app.tar.gz": "upd",
  "Lumen_0.3.0_aarch64.app.tar.gz.sig": "minisign",
  "Lumen_0.3.0_x64_en-US.msi": "msi",
  "Lumen_0.3.0_x64-setup.exe": "nsis",
  "Lumen_0.3.0_amd64.AppImage": "appimage",
  "Lumen_0.3.0_amd64.deb": "deb",
  "lumen-0.3.0.aab": "aab",
  "lumen-0.3.0.apk": "apk",
  "lumen-0.3.0-debug.apk": "debug",
  "lumen-0.3.0.ipa": "ipa",
  "lumen-web-v0.3.0.tgz": "web",
  "latest.json": "{}",
};
const files = Object.entries(FILES).map(([name, text]) => ({ name, size: Buffer.byteLength(text), data: Buffer.from(text) }));
const sums = sha256sums(files.map(({ name, data }) => ({ name, data })));

describe("downloads manifest (W10.E61)", () => {
  it("classifies release files; signatures, sums, manifests and the debug APK are not downloads", () => {
    expect(classify("Lumen_0.3.0_aarch64.dmg")).toMatchObject({ platform: "macos", arch: "arm64" });
    expect(classify("Lumen_0.3.0_x64-setup.exe")).toMatchObject({ platform: "windows", kind: "exe" });
    expect(classify("Lumen_0.3.0_amd64.AppImage")).toMatchObject({ platform: "linux", kind: "AppImage" });
    expect(classify("lumen-0.3.0.aab")).toMatchObject({ platform: "android", store: true });
    expect(classify("lumen-0.3.0.ipa")).toMatchObject({ platform: "ios" });
    expect(classify("lumen-web-v0.3.0.tgz")).toMatchObject({ platform: "web" });
    for (const n of ["SHA256SUMS", "SHA256SUMS.asc", "x.dmg.sig", "latest.json", "downloads.json", "lumen-0.3.0-debug.apk", "notes.txt"]) expect(classify(n), n).toBeNull();
  });

  it("every row's SHA-256 comes from SHA256SUMS; rows are grouped by platform; the updater signature is named", () => {
    const m = downloadsManifest({ version: "0.3.0", tag: "v0.3.0", repo: "o/r", files, sums, gpgSigned: true, date: new Date("2026-11-15T00:00:00Z") });
    expect(m).toMatchObject({ format: "lumen-downloads/1", version: "0.3.0", tag: "v0.3.0", date: "2026-11-15", channel: "stable" });
    expect(m.sums).toEqual({ file: "SHA256SUMS", url: "https://github.com/o/r/releases/download/v0.3.0/SHA256SUMS", signature: { file: "SHA256SUMS.asc", url: "https://github.com/o/r/releases/download/v0.3.0/SHA256SUMS.asc" } });
    const fromSums = new Map(sums.trim().split("\n").map((l: string) => [l.slice(66), l.slice(0, 64)]));
    for (const r of m.files) expect(r.sha256, r.name).toBe(fromSums.get(r.name));
    expect(byPlatform(m).map((g: { platform: string }) => g.platform)).toEqual(["macos", "windows", "linux", "android", "ios", "web"]);
    expect(m.files.find((r: { name: string }) => r.name === "Lumen_0.3.0_aarch64.app.tar.gz").updaterSig).toBe("Lumen_0.3.0_aarch64.app.tar.gz.sig");
    expect(m.files.find((r: { name: string }) => r.name === "Lumen_0.3.0_x64.dmg").updaterSig).toBeNull();
    expect(m.files.map((r: { name: string }) => r.name)).not.toContain("lumen-0.3.0-debug.apk");
    expect(m.files[0].url).toMatch(/^https:\/\/github\.com\/o\/r\/releases\/download\/v0\.3\.0\//);
  });

  it("a download missing from SHA256SUMS is an error, not a row without a hash; a beta is the beta channel", () => {
    const short = sums.split("\n").filter((l: string) => !l.endsWith("lumen-0.3.0.ipa")).join("\n");
    expect(() => downloadsManifest({ version: "0.3.0", tag: "v0.3.0", repo: "o/r", files, sums: short, gpgSigned: false })).toThrow(/not in SHA256SUMS: lumen-0\.3\.0\.ipa/);
    expect(downloadsManifest({ version: "0.3.0-beta.2", tag: "v0.3.0-beta.2", repo: null, files, sums, gpgSigned: false })).toMatchObject({ channel: "beta", sums: { signature: null, url: null } });
  });

  it("`release.mjs downloads` writes the page's data from a release directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "lumen-dl-"));
    mkdirSync(join(dir, "rel"));
    for (const f of files) writeFileSync(join(dir, "rel", f.name), f.data);
    writeFileSync(join(dir, "rel", "SHA256SUMS"), sums);
    const out = join(dir, "downloads.json");
    const log = execFileSync("node", [join(ROOT, "scripts/release.mjs"), "downloads", "--dir", join(dir, "rel"), "--out", out, "--version", "0.3.0", "--repo", "o/r"], { cwd: ROOT, encoding: "utf8" });
    expect(log).toContain("11 downloads for v0.3.0 (SHA256SUMS not signed)");
    const m = JSON.parse(readFileSync(out, "utf8"));
    expect(m.files).toHaveLength(11);
    expect(m.sums.signature).toBeNull();
  });

  it("the committed page data is the empty manifest until a release writes it; both pages exist and render it", () => {
    expect(JSON.parse(readFileSync(join(ROOT, "docs/src/data/downloads.json"), "utf8"))).toEqual(EMPTY_DOWNLOADS);
    for (const p of ["docs/src/pages/download.astro", "docs/src/pages/he/download.astro"]) {
      expect(existsSync(join(ROOT, p)), p).toBe(true);
      expect(readFileSync(join(ROOT, p), "utf8")).toMatch(/<Downloads locale="(en|he)" \/>/);
    }
    const c = readFileSync(join(ROOT, "docs/src/components/Downloads.astro"), "utf8");
    expect(c).toContain('import manifest from "../data/downloads.json"');
    expect(c).toContain("sha256sum --check --ignore-missing SHA256SUMS");
    expect(c).toContain("gpg --verify SHA256SUMS.asc SHA256SUMS");
    expect(humanSize(12_345_678)).toBe("12.3 MB");
  });
});
