#!/usr/bin/env node
/**
 * Build the Quick Look extension (plan W13.K2) before tauri bundles the app
 * (tauri.conf.json build.beforeBundleCommand), on a Mac only:
 *
 *   1. the Rust renderer (src-tauri/preview) as a universal static library
 *      (aarch64 + x86_64, lipo);
 *   2. the Swift provider (src-tauri/quicklook/LumenPreview) linked against it,
 *      as an app extension (entry point _NSExtensionMain), for both CPUs;
 *   3. the bundle src-tauri/target/quicklook/LumenPreview.appex, signed with
 *      the release identity (APPLE_SIGNING_IDENTITY, else ad hoc) and its
 *      sandbox entitlements. tauri copies it to Contents/PlugIns
 *      (bundle.macOS.files) and signs the app around it.
 *
 * Elsewhere it does nothing. A failure on the Mac fails the build: a Lumen.app
 * without its Quick Look extension is not the build the plan asks for.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
if (process.platform !== "darwin") {
  console.log("quicklook: not a Mac; nothing to build");
  process.exit(0);
}
const T = join(ROOT, "src-tauri/target/quicklook");
const SRC = join(ROOT, "src-tauri/quicklook/LumenPreview");
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", cwd: ROOT, ...opts });
rmSync(T, { recursive: true, force: true });
mkdirSync(T, { recursive: true });

const archs = [["aarch64-apple-darwin", "arm64"], ["x86_64-apple-darwin", "x86_64"]];
const libs = [];
for (const [triple] of archs) {
  run("cargo", ["build", "--release", "--manifest-path", "src-tauri/preview/Cargo.toml", "--target", triple, "--target-dir", join(T, "cargo")]);
  libs.push(join(T, "cargo", triple, "release", "liblumen_preview.a"));
}
const lib = join(T, "liblumen_preview.a");
run("lipo", ["-create", ...libs, "-output", lib]);

const bins = [];
for (const [, arch] of archs) {
  const out = join(T, `LumenPreview-${arch}`);
  run("xcrun", ["swiftc", "-O", "-parse-as-library", "-application-extension", "-module-name", "LumenPreview", "-target", `${arch}-apple-macos12.0`, join(SRC, "PreviewProvider.swift"), lib, "-framework", "QuickLookUI", "-framework", "UniformTypeIdentifiers", "-Xlinker", "-e", "-Xlinker", "_NSExtensionMain", "-o", out]);
  bins.push(out);
}
const appex = join(T, "LumenPreview.appex/Contents");
mkdirSync(join(appex, "MacOS"), { recursive: true });
run("lipo", ["-create", ...bins, "-output", join(appex, "MacOS/LumenPreview")]);
copyFileSync(join(SRC, "Info.plist"), join(appex, "Info.plist"));
const identity = process.env.APPLE_SIGNING_IDENTITY || "-";
run("codesign", ["--force", "--options", "runtime", "--timestamp=none", "--entitlements", join(SRC, "LumenPreview.entitlements"), "--sign", identity, join(T, "LumenPreview.appex")]);
console.log(`quicklook: ${join(T, "LumenPreview.appex")} (universal, signed ${identity === "-" ? "ad hoc" : "with the release identity"})`);
