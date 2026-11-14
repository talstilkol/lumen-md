/**
 * Plan W6.43 / W10.E68 — `node scripts/release.mjs publish` refuses a
 * release whose app would carry the committed placeholder updater key
 * (`${LUMEN_UPDATER_PUBKEY}`), an empty or malformed key, the throwaway
 * test key, or a fake build. (`npm run release -- <v> --publish` already
 * refused them in its preflight; this is the other publish path.)
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
// @ts-expect-error — plain .mjs module without type declarations
import { PUBKEY_PLACEHOLDER, publishRefusals, testUpdaterKey } from "../../scripts/lib/releaseRun.mjs";
// @ts-expect-error — plain .mjs module without type declarations
import { generateKeys } from "../../scripts/supply-chain/minisign.mjs";

const ROOT = resolve(__dirname, "../..");

describe("publishing refuses an app that cannot be updated", () => {
  it("the placeholder, an empty key, a non-key, the test key, a fake build: refused, each with its reason", () => {
    expect(publishRefusals({ pubkey: PUBKEY_PLACEHOLDER })[0]).toMatch(/still the placeholder/);
    expect(publishRefusals({ pubkey: "" })[0]).toMatch(/empty/);
    expect(publishRefusals({ pubkey: "bm90IGEga2V5" })[0]).toMatch(/not a minisign key/);
    const test = testUpdaterKey(() => generateKeys());
    expect(publishRefusals({ pubkey: test.pubkey })).toEqual([expect.stringMatching(/throwaway TEST key/)]);
    const real = Buffer.from(generateKeys().publicKey).toString("base64");
    expect(publishRefusals({ pubkey: real })).toEqual([]);
    expect(publishRefusals({ pubkey: real, files: ["lumen-web-v0.2.0.tgz", ".FAKE-BUILD"] })).toEqual([expect.stringMatching(/fake build/)]);
  });

  it("the committed tauri.conf.json holds the placeholder, so `release.mjs publish` stops before git, gh or an upload", () => {
    expect(JSON.parse(readFileSync(join(ROOT, "src-tauri/tauri.conf.json"), "utf8")).plugins.updater.pubkey).toBe(PUBKEY_PLACEHOLDER);
    const env = { ...process.env };
    delete env.LUMEN_UPDATER_PUBKEY;
    const r = spawnSync(process.execPath, [join(ROOT, "scripts/release.mjs"), "publish"], { cwd: ROOT, env, encoding: "utf8" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("refusing to publish");
    expect(r.stderr).toContain("still the placeholder");
    // It stopped first: not at the tag check, not at gh.
    expect(r.stderr).not.toMatch(/is not HEAD|gh release/);
  });

  it("with a real key in the environment it gets past the key check (and stops later, at the tag)", () => {
    const env = { ...process.env, LUMEN_UPDATER_PUBKEY: Buffer.from(generateKeys().publicKey).toString("base64") };
    const r = spawnSync(process.execPath, [join(ROOT, "scripts/release.mjs"), "publish"], { cwd: ROOT, env, encoding: "utf8" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).not.toContain("refusing to publish");
  });
});
