/**
 * Review Z6-M5 (#930) and Z6-L6: the eval card decides what a run may claim.
 *
 *   - validateCard knows a dataset is synthetic from the repository (eval/synthetic, a set's manifest,
 *     eval/origins.json), in any path form, not from a `synthetic/` prefix only;
 *   - eval:embed-ingest reads the run's card: a dev or synthetic card never changes src/ai/embeddingDefault.json and
 *     never records a dev number as `heldoutNdcg10`;
 *   - the md-conformance parser card does not call micromark "not tuned" on the spec it is developed against.
 *
 * The competition reports are SYNTHETIC (written here, in the shape src/agents/eval/embedCompete.eval.ts writes);
 * "heldout-retrieval-he" stands for a W6.17 sealed set.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
// @ts-expect-error plain .mjs
import { isSyntheticDataset, makeCard, validateCard } from "../../../scripts/lib/evalCard.mjs";
// @ts-expect-error plain .mjs
import { acceptEmbedRun, embedDefault, withMeasured } from "../../../scripts/lib/embedIngest.mjs";

const ROOT = resolve(__dirname, "..", "..", "..");
const base = { model: { name: "m", digest: "sha256:x" }, seed: 1, temperature: 0, scores: { ndcg: [1, 0, 1] } };
const ds = (name: string, extra: Record<string, unknown> = {}) => ({ name, version: "2", license: "CC-BY-4.0", ...extra });
/** A card built without makeCard's own check, as another writer could. */
const rawCard = (tag: string, dataset: Record<string, unknown>) => ({ schema: 1, tag, model: base.model, seed: 1, temperature: 0, dataset, n: 3, metrics: { ndcg: { value: 0.5, ci95: [0.4, 0.6], method: "bootstrap" } } });

describe("a synthetic dataset is known by the repository, not by its spelling (Z6-M5)", () => {
  const synthetic = [
    "retrieval-hard/heldout",
    "retrieval-hard",
    "Retrieval-Hard/hard",
    "eval/synthetic/retrieval-hard",
    "./eval/synthetic/retrieval-hard/heldout",
    "eval\\synthetic\\retrieval-hard",
    "EVAL/Synthetic/retrieval-hard",
    "eval/golden/../synthetic/retrieval-hard",
    "eval//synthetic/retrieval-hard",
    join(ROOT, "eval/synthetic/retrieval-hard"),
    "synthetic/retrieval-hard/heldout",
    "eval/golden/retrieval-hard",
    // eval/origins.json: synthetic parts of golden sets.
    "bidi/lines",
    "typos-he/synthetic",
  ];
  it.each(synthetic)("%s is synthetic: a heldout card on it is refused", (name: string) => {
    expect(isSyntheticDataset(ds(name))).toBe(true);
    expect(validateCard(rawCard("heldout", ds(name))).join("\n")).toMatch(/synthetic set is dev only/);
    expect(validateCard(rawCard("public", ds(name, { source: "https://example.org/x" }))).join("\n")).toMatch(/synthetic set is dev only/);
    expect(() => makeCard({ ...base, tag: "heldout", dataset: ds(name) })).toThrow(/synthetic/);
  });
  it("an origin of real does not clear a synthetic set", () => {
    expect(isSyntheticDataset(ds("retrieval-hard/heldout", { origin: "real" }))).toBe(true);
  });
  const real = ["retrieval", "bfcl-v4-simple", "heq-v1", "heldout-retrieval-he", "bidi", "../elsewhere/eval/synthetic/x"];
  it.each(real)("%s is not synthetic", (name: string) => {
    expect(isSyntheticDataset(ds(name))).toBe(false);
    expect(validateCard(rawCard("heldout", ds(name)))).toEqual([]);
  });
  it("a dev card on a synthetic set is still fine", () => {
    expect(validateCard(rawCard("dev", ds("retrieval-hard/heldout")))).toEqual([]);
  });
});

describe("eval:embed-ingest reads the run's card (Z6-M5)", () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, "eval/models/embedding-candidates.json"), "utf8"));
  const verified = { ...manifest, candidates: manifest.candidates.map((c: { id: string }) => (c.id === "embeddinggemma-2" ? { ...c, licenseVerified: true, sha256: "a".repeat(64) } : c)) };
  const row = (id: string, held: number) => ({ id, dev: { ndcg10: held - 0.01, recall20: 0.9, msPerQuery: 20, dims: 256, indexBytes: 1, items: 60 }, heldout: { ndcg10: held, recall20: 0.9, msPerQuery: 25, dims: 256, indexBytes: 1, items: 40 } });
  const report = (card: unknown) => ({
    ...(card === undefined ? {} : { card }),
    rows: [row("multilingual-e5-small", 0.61), row("embeddinggemma-2", 0.7), row("embeddinggemma-2@256", 0.69)],
    decision: { discriminates: true, default: { id: "embeddinggemma-2@256", reason: "+8 nDCG@10 points" }, reranker: null },
  });
  // What the real run writes today: a dev card on the synthetic hard set.
  const devCard = makeCard({ ...base, tag: "dev", dataset: { name: "synthetic/retrieval-hard/heldout", version: "2", license: "CC-BY-4.0", origin: "synthetic" } });
  const heldoutCard = makeCard({ ...base, tag: "heldout", dataset: ds("heldout-retrieval-he") });

  it.each([
    ["a dev card", devCard, /tagged dev|synthetic/],
    ["a heldout card on a synthetic set (another writer)", rawCard("heldout", ds("retrieval-hard/heldout")), /synthetic/],
    ["no card", undefined, /no card/],
    ["an incomplete card", { tag: "heldout" }, /incomplete/],
  ] as Array<[string, unknown, RegExp]>)("%s never changes the app's model", (_n: string, card: unknown, why: RegExp) => {
    const r = report(card);
    expect(acceptEmbedRun(r, verified).ok).toBe(true);
    const d = embedDefault(r, verified);
    expect(d.entry).toBeNull();
    expect(d.keep).toBe(true);
    expect(d.why).toMatch(why);
    // Its numbers are dev numbers, never `heldoutNdcg10`.
    for (const m of Object.values(withMeasured(manifest, r).measured) as Array<Record<string, unknown>>) {
      expect(m).not.toHaveProperty("heldoutNdcg10");
      expect(m).toMatchObject({ basis: "dev" });
    }
  });

  it("a heldout card on a sealed set does, by the other rules", () => {
    const d = embedDefault(report(heldoutCard), verified, { file: "eval/results/embed-compete-2026-11-20.json", date: "2026-11-20" });
    expect(d.keep).toBeFalsy();
    expect(d.entry).toMatchObject({ id: "embeddinggemma-2", dims: 256, measured: { heldoutNdcg10: 0.69 } });
    expect(Object.values(withMeasured(manifest, report(heldoutCard)).measured)[0]).toMatchObject({ basis: "heldout", heldoutNdcg10: 0.61 });
  });

  it("the CLI leaves embeddingDefault.json as it is for a dev run, and records dev numbers", () => {
    const dir = mkdtempSync(join(tmpdir(), "lumen-z6-ingest-"));
    try {
      const run = join(dir, "embed-compete-2026-11-20.json");
      writeFileSync(run, JSON.stringify(report(devCard)));
      const def = join(dir, "embeddingDefault.json");
      const sentinel = JSON.stringify({ about: "test", default: { id: "kept" } });
      writeFileSync(def, sentinel);
      const man = join(dir, "embedding-candidates.json");
      writeFileSync(man, JSON.stringify(manifest));
      const r = spawnSync(process.execPath, [join(ROOT, "scripts/eval/embed-ingest.mjs"), "--file", run, "--manifest", man, "--default", def], { encoding: "utf8", cwd: ROOT });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain("not changed");
      expect(readFileSync(def, "utf8")).toBe(sentinel);
      const measured = JSON.parse(readFileSync(man, "utf8")).measured;
      expect(measured["embeddinggemma-2@256"]).toMatchObject({ basis: "dev", devHeldoutSplitNdcg10: 0.69 });
      expect(measured["embeddinggemma-2@256"]).not.toHaveProperty("heldoutNdcg10");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the md-conformance parser card (Z6-L6)", () => {
  it("does not claim micromark is untuned on the spec it is developed against", () => {
    const j = JSON.parse(readFileSync(join(ROOT, "eval/results/md-conformance.json"), "utf8"));
    const split: string = j.cards.parser.dataset.split;
    expect(split).not.toMatch(/not tuned/);
    expect(split).toMatch(/developed and tested against/);
    expect(j.cards.parser.tag).toBe("public");
  });
});
