// @vitest-environment node
/**
 * Plan W10.B19 (audit W2.2): Recall@5 of related notes on pairs DERIVED
 * FROM REAL NOTES, beside the generated gold set, reported separately.
 *
 * Real: the public Obsidian vaults of plan W4.30 (fixtures/obsidian-corpus,
 * byte-for-byte copies at pinned commits; see its manifest for the
 * licences). Each link A → B inside a vault is a gold pair. The link is
 * removed from A before A is the query. Generated: fixtures/relatedGold.ts
 * (50 topics, each built from the same keywords across two notes, so
 * BM25 finds them almost by construction).
 *
 * No threshold: the numbers are reported. The floors below only stop the
 * real set from silently shrinking.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Bm25Index } from "../search/bm25";
import { relatedNotes } from "../related/related";
import { goldVault } from "./fixtures/relatedGold";
// @ts-expect-error plain JavaScript
import { realLinkPairs, recallAt } from "../../scripts/golden/evals/related.mjs";

const CORPUS = join(__dirname, "fixtures", "obsidian-corpus");
const manifest = JSON.parse(readFileSync(join(CORPUS, "manifest.json"), "utf8")) as { vaults: Array<{ id: string; files: Array<{ path: string }> }> };
const vaults = manifest.vaults.map((v) => ({
  id: v.id,
  notes: v.files.filter((f) => f.path.endsWith(".md")).map((f) => ({ path: f.path, text: readFileSync(join(CORPUS, v.id, f.path), "utf8") })),
}));

type Pair = { vault: string; from: string; to: string; query: string };

describe("related notes on real links (W10.B19)", () => {
  const pairs = realLinkPairs(vaults) as Pair[];

  it("derives gold pairs from real links, and the link is gone from the query", () => {
    expect(vaults.reduce((a, v) => a + v.notes.length, 0)).toBeGreaterThan(300);
    expect(pairs.length).toBeGreaterThanOrEqual(100);
    expect(new Set(pairs.map((p) => p.vault)).size).toBeGreaterThanOrEqual(4);
    for (const p of pairs) {
      const name = p.to.split("/").pop()!.replace(/\.md$/, "").toLowerCase();
      expect(p.from).not.toBe(p.to);
      // No wikilink or Markdown link to B is left in the query.
      const links = [...p.query.matchAll(/(?<!!)\[\[([^\]|#^]+)|\]\(<?([^)>\s]+\.md)/g)].map((m) => decodeURIComponent((m[1] ?? m[2])).split("/").pop()!.replace(/\.md$/i, "").trim().toLowerCase());
      expect(links, `${p.from} → ${p.to}`).not.toContain(name);
    }
  });

  it("reports Recall@5 on the real set and on the generated set, separately", () => {
    const real = recallAt(Bm25Index, relatedNotes, vaults, pairs, 5) as { pairs: number; hit: number; recall: number; perVault: Record<string, { pairs: number; hit: number }> };
    const { notes, pairs: genPairs } = goldVault();
    const gen = recallAt(Bm25Index, relatedNotes, [{ id: "generated", notes }], genPairs.map(([from, to]) => ({ vault: "generated", from, to, query: notes.find((n) => n.path === from)!.text.replace(/^# .*\n\n/, "") })), 5) as { pairs: number; hit: number; recall: number };
    console.info(`[W2.2] REAL (links in ${Object.keys(real.perVault).length} public Obsidian vaults): Recall@5 ${(real.recall * 100).toFixed(1)}% (${real.hit}/${real.pairs})`);
    for (const [v, r] of Object.entries(real.perVault)) console.info(`  ${v}: ${r.hit}/${r.pairs}`);
    console.info(`[W2.2] GENERATED (fixtures/relatedGold.ts): Recall@5 ${(gen.recall * 100).toFixed(1)}% (${gen.hit}/${gen.pairs})`);
    expect(real.pairs).toBe(pairs.length);
    expect(gen.pairs).toBe(100);
    expect(real.recall).toBeGreaterThanOrEqual(0);
  });
});
