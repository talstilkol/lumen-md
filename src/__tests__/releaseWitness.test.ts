/**
 * Plan W7.22 step 3 (W10.E54): Witness is the release gate by default. A
 * published release without Witness fails before anything is attested,
 * signed or uploaded; the repo's Node attester alone is the explicit
 * fallback, LUMEN_PROVENANCE_ENGINE=node. The real provenanceGate runs
 * here; only "is the witness binary on PATH" is a seam.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — plain .mjs module without type declarations
import { ENGINE_ENV, PUBLISH_STEPS, WITNESS_POLICY, provenanceGate, releaseEngine, witnessProblems, witnessRefusal } from "../../scripts/supply-chain/release-gate.mjs";

function repo() {
  const root = mkdtempSync(join(tmpdir(), "lumen-witness-"));
  mkdirSync(join(root, "security"), { recursive: true });
  mkdirSync(join(root, "release"), { recursive: true });
  writeFileSync(join(root, "release", "lumen.dmg"), "x");
  return { root, out: join(root, "release"), done: () => rmSync(root, { recursive: true, force: true }) };
}

describe("the engine of a published release", () => {
  it("Witness unless the Node attester is asked for by name; anything else is an error", () => {
    expect(ENGINE_ENV).toBe("LUMEN_PROVENANCE_ENGINE");
    expect(releaseEngine({})).toBe("witness");
    expect(releaseEngine({ LUMEN_PROVENANCE_ENGINE: "" })).toBe("witness");
    expect(releaseEngine({ LUMEN_PROVENANCE_ENGINE: "node" })).toBe("node");
    expect(() => releaseEngine({ LUMEN_PROVENANCE_ENGINE: "auto" })).toThrow("use witness (the default) or node (the explicit fallback)");
  });

  it("what Witness needs: the binary, the signing key, the committed policy", () => {
    const r = repo();
    try {
      expect(witnessProblems({ env: {}, root: r.root, hasWitness: () => false })).toEqual([
        "`witness` is not on PATH (scripts/supply-chain/install-tools.sh installs the pinned release)",
        "LUMEN_WITNESS_KEY is not set (the Witness signing key, not the policy key: docs security/provenance)",
        `${WITNESS_POLICY} is not committed (the Witness policy, signed with the policy key)`,
      ]);
      expect(witnessProblems({ env: { LUMEN_WITNESS_KEY: join(r.root, "nope.pem") }, root: r.root, hasWitness: () => true })[0]).toMatch(/LUMEN_WITNESS_KEY: .*nope\.pem does not exist/);
      writeFileSync(join(r.root, "w.pem"), "k");
      writeFileSync(join(r.root, WITNESS_POLICY), "{}");
      expect(witnessProblems({ env: { LUMEN_WITNESS_KEY: join(r.root, "w.pem") }, root: r.root, hasWitness: () => true })).toEqual([]);
    } finally {
      r.done();
    }
  });
});

describe("provenanceGate --publish (acceptance: a release without Witness fails)", () => {
  it("no Witness: refused before the build key, attest, sign or verify; the message names the fallback", () => {
    const r = repo();
    try {
      let err: Error | null = null;
      try {
        provenanceGate({ out: r.out, root: r.root, commit: "a".repeat(40), publish: true, env: {}, hasWitness: () => false });
      } catch (e) {
        err = e as Error;
      }
      expect(err?.message).toBe(witnessRefusal(witnessProblems({ env: {}, root: r.root, hasWitness: () => false })));
      expect(err?.message).toContain("Nothing was published");
      expect(err?.message).toContain("LUMEN_PROVENANCE_ENGINE=node");
      // It stopped first: no provenance was written into the release folder.
      expect(() => provenanceGate({ out: r.out, root: r.root, commit: "a".repeat(40), publish: true, env: {}, hasWitness: () => false })).toThrow(/Witness is not ready/);
    } finally {
      r.done();
    }
  });

  it("Witness ready, or the explicit Node fallback: the gate goes on to its next step (the build key)", () => {
    const r = repo();
    try {
      writeFileSync(join(r.root, "w.pem"), "k");
      writeFileSync(join(r.root, WITNESS_POLICY), "{}");
      const ready = { LUMEN_WITNESS_KEY: join(r.root, "w.pem") };
      expect(() => provenanceGate({ out: r.out, root: r.root, commit: "a".repeat(40), publish: true, env: ready, hasWitness: () => true })).toThrow("provenance gate: no build key");
      expect(() => provenanceGate({ out: r.out, root: r.root, commit: "a".repeat(40), publish: true, env: { LUMEN_PROVENANCE_ENGINE: "node" }, hasWitness: () => false })).toThrow("provenance gate: no build key");
    } finally {
      r.done();
    }
  });

  it("the dry run's report shows the Witness steps: witness run around attest, and verify --witness", () => {
    expect(PUBLISH_STEPS[0]).toMatch(/^witness run .* -- node scripts\/supply-chain\/attest\.mjs .*--engine node$/);
    expect(PUBLISH_STEPS[2]).toMatch(/verify\.mjs .* --witness$/);
  });
});
