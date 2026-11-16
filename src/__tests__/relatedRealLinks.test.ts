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
 * The numbers are reported, and ratcheted (audit r3): Recall@5 on the real
 * set may not drop below what was measured (14.1%, 69 of 489 pairs on
 * f090c20812), nor dev below its 14.8% (18 of 122). Raise the floors when the
 * ranking gets better; never lower them to make a change pass.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Bm25Index } from "../search/bm25";
import { relatedNotes } from "../related/related";
import { goldVault } from "./fixtures/relatedGold";
// @ts-expect-error plain JavaScript
import { pairsOfItems, realLinkPairs, recallAt, scoreWith } from "../../scripts/golden/evals/related.mjs";
import { createHash } from "node:crypto";

const CORPUS = join(__dirname, "fixtures", "obsidian-corpus");
const manifest = JSON.parse(readFileSync(join(CORPUS, "manifest.json"), "utf8")) as { vaults: Array<{ id: string; files: Array<{ path: string }> }> };
const vaults = manifest.vaults.map((v) => ({
  id: v.id,
  notes: v.files.filter((f) => f.path.endsWith(".md")).map((f) => ({ path: f.path, text: readFileSync(join(CORPUS, v.id, f.path), "utf8") })),
}));

type Pair = { vault: string; from: string; to: string; query: string };

/** The ratchet (W10.B19, audit r3): measured hits, not a percentage picked by hand. */
const REAL_FLOOR = { hit: 69, pairs: 489 };
const DEV_FLOOR = { hit: 18, pairs: 122 };

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
    // The ratchet: the same 489 pairs, at least the 69 hits measured (14.1%).
    expect(real.pairs).toBe(REAL_FLOOR.pairs);
    expect(real.hit).toBeGreaterThanOrEqual(REAL_FLOOR.hit);
    expect(real.recall).toBeGreaterThanOrEqual(0.141); // recallAt rounds to 3 places
    expect(gen.recall).toBe(1);
  });

  it("the related-real golden set: 489 real pairs, its dev items rebuild from the corpus, Recall@5 on dev reported", () => {
    const dir = join(__dirname, "../../eval/golden/related-real");
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as { capability: string; parts: Array<{ id: string; items: number; dev: number; test: number }> };
    const dev = JSON.parse(readFileSync(join(dir, "dev/links.json"), "utf8")) as { items: Array<{ id: string; vault: string; from: string; to: string; query_sha256: string }> };
    const hash = (s: string) => createHash("sha256").update(s).digest("hex");
    expect(manifest.capability).toBe("W10.B19");
    // The pool is every real pair: the set's size is the corpus's, not a number picked by hand.
    expect(manifest.parts[0]).toMatchObject({ id: "links", items: pairs.length });
    expect(manifest.parts[0].dev + manifest.parts[0].test).toBe(pairs.length);
    expect(dev.items).toHaveLength(manifest.parts[0].dev);
    const rebuilt = pairsOfItems(dev.items, vaults, hash) as Pair[];
    expect(rebuilt.map((p) => `${p.vault}:${p.from}→${p.to}`)).toEqual(dev.items.map((it) => it.id));
    const r = scoreWith(Bm25Index, relatedNotes, { items: dev.items, vaults, hash }) as { "recall@5": number; pairs: number };
    console.info(`[W10.B19] related-real dev: Recall@5 ${(r["recall@5"] * 100).toFixed(1)}% over ${r.pairs} pairs`);
    expect(r.pairs).toBe(dev.items.length);
    expect(r.pairs).toBe(DEV_FLOOR.pairs);
    expect(r["recall@5"]).toBeGreaterThanOrEqual(Math.floor((DEV_FLOOR.hit / DEV_FLOOR.pairs) * 1000) / 1000);
    // An item that is not a real link of the corpus, or whose query drifted, is refused.
    const one = dev.items[0];
    expect(() => pairsOfItems([{ ...one, to: "Nowhere.md" }], vaults, hash)).toThrow(/not a link of the corpus/);
    expect(() => pairsOfItems([{ ...one, query_sha256: "0".repeat(64) }], vaults, hash)).toThrow(/query changed/);
  });
});
