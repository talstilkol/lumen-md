/**
 * Desktop builds for every CPU (plan W13.K4): a universal macOS app, Windows
 * and Linux for x64 and ARM64. Pure helpers; scripts/release.mjs and
 * scripts/desktop-install-check.mjs do the running.
 *
 * - Which Rust targets a release machine builds by default: a Mac builds
 *   the universal app (Apple Silicon and Intel in one bundle); Windows
 *   builds x64 and ARM64 (the MSVC toolchain cross-compiles to ARM64); Linux
 *   builds for its own CPU (ARM64 from x64 needs a cross toolchain: name it
 *   with --targets).
 * - Where each target's bundles land, and the name they get in release/:
 *   the updater bundle (`Lumen.app.tar.gz`) carries no CPU in its name, so
 *   it gets one, or a second target's would overwrite the first.
 * - What CPU a built binary is for, read from its header (Mach-O, fat
 *   Mach-O, PE, ELF), so the install check proves the bundle is what its
 *   name says — not an x64 build under an arm64 name.
 */

export const DEFAULT_TARGETS = {
  darwin: ["universal-apple-darwin"],
  win32: ["x86_64-pc-windows-msvc", "aarch64-pc-windows-msvc"],
  linux: { x64: ["x86_64-unknown-linux-gnu"], arm64: ["aarch64-unknown-linux-gnu"] },
};

export const KNOWN_TARGETS = [
  "universal-apple-darwin",
  "aarch64-apple-darwin",
  "x86_64-apple-darwin",
  "x86_64-pc-windows-msvc",
  "aarch64-pc-windows-msvc",
  "x86_64-unknown-linux-gnu",
  "aarch64-unknown-linux-gnu",
];

/** The targets to build: `--targets a,b` (checked), else this machine's defaults. */
export function targetsFor(platform, arch, flag) {
  if (flag) {
    const list = String(flag).split(",").map((s) => s.trim()).filter(Boolean);
    for (const t of list) if (!KNOWN_TARGETS.includes(t)) throw new Error(`unknown desktop target '${t}' (known: ${KNOWN_TARGETS.join(", ")})`);
    return list;
  }
  if (platform === "darwin") return DEFAULT_TARGETS.darwin;
  if (platform === "win32") return DEFAULT_TARGETS.win32;
  return DEFAULT_TARGETS.linux[arch === "arm64" ? "arm64" : "x64"];
}

/** The rustup targets a Tauri target needs (universal: both Mac CPUs). */
export function rustTargetsOf(target) {
  return target === "universal-apple-darwin" ? ["aarch64-apple-darwin", "x86_64-apple-darwin"] : [target];
}

/** The rustup targets still to add (`rustup target list --installed` → `installed`). */
export function missingRustTargets(installed, targets) {
  const have = new Set(String(installed).split(/\s+/).filter(Boolean));
  return [...new Set(targets.flatMap(rustTargetsOf))].filter((t) => !have.has(t));
}

/** The CPU tag of a target, as release file names write it. */
export function archTag(target) {
  if (target.startsWith("universal")) return "universal";
  if (target.startsWith("aarch64")) return "aarch64";
  return "x64";
}

/** The folder tauri writes a target's bundles to (relative to src-tauri/target). */
export const bundleDir = (target) => `${target}/release/bundle`;

/** The name a bundle gets in release/: the updater bundle gains its CPU, the others keep theirs. */
export function releaseName(file, target, version) {
  const m = /^(.*?)(\.app\.tar\.gz(?:\.sig)?)$/i.exec(file);
  if (m && !/aarch64|arm64|x64|x86_64|universal/i.test(m[1])) return `${m[1]}_${version}_${archTag(target)}${m[2]}`;
  return file;
}

/** What CPU a release file name says it is for: "arm64", "x64", "universal". */
export function archOfName(name) {
  const n = name.toLowerCase();
  return /universal/.test(n) ? "universal" : /aarch64|arm64/.test(n) ? "arm64" : "x64";
}

const MACHO = { 0x0100000c: "arm64", 0x01000007: "x64" };

/**
 * The CPUs a binary is built for, from its header: ["arm64"], ["x64"],
 * ["arm64", "x64"] for a fat Mach-O, [] for something else.
 */
export function binaryArchs(buf) {
  const b = Buffer.from(buf);
  if (b.length < 8) return [];
  const be = (o) => b.readUInt32BE(o);
  const le = (o) => b.readUInt32LE(o);
  // Fat Mach-O (big-endian): 0xCAFEBABE, n, then n × (cputype, subtype, offset, size, align).
  if (be(0) === 0xcafebabe || be(0) === 0xcafebabf) {
    const n = be(4);
    if (n > 8) return []; // a Java class file also starts with CAFEBABE, with a version here
    const step = be(0) === 0xcafebabf ? 32 : 20;
    const out = [];
    for (let i = 0; i < n && 8 + i * step + 4 <= b.length; i++) out.push(MACHO[be(8 + i * step)] ?? "other");
    return [...new Set(out)].sort();
  }
  // Thin Mach-O, 64-bit little-endian: 0xFEEDFACF, cputype.
  if (le(0) === 0xfeedfacf) return [MACHO[le(4)] ?? "other"];
  // PE: "MZ", e_lfanew at 0x3C, "PE\0\0", machine.
  if (b[0] === 0x4d && b[1] === 0x5a && b.length >= 0x40) {
    const pe = le(0x3c);
    if (pe + 6 > b.length || le(pe) !== 0x00004550) return [];
    const machine = b.readUInt16LE(pe + 4);
    return [machine === 0xaa64 ? "arm64" : machine === 0x8664 ? "x64" : machine === 0x014c ? "x86" : "other"];
  }
  // ELF: 0x7F "ELF", e_machine at 18 (endianness at 5).
  if (b[0] === 0x7f && b[1] === 0x45 && b[2] === 0x4c && b[3] === 0x46 && b.length >= 20) {
    const m = b[5] === 2 ? b.readUInt16BE(18) : b.readUInt16LE(18);
    return [m === 0xb7 ? "arm64" : m === 0x3e ? "x64" : "other"];
  }
  return [];
}

/** Does a binary match the CPU its release file is named for? */
export function archMatches(name, archs) {
  const want = archOfName(name);
  if (want === "universal") return archs.includes("arm64") && archs.includes("x64");
  return archs.length === 1 && archs[0] === want;
}
