/**
 * The downloads page's data (plan W1.24, W10.E61). One manifest per release,
 * built from what `release.mjs build` put in release/: every file with its
 * platform, size, SHA-256 (from SHA256SUMS, never recomputed apart from it)
 * and the signatures that cover it. docs/src/pages/download.astro renders it.
 *
 *   node scripts/release.mjs downloads [--dir release] [--out docs/src/data/downloads.json]
 *
 * Pure: the caller reads the files.
 */
import { parseSums } from "./packaging.mjs";

export const DOWNLOADS_FORMAT = "lumen-downloads/1";

/** The platform and kind of a release file, by its name; null for files that are not downloads (sums, signatures, manifests). */
export function classify(name) {
  const n = name.toLowerCase();
  const arch = /aarch64|arm64/.test(n) ? "arm64" : /universal/.test(n) ? "universal" : /i686|x86(?!_64)/.test(n) ? "x86" : "x64";
  if (n.endsWith(".sig") || n.endsWith(".asc") || n === "sha256sums" || n.endsWith(".json")) return null;
  if (n.endsWith(".dmg")) return { platform: "macos", kind: "dmg", arch };
  if (n.endsWith(".app.tar.gz")) return { platform: "macos", kind: "app.tar.gz", arch, update: true };
  if (n.endsWith(".msi")) return { platform: "windows", kind: "msi", arch };
  if (n.endsWith("-setup.exe") || n.endsWith(".exe")) return { platform: "windows", kind: "exe", arch };
  if (n.endsWith(".appimage")) return { platform: "linux", kind: "AppImage", arch };
  if (n.endsWith(".deb")) return { platform: "linux", kind: "deb", arch };
  if (n.endsWith(".rpm")) return { platform: "linux", kind: "rpm", arch };
  if (n.endsWith("-debug.apk")) return null; // emulator / Test Lab build (mobile-build.mjs), not a download
  if (n.endsWith(".apk")) return { platform: "android", kind: "apk", arch: "universal" };
  if (n.endsWith(".aab")) return { platform: "android", kind: "aab", arch: "universal", store: true };
  if (n.endsWith(".ipa")) return { platform: "ios", kind: "ipa", arch: "arm64" };
  if (/^lumen-web-.*\.tgz$/.test(n)) return { platform: "web", kind: "tgz", arch: "any" };
  return null;
}

export const PLATFORM_ORDER = ["macos", "windows", "linux", "android", "ios", "web"];

/**
 * The manifest. `files`: [{ name, size }] of release/. `sums`: SHA256SUMS text.
 * Every download must be in SHA256SUMS (a file the sums do not cover is an error, not a row without a hash).
 */
export function downloadsManifest({ version, tag, repo, files, sums, gpgSigned, date = new Date() }) {
  const hashes = parseSums(sums);
  const names = new Set(files.map((f) => f.name));
  const base = repo ? `https://github.com/${repo}/releases/download/${tag}/` : null;
  const rows = [];
  const missing = [];
  for (const f of files) {
    const c = classify(f.name);
    if (!c) continue;
    const sha256 = hashes.get(f.name);
    if (!sha256) {
      missing.push(f.name);
      continue;
    }
    rows.push({
      name: f.name,
      ...c,
      size: f.size,
      sha256,
      url: base ? base + encodeURIComponent(f.name) : null,
      // The tauri updater's minisign signature of this bundle (W1.24: signed updates per channel).
      updaterSig: names.has(`${f.name}.sig`) ? `${f.name}.sig` : null,
    });
  }
  if (missing.length) throw new Error(`downloads: not in SHA256SUMS: ${missing.join(", ")}`);
  rows.sort((a, b) => PLATFORM_ORDER.indexOf(a.platform) - PLATFORM_ORDER.indexOf(b.platform) || (a.name < b.name ? -1 : 1));
  return {
    format: DOWNLOADS_FORMAT,
    version,
    tag,
    date: date.toISOString().slice(0, 10),
    channel: /-beta\./.test(version) ? "beta" : "stable",
    sums: { file: "SHA256SUMS", url: base ? base + "SHA256SUMS" : null, signature: gpgSigned ? { file: "SHA256SUMS.asc", url: base ? base + "SHA256SUMS.asc" : null } : null },
    files: rows,
  };
}

/** The manifest of no release yet (the committed placeholder). */
export const EMPTY_DOWNLOADS = { format: DOWNLOADS_FORMAT, version: null, tag: null, date: null, channel: "stable", sums: null, files: [] };

/** Human size: 12.3 MB. */
export function humanSize(bytes) {
  if (!Number.isFinite(bytes)) return "";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let x = bytes;
  while (x >= 1000 && i < u.length - 1) {
    x /= 1000;
    i++;
  }
  return `${i === 0 ? x : x.toFixed(1)} ${u[i]}`;
}

/** Rows grouped by platform, in PLATFORM_ORDER: what the page lists. */
export function byPlatform(manifest) {
  const out = [];
  for (const p of PLATFORM_ORDER) {
    const rows = (manifest?.files ?? []).filter((f) => f.platform === p);
    if (rows.length) out.push({ platform: p, rows });
  }
  return out;
}
