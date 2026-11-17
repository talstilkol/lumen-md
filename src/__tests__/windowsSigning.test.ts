/**
 * Plan W11.S15 (research R5.10): Windows signing through SignPath
 * Foundation: Tauri's signCommand, a step in release-run, and a check that
 * finds an unsigned binary. A release without the SignPath details never
 * marks Windows as signed.
 *
 * The PE files here are SYNTHETIC: minimal PE32+ headers written in the
 * test, one with an empty certificate table (unsigned) and one whose table
 * holds a WIN_CERTIFICATE of type PKCS_SIGNED_DATA (a placeholder, not a
 * real signature: only signtool can say a signature is valid). The SignPath
 * server is a local stand-in that speaks the request flow signpath-sign.mjs
 * uses (submit, poll, download), not SignPath itself.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — plain .mjs module without type declarations
import { SIGN_COMMAND, SIGNPATH_ENV, peSignature, windowsSigningPlan, windowsSigningRecord, withSignPath } from "../../scripts/lib/windowsSigning.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import { verifyFile } from "../../scripts/windows/verify-signature.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import { signWithSignPath } from "../../scripts/windows/signpath-sign.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import * as R from "../../scripts/lib/releaseRun.mjs";

const ROOT = process.cwd();
const ENV = Object.fromEntries((SIGNPATH_ENV as string[]).map((k) => [k, `test-${k.toLowerCase()}`]));

/** A minimal PE32+ file; `signed` puts a WIN_CERTIFICATE (PKCS_SIGNED_DATA) in its certificate table. */
function pe(signed: boolean): Buffer {
  const b = Buffer.alloc(0x400);
  b.writeUInt16LE(0x5a4d, 0); // MZ
  b.writeUInt32LE(0x80, 0x3c); // e_lfanew
  b.writeUInt32LE(0x00004550, 0x80); // "PE\0\0"
  b.writeUInt16LE(0x8664, 0x84); // x64
  const opt = 0x80 + 24;
  b.writeUInt16LE(0x20b, opt); // PE32+
  b.writeUInt32LE(16, opt + 108); // NumberOfRvaAndSizes
  if (signed) {
    const at = 0x300;
    b.writeUInt32LE(at, opt + 112 + 4 * 8); // certificate table: file offset
    b.writeUInt32LE(0x40, opt + 112 + 4 * 8 + 4); // and size
    b.writeUInt32LE(0x40, at); // dwLength
    b.writeUInt16LE(0x0200, at + 4); // WIN_CERT_REVISION_2_0
    b.writeUInt16LE(0x0002, at + 6); // WIN_CERT_TYPE_PKCS_SIGNED_DATA
  }
  return b;
}

describe("the check finds an unsigned binary (W11.S15 acceptance 2)", () => {
  it("reads the PE certificate table: empty is unsigned, a PKCS#7 entry is signed, anything else isn't a PE", () => {
    expect(peSignature(pe(false))).toMatchObject({ pe: true, signed: false, why: expect.stringMatching(/unsigned/) });
    expect(peSignature(pe(true))).toMatchObject({ pe: true, signed: true });
    expect(peSignature(Buffer.from("FAKE Windows NSIS installer"))).toMatchObject({ pe: false, signed: false });
    const wrongType = pe(true);
    wrongType.writeUInt16LE(0x0001, 0x306); // X.509, not PKCS#7
    expect(peSignature(wrongType).signed).toBe(false);
    const pastEnd = pe(true);
    pastEnd.writeUInt32LE(0x10000, 0x80 + 24 + 112 + 4 * 8);
    expect(peSignature(pastEnd).why).toMatch(/past the end/);
  });

  it("the CLI exits 1 on an unsigned file, 0 on a signed one; on Windows it also runs signtool verify /pa", () => {
    const dir = mkdtempSync(join(tmpdir(), "winsign-"));
    try {
      writeFileSync(join(dir, "unsigned.exe"), pe(false));
      writeFileSync(join(dir, "signed.exe"), pe(true));
      const bad = spawnSync(process.execPath, ["scripts/windows/verify-signature.mjs", join(dir, "unsigned.exe")], { encoding: "utf8" });
      expect(bad.status).toBe(1);
      expect(bad.stdout).toMatch(/✗ .*unsigned/);
      expect(spawnSync(process.execPath, ["scripts/windows/verify-signature.mjs", join(dir, "signed.exe")], { encoding: "utf8" }).status).toBe(0);
      const calls: string[][] = [];
      const refuse = (cmd: string, args: string[]) => (calls.push([cmd, ...args]), { status: 1, stdout: "SignTool Error: A certificate chain could not be built" });
      expect(verifyFile(join(dir, "signed.exe"), { platform: "win32", run: refuse })).toMatchObject({ signed: false, why: expect.stringMatching(/signtool verify \/pa refused/) });
      expect(calls[0]).toEqual(["signtool", "verify", "/pa", "/v", join(dir, "signed.exe")]);
      expect(verifyFile(join(dir, "signed.exe"), { platform: "win32", run: () => ({ status: 0, stdout: "Successfully verified" }) }).signed).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("signCommand and the SignPath submitter", () => {
  it("tauri.conf.json gets SignPath as the signCommand (with %1), and no certificate thumbprint", () => {
    const conf = { bundle: { windows: { certificateThumbprint: "AB", digestAlgorithm: "sha256" } } };
    expect(withSignPath(conf).bundle.windows).toEqual({ digestAlgorithm: "sha256", signCommand: "node scripts/windows/signpath-sign.mjs %1" });
    expect(SIGN_COMMAND).toContain("%1");
    // The committed config doesn't carry it: a contributor's Windows build would fail without the details.
    expect(JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).bundle.windows?.signCommand).toBeUndefined();
  });

  it("without the SignPath details the submitter refuses (exit 2) and leaves the file as it was", () => {
    const dir = mkdtempSync(join(tmpdir(), "winsign-"));
    try {
      writeFileSync(join(dir, "a.exe"), pe(false));
      const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("SIGNPATH_")));
      const r = spawnSync(process.execPath, ["scripts/windows/signpath-sign.mjs", join(dir, "a.exe")], { encoding: "utf8", env });
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/SignPath is not configured: SIGNPATH_API_TOKEN/);
      expect(readFileSync(join(dir, "a.exe"))).toEqual(pe(false));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("with them: submits the file, waits for approval, downloads the signed file and puts it in place (local stand-in server)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "winsign-"));
    const seen: Array<{ method: string; url: string; auth: string; body?: string }> = [];
    let polls = 0;
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        seen.push({ method: req.method!, url: req.url!, auth: String(req.headers.authorization), body: Buffer.concat(chunks).toString("latin1") });
        const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
        if (req.method === "POST" && req.url === "/Api/v1/test-signpath_organization_id/SigningRequests") {
          res.writeHead(201, { location: `${base}/Api/v1/test-signpath_organization_id/SigningRequests/r1` });
          return res.end();
        }
        if (req.url?.endsWith("/SigningRequests/r1")) {
          polls++;
          res.writeHead(200, { "content-type": "application/json" });
          return res.end(JSON.stringify(polls < 2 ? { status: "WaitingForApproval", isFinalStatus: false } : { status: "Completed", isFinalStatus: true, signedArtifactLink: `${base}/signed/r1` }));
        }
        if (req.url === "/signed/r1") {
          res.writeHead(200);
          return res.end(pe(true));
        }
        res.writeHead(404);
        res.end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    try {
      const file = join(dir, "Lumen_0.2.0_x64-setup.exe");
      writeFileSync(file, pe(false));
      const port = (server.address() as { port: number }).port;
      const out = await signWithSignPath(file, { ...ENV, SIGNPATH_API_URL: `http://127.0.0.1:${port}/Api/v1`, SIGNPATH_POLL_MS: "10" });
      expect(out.status).toBe("Completed");
      expect(peSignature(readFileSync(file)).signed).toBe(true);
      expect(seen[0].method).toBe("POST");
      expect(seen.every((s) => s.auth === "Bearer test-signpath_api_token")).toBe(true);
      for (const field of ['name="ProjectSlug"', "test-signpath_project_slug", 'name="SigningPolicySlug"', "test-signpath_signing_policy_slug", 'name="Artifact"; filename="Lumen_0.2.0_x64-setup.exe"']) expect(seen[0].body).toContain(field);
      expect(polls).toBe(2);
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("release-run never marks Windows signed without SignPath (W11.S15 acceptance 1)", () => {
  it("the record: unconfigured → not signed; configured but an unsigned installer → not signed; both → signed", () => {
    const none = windowsSigningPlan({});
    expect(none).toEqual({ configured: false, missing: SIGNPATH_ENV });
    const ok = [{ name: "Lumen_x64-setup.exe", signed: true, why: "ok" }];
    expect(windowsSigningRecord(none, ok)).toMatchObject({ signed: false, reason: expect.stringMatching(/SignPath is not configured/) });
    const plan = windowsSigningPlan(ENV);
    expect(plan.configured).toBe(true);
    expect(windowsSigningRecord(plan, [{ name: "a.exe", signed: false, why: "unsigned" }])).toMatchObject({ signed: false, reason: "not signed: a.exe (unsigned)" });
    expect(windowsSigningRecord(plan, ok).signed).toBe(true);
    expect(windowsSigningRecord(plan, []).signed).toBe(false);
  });

  it("preflight lists SignPath for a publish (not blocking: the release says it is unsigned)", () => {
    const base = { current: "0.1.0", tagExists: false, repo: "o/r", nodeModules: true, cargo: true, tauriCli: true, notes: { he: true, en: true }, clean: true, branch: "main", gh: true, updaterKey: true, updaterPub: true, updaterPubIsTest: false, releaseKey: true, releasePub: true, signPath: false };
    const items = R.preflight(R.parseRunArgs(["0.2.0-beta.1", "--publish"]), base);
    const sp = items.find((i: { what: string }) => /SignPath/.test(i.what));
    expect(sp).toMatchObject({ ok: false, blocking: false });
    expect(R.preflight(R.parseRunArgs(["0.2.0-beta.1", "--publish"]), { ...base, signPath: true }).find((i: { what: string }) => /SignPath/.test(i.what)).ok).toBe(true);
  });

  it("the whole dry run without SignPath writes release/signing.json: Windows NOT signed, and says why", () => {
    const dir = mkdtempSync(join(tmpdir(), "lumen-release-sign-"));
    try {
      for (const p of ["package.json", "package-lock.json", "CHANGELOG.md", "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock", "src-tauri/src/updates.rs", "src/update/stagedRollout.ts"]) {
        mkdirSync(join(dir, p, ".."), { recursive: true });
        cpSync(join(ROOT, p), join(dir, p));
      }
      for (const d of ["scripts", "release-notes", "changelog"]) cpSync(join(ROOT, d), join(dir, d), { recursive: true });
      writeFileSync(join(dir, ".gitignore"), "/release/\n/dist/\n");
      const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...a], { cwd: dir, encoding: "utf8" });
      git("init", "-q");
      git("remote", "add", "origin", "https://github.com/talstilkol/lumen-md.git");
      git("add", "-A");
      git("commit", "-qm", "chore: base");
      const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("SIGNPATH_")));
      const r = spawnSync(process.execPath, ["scripts/release.mjs", "0.2.0-beta.1", "--dry-run", "--fake-build", "--offline"], { cwd: dir, encoding: "utf8", timeout: 120_000, env });
      expect(`${r.stdout}${r.stderr}`).toMatch(/Dry run OK/);
      expect(r.stdout).toMatch(/Windows: NOT signed — SignPath is not configured/);
      const rec = JSON.parse(readFileSync(join(dir, "release/signing.json"), "utf8")).windows;
      expect(rec.signed).toBe(false);
      expect(rec.files.map((f: { name: string }) => f.name)).toEqual(readdirSync(join(dir, "release")).filter((n) => /\.exe$/.test(n)));
      expect(readFileSync(join(dir, "release/SHA256SUMS"), "utf8")).toContain("signing.json");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);
});
