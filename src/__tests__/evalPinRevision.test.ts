/**
 * Wave g6 (Mac pack L5): scripts/eval-public/pin-revision.mjs writes
 * dataset.revision into an eval/public manifest that has none, so the Mac's
 * `eval:public -- fetch <id> --pin` has a commit to pin the files at. The
 * Hub and git are stand-ins here (no network).
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — plain .mjs script without type declarations
import { pin, resolveRevision } from "../../scripts/eval-public/pin-revision.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const hub = (body: unknown, ok = true) => async () => ({ ok, status: ok ? 200 : 401, json: async () => body });

function dir(manifests: Record<string, unknown>): string {
  const d = mkdtempSync(join(tmpdir(), "pin-rev-"));
  for (const [id, m] of Object.entries(manifests)) writeFileSync(join(d, `${id}.json`), JSON.stringify(m));
  return d;
}

describe("eval:public pin-revision", () => {
  it("Hugging Face: writes the main commit into a manifest without one", async () => {
    const d = dir({ a: { id: "a", dataset: { hub: "huggingface", id: "ivrit-ai/eval-d1", revision: null, files: [] } } });
    const rows = await pin(["a"], { dir: d, fetchImpl: hub({ sha: SHA }) });
    expect(rows).toEqual([{ id: "a", revision: SHA, status: "pinned" }]);
    expect(JSON.parse(readFileSync(join(d, "a.json"), "utf8")).dataset.revision).toBe(SHA);
  });

  it("never moves a revision that is already pinned", async () => {
    const old = "f".repeat(40);
    const d = dir({ b: { id: "b", dataset: { hub: "huggingface", id: "x/y", revision: old, files: [] } } });
    const rows = await pin(["b"], { dir: d, fetchImpl: hub({ sha: SHA }) });
    expect(rows[0].status).toBe("already pinned");
    expect(JSON.parse(readFileSync(join(d, "b.json"), "utf8")).dataset.revision).toBe(old);
  });

  it("GitHub: the HEAD of git ls-remote; a gated or failing Hub is an error, not a null pin", async () => {
    await expect(resolveRevision({ hub: "github", url: "https://github.com/x/y" }, { git: () => ({ status: 0, stdout: `${SHA}\tHEAD\n` }) })).resolves.toBe(SHA);
    await expect(resolveRevision({ hub: "huggingface", id: "x/y" }, { fetchImpl: hub({}, false) })).rejects.toThrow(/401/);
    await expect(resolveRevision({ hub: "huggingface", id: "x/y" }, { fetchImpl: hub({ sha: "main" }) })).rejects.toThrow(/no commit sha/);
    await expect(resolveRevision({ hub: "unicode" })).rejects.toThrow(/by hand/);
  });

  it("--sha by hand must be a full commit", async () => {
    const d = dir({ c: { id: "c", dataset: { hub: "other", revision: null, files: [] } } });
    await expect(pin(["c"], { dir: d, sha: "abc" })).rejects.toThrow(/40 hex/);
    await expect(pin(["c"], { dir: d, sha: SHA })).resolves.toEqual([{ id: "c", revision: SHA, status: "pinned" }]);
  });
});
