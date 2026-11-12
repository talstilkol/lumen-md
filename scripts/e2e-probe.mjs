#!/usr/bin/env node
/**
 * PROBE (verify/e2e-probe only, never merged): can Playwright run inside the
 * Vercel build? Builds, installs browsers into node_modules
 * (PLAYWRIGHT_BROWSERS_PATH=0, no --with-deps: no root), serves dist/ with
 * `vite preview` and runs e2e/smoke.spec.ts, then the whole chromium project
 * time-boxed, then firefox / webkit smoke. Every step is reported; the build
 * exits 0 unless `npm run build` fails, so the log always reaches the end.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const T0 = Date.now();
const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: "0", CI: "1", PW_SKIP_WARMUP: "" };
const mins = () => ((Date.now() - T0) / 60000).toFixed(1);
const log = (s) => console.log(`[e2e-probe ${mins()} min] ${s}`);
function run(cmd, args, opts = {}) {
  const t = Date.now();
  log(`$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", env, timeout: opts.timeoutMs, ...opts });
  log(`→ exit ${r.status ?? r.signal} in ${((Date.now() - t) / 1000).toFixed(0)} s`);
  return r.status === 0;
}
function sh(cmd) {
  const r = spawnSync("sh", ["-c", cmd], { encoding: "utf8", env });
  return `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
}
function findExe(prefix, names) {
  const root = join("node_modules", "playwright-core", ".local-browsers");
  if (!existsSync(root)) return [];
  const out = [];
  const walk = (d, depth) => {
    if (depth > 5) return;
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      const st = statSync(p);
      if (st.isDirectory()) walk(p, depth + 1);
      else if (names.includes(n)) out.push(p);
    }
  };
  for (const n of readdirSync(root)) if (n.startsWith(prefix)) walk(join(root, n), 0);
  return out;
}
function missingLibs(label, exes) {
  for (const exe of exes) {
    const nf = sh(`ldd "${exe}" 2>&1 | grep -i "not found" | sort -u`);
    log(`${label}: ldd ${exe}: ${nf ? `\n${nf}` : "no missing libraries"}`);
  }
}

log(`env: node ${process.version}, uid ${sh("id -u")}, ${sh("nproc")} cpus, ${sh("free -m | awk 'NR==2{print $2\" MB RAM\"}'")}`);
log(`os: ${sh("cat /etc/os-release | head -3 | tr '\\n' ' '")}`);
log(`package managers: ${sh("for p in dnf yum microdnf apt-get; do command -v $p; done; echo -n sudo:; command -v sudo || echo none")}`);

if (!run("npm", ["run", "build"], { env: { ...env, LUMEN_CHUNK_REPORT: "1" } })) process.exit(1);

// Run 3: write the renderSnapshotDocs file snapshots (-u: the files are new)
// and serve them from dist/__render-docs/ with their SHA-256, to commit them byte for byte.
{
  const { createHash } = await import("node:crypto");
  const { mkdirSync, readFileSync: rf, copyFileSync, readdirSync: rd } = await import("node:fs");
  run("npx", ["vitest", "run", "-u", "src/__tests__/renderSnapshotDocs.test.ts"], { timeoutMs: 8 * 60_000 });
  const dir = "src/__tests__/__snapshots__/render-docs";
  mkdirSync("dist/__render-docs", { recursive: true });
  for (const f of existsSync(dir) ? rd(dir) : []) {
    copyFileSync(join(dir, f), join("dist/__render-docs", f));
    const buf = rf(join(dir, f));
    log(`render-docs ${f}: ${buf.length} bytes, sha256 ${createHash("sha256").update(buf).digest("hex")}`);
  }
}

const preview = spawn("npx", ["vite", "preview", "--port", "4173", "--strictPort", "--host", "127.0.0.1"], { env, stdio: ["ignore", "inherit", "inherit"] });
await new Promise((r) => setTimeout(r, 6000));
env.PLAYWRIGHT_BASE_URL = "http://127.0.0.1:4173";
log(`preview: ${sh("curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4173/")}`);

const pw = (args, timeoutMs) => run("npx", ["playwright", "test", ...args, "--reporter=line"], { timeoutMs });

const browsers = [
  { name: "chromium", install: ["chromium", "--only-shell"], prefix: "chromium", exes: ["headless_shell", "chrome-headless-shell", "chrome"] },
  { name: "firefox", install: ["firefox"], prefix: "firefox", exes: ["firefox"] },
  { name: "webkit", install: ["webkit"], prefix: "webkit", exes: ["pw_run.sh", "MiniBrowser"] },
];
const result = {};
// Run 1: the build runs as root on Amazon Linux 2023 with dnf, and the headless shell lacked nss / nspr.
run("dnf", ["-y", "-q", "install", "nss", "nspr"], { timeoutMs: 4 * 60_000 });
// WebKit's Ubuntu build wants Ubuntu sonames (libjpeg.so.8, libavif.so.16, flite…): see what AL2023 can give.
const webkitPkgs = [] && ["libsecret", "hyphen", "enchant2", "harfbuzz-icu", "libavif", "libjpeg-turbo", "woff2", "mesa-libGLES", "libmanette", "flite", "x264-libs", "gstreamer1-plugins-base", "libwpe", "wpebackend-fdo", "libxslt", "lcms2", "libwebp", "openjpeg2"];
for (const pkg of webkitPkgs) log(`dnf ${pkg}: ${sh(`dnf -y -q install ${pkg} >/dev/null 2>&1 && echo installed || echo unavailable`)}`);
for (const b of browsers) {
  const left = 42 - (Date.now() - T0) / 60000;
  if (left < 4) { log(`${b.name}: skipped, ${left.toFixed(1)} min left`); result[b.name] = "skipped (time)"; continue; }
  if (b.name === "webkit") { result.webkit = "not tried: needs glibc 2.38, the image has 2.34 (run 2)"; continue; }
  if (!run("npx", ["playwright", "install", ...b.install], { timeoutMs: 6 * 60_000 })) { result[b.name] = "install failed"; continue; }
  missingLibs(b.name, findExe(b.prefix, b.exes));
  if (b.name === "webkit") { result.webkit = "not tried: needs glibc 2.38, the image has 2.34 (run 2)"; continue; }
  const smoke = pw(["e2e/smoke.spec.ts", `--project=${b.name}`], 5 * 60_000);
  result[b.name] = smoke ? "smoke passed" : "smoke failed";
  if (smoke && b.name === "chromium") {
    const box = Math.max(3, Math.min(30, 40 - (Date.now() - T0) / 60000 - 3));
    log(`chromium: whole project, time-boxed to ${box.toFixed(0)} min`);
    const all = pw([`--project=chromium`, "--workers=2", "--max-failures=300", `--global-timeout=${Math.round(box * 60_000)}`], (box + 2) * 60_000);
    result.chromiumAll = all ? "whole project passed" : "whole project: failures or time box (see the line reporter above)";
  }
}
preview.kill();
log(`RESULT ${JSON.stringify(result)}`);
