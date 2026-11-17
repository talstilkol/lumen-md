#!/usr/bin/env node
/**
 * Install each desktop build of a release and check it (plan W13.K4), on
 * the machine of its OS (a Mac, a Windows on ARM VM, an ARM64 Linux box):
 *
 *   node scripts/desktop-install-check.mjs [--dir release] [--keep]
 *
 * For every installer of this OS in the folder:
 *   1. its SHA-256 is the one in SHA256SUMS (and SHA256SUMS.asc verifies, when present);
 *   2. it installs into a scratch folder (macOS: the .dmg's app copied out;
 *      Windows: msiexec /a, an administrative install that touches no system
 *      state; Linux: the .deb unpacked, the AppImage extracted);
 *   3. the app's binary is for the CPU the file is named for — read from its
 *      header (a universal app holds both arm64 and x64), never trusted from the name;
 *   4. macOS: the code signature verifies (codesign --verify --deep --strict);
 *   5. the app starts and is still running after 5 s (then it is closed).
 *
 * Exit 1 when any installer fails a step. This is the owner's check on real
 * machines; nothing here runs in CI (no GitHub Actions, plan W1.24).
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { archMatches, archOfName, binaryArchs } from "./lib/desktopTargets.mjs";
import { parseSums } from "./lib/packaging.mjs";

const args = process.argv.slice(2);
const dir = path.resolve(args.includes("--dir") ? args[args.indexOf("--dir") + 1] : "release");
const keep = args.includes("--keep");
const failures = [];
const ok = (m) => console.log(`✓ ${m}`);
const fail = (m) => (failures.push(m), console.error(`✗ ${m}`));
const sh = (cmd, a, o = {}) => spawnSync(cmd, a, { encoding: "utf8", ...o });

const MINE = { darwin: /\.dmg$/i, win32: /\.msi$/i, linux: /\.(deb|AppImage)$/i }[process.platform];
if (!MINE) throw new Error(`no installers for ${process.platform}`);
if (!existsSync(path.join(dir, "SHA256SUMS"))) throw new Error(`${dir} has no SHA256SUMS`);
const sums = parseSums(readFileSync(path.join(dir, "SHA256SUMS"), "utf8")); // name → sha256
if (existsSync(path.join(dir, "SHA256SUMS.asc"))) {
  const v = sh("gpg", ["--verify", path.join(dir, "SHA256SUMS.asc"), path.join(dir, "SHA256SUMS")]);
  v.status === 0 ? ok("SHA256SUMS.asc verifies") : fail(`SHA256SUMS.asc does not verify: ${v.stderr.trim()}`);
} else console.warn("! SHA256SUMS is not signed (no SHA256SUMS.asc)");

function walk(d, out = []) {
  for (const n of readdirSync(d)) {
    const f = path.join(d, n);
    const st = statSync(f, { throwIfNoEntry: false });
    if (st?.isDirectory()) walk(f, out);
    else if (st?.isFile()) out.push(f);
  }
  return out;
}

/** The app's main binary inside an installed tree. */
function mainBinary(root) {
  const files = walk(root);
  if (process.platform === "darwin") return files.find((f) => /\.app\/Contents\/MacOS\/[^/]+$/.test(f));
  if (process.platform === "win32") return files.find((f) => /\\(lumen|Lumen)\.exe$/i.test(f));
  return files.find((f) => /\/usr\/bin\/[^/]+$/.test(f)) ?? files.find((f) => /\/AppRun$/.test(f) === false && /\/lumen[^/]*$/i.test(f));
}

async function startsAndStays(bin) {
  const p = spawn(bin, [], { stdio: "ignore", detached: false });
  let exited = null;
  p.on("exit", (c) => (exited = c));
  await new Promise((r) => setTimeout(r, 5000));
  if (exited === null) p.kill();
  return exited === null;
}

for (const name of readdirSync(dir).filter((n) => MINE.test(n)).sort()) {
  const file = path.join(dir, name);
  const sha = createHash("sha256").update(readFileSync(file)).digest("hex");
  if (sums.get(name) !== sha) {
    fail(`${name}: SHA-256 is not the one in SHA256SUMS`);
    continue;
  }
  ok(`${name}: SHA-256 matches`);
  const scratch = mkdtempSync(path.join(tmpdir(), "lumen-install-"));
  try {
    let root = scratch;
    if (process.platform === "darwin") {
      const mnt = path.join(scratch, "mnt");
      if (sh("hdiutil", ["attach", "-nobrowse", "-readonly", "-mountpoint", mnt, file]).status !== 0) {
        fail(`${name}: hdiutil attach failed`);
        continue;
      }
      const app = readdirSync(mnt).find((n) => n.endsWith(".app"));
      sh("ditto", [path.join(mnt, app), path.join(scratch, "Applications", app)]);
      sh("hdiutil", ["detach", mnt]);
      root = path.join(scratch, "Applications");
      const cs = sh("codesign", ["--verify", "--deep", "--strict", path.join(root, app)]);
      cs.status === 0 ? ok(`${name}: code signature verifies`) : fail(`${name}: codesign: ${cs.stderr.trim()}`);
    } else if (process.platform === "win32") {
      const r = sh("msiexec", ["/a", file, "/qn", `TARGETDIR=${scratch}`]);
      if (r.status !== 0) {
        fail(`${name}: msiexec /a failed (${r.status})`);
        continue;
      }
    } else if (name.endsWith(".deb")) {
      if (sh("dpkg-deb", ["-x", file, scratch]).status !== 0) {
        fail(`${name}: dpkg-deb -x failed`);
        continue;
      }
    } else {
      sh("chmod", ["+x", file]);
      sh(file, ["--appimage-extract"], { cwd: scratch });
      root = path.join(scratch, "squashfs-root");
    }
    const bin = mainBinary(root);
    if (!bin) {
      fail(`${name}: no app binary after install`);
      continue;
    }
    const archs = binaryArchs(readFileSync(bin).subarray(0, 4096));
    archMatches(name, archs) ? ok(`${name}: binary is ${archs.join(" + ")} (${archOfName(name)})`) : fail(`${name}: named ${archOfName(name)} but the binary is ${archs.join(" + ") || "unknown"}`);
    // A binary for another CPU cannot start here (Rosetta aside): only start what this machine runs natively or as universal.
    const here = process.arch === "arm64" ? "arm64" : "x64";
    if (archs.includes(here)) (await startsAndStays(bin)) ? ok(`${name}: starts and keeps running`) : fail(`${name}: exited within 5 s of starting`);
    else console.warn(`! ${name}: built for ${archs.join(" + ")}, this machine is ${here} — not started`);
  } finally {
    if (!keep) rmSync(scratch, { recursive: true, force: true });
  }
}

if (failures.length) {
  console.error(`\n${failures.length} problem(s).`);
  process.exit(1);
}
console.log("\nEvery installer checked.");
