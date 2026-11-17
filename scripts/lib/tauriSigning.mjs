/**
 * Desktop release signing (plan 11.5), shared by scripts/tauri-signing.mjs
 * and its tests. Every secret is optional: without one, the matching step
 * is skipped and the build still succeeds (plan 15.7 supplies them).
 */

/** tauri.conf.json with the updater filled in from the environment, or left inert. */
export function withUpdater(conf, env) {
  const out = structuredClone(conf);
  const key = (env.LUMEN_UPDATER_PUBKEY ?? "").trim();
  const endpoint = (env.LUMEN_UPDATER_ENDPOINT ?? "").trim();
  const canSign = !!(env.TAURI_SIGNING_PRIVATE_KEY ?? "").trim();
  out.plugins ??= {};
  out.plugins.updater = { ...(out.plugins.updater ?? {}), pubkey: key, endpoints: key && endpoint ? [endpoint] : [], requireSignedVersion: true };
  out.bundle ??= {};
  // Update artifacts need the private key; without it, tauri build would fail.
  out.bundle.createUpdaterArtifacts = canSign && !!key;
  return { conf: out, updater: out.bundle.createUpdaterArtifacts };
}

/** tauri.conf.json with Windows signing by certificate thumbprint. */
export function withWindowsThumbprint(conf, thumbprint) {
  if (!/^[0-9A-Fa-f]{40}$/.test(thumbprint ?? "")) throw new Error("not a certificate thumbprint (40 hex characters)");
  const out = structuredClone(conf);
  out.bundle ??= {};
  out.bundle.windows = { ...(out.bundle.windows ?? {}), certificateThumbprint: thumbprint.toUpperCase(), digestAlgorithm: "sha256", timestampUrl: "http://timestamp.digicert.com" };
  return out;
}

/** The updater platform key for a bundle file name. */
/**
 * Every updater platform a signed bundle serves (W13.K4): a universal macOS
 * build serves Apple Silicon and Intel alike; an arch-specific bundle, one.
 * An arch-specific bundle wins over the universal one for its platform.
 */
export function platformsOf(file) {
  const f = file.toLowerCase();
  if (/universal/.test(f) && f.endsWith(".app.tar.gz.sig")) return ["darwin-aarch64", "darwin-x86_64"];
  const p = platformOf(file);
  return p ? [p] : [];
}

export function platformOf(file) {
  const f = file.toLowerCase();
  const arch = /aarch64|arm64/.test(f) ? "aarch64" : /i686|x86(?!_64)/.test(f) ? "i686" : "x86_64";
  if (f.endsWith(".app.tar.gz.sig")) return `darwin-${arch}`;
  if (f.endsWith(".appimage.sig") || f.endsWith(".appimage.tar.gz.sig")) return `linux-${arch}`;
  if (f.endsWith(".msi.sig") || f.endsWith(".exe.sig") || f.endsWith(".nsis.zip.sig") || f.endsWith(".msi.zip.sig")) return `windows-${arch}`;
  return null;
}

/** latest.json for the release, from its .sig files ({ name, signature }). */
/** How long a signed update manifest is good for (T6-I2): past it the app refuses it, so an old manifest replayed by the release host can't freeze updates for longer. */
export const MANIFEST_TTL_DAYS = 90;
/** Which feed a manifest is for: the beta-channel release, or a stable release's own latest.json. */
export const MANIFEST_CHANNELS = ["stable", "beta"];

/**
 * latest.json for a release. T6-I2: it also names its `channel` (a beta
 * version's own manifest is "beta", every other "stable"; the beta-channel
 * copy is stamped "beta" by release-run) and `expires` (ISO time), both under
 * latest.json.sig, and the app refuses a manifest for another channel or one
 * past its expiry (src-tauri/src/manifest_sig.rs).
 */
export function latestJson({ tag, repo, sigs, notes = "", date = new Date(), channel = null, now = new Date(), ttlDays = MANIFEST_TTL_DAYS }) {
  const platforms = {};
  const universal = new Set();
  for (const { name, signature } of sigs) {
    const isUniversal = /universal/i.test(name);
    for (const p of platformsOf(name)) {
      // NSIS (.exe) is preferred over MSI for updates, as tauri does.
      if (platforms[p] && p.startsWith("windows") && !name.toLowerCase().includes(".exe")) continue;
      // An arch-specific macOS bundle wins over the universal one (smaller download).
      if (platforms[p] && isUniversal && !universal.has(p)) continue;
      if (isUniversal) universal.add(p);
      else universal.delete(p);
      platforms[p] = { signature: signature.trim(), url: `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(name.replace(/\.sig$/, ""))}` };
    }
  }
  const version = tag.replace(/^v/, "");
  return stampManifest({ version, notes, pub_date: date.toISOString(), platforms }, { channel: channel ?? (/-beta\.\d+$/.test(version) ? "beta" : "stable"), now, ttlDays });
}

/** The manifest with its channel and a fresh expiry (T6-I2): for a feed that re-signs a manifest, such as the beta channel. */
export function stampManifest(latest, { channel, now = new Date(), ttlDays = MANIFEST_TTL_DAYS }) {
  if (!MANIFEST_CHANNELS.includes(channel)) throw new Error(`a manifest's channel is "stable" or "beta", not ${JSON.stringify(channel)}`);
  return { ...latest, channel, expires: new Date(now.getTime() + ttlDays * 86_400_000).toISOString() };
}
