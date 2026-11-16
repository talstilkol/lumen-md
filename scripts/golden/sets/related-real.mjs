/**
 * Plan W10.B19 (audit W2.2): the related-real golden set — gold pairs from
 * the links real people wrote between their notes, in the public Obsidian
 * vaults of plan W4.30 (src/__tests__/fixtures/obsidian-corpus). A note A
 * that links to B makes B related to A; the link is removed from A before
 * A is the query (scripts/golden/evals/related.mjs, realLinkPairs).
 *
 * An item is the pair and the sha256 of its query, never the text: the
 * corpus is committed, and the harness rebuilds each query from it and
 * refuses one that no longer matches (a corpus that drifted).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { splitPool } from "../../lib/golden.mjs";
import { ROOT } from "../common.mjs";
import { sha256 } from "../fetch.mjs";
import { realLinkPairs } from "../evals/related.mjs";

export const CORPUS_DIR = "src/__tests__/fixtures/obsidian-corpus";

/** The corpus vaults, every Markdown note with its text. */
export function corpusVaults(root = ROOT) {
  const dir = join(root, CORPUS_DIR);
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  return manifest.vaults.map((v) => ({
    id: v.id,
    notes: v.files.filter((f) => f.path.endsWith(".md")).map((f) => ({ path: f.path, text: readFileSync(join(dir, v.id, f.path), "utf8") })),
  }));
}

/** An item's id: the pair itself, readable. */
export const pairId = (p) => `${p.vault}:${p.from}→${p.to}`;

/** Every real-link pair of the corpus as an item. */
export function realLinkItems(vaults = corpusVaults()) {
  return realLinkPairs(vaults).map((p) => ({ id: pairId(p), vault: p.vault, from: p.from, to: p.to, query_sha256: sha256(p.query) }));
}

export const realLinks = {
  pool() {
    return { items: realLinkItems(), manifestSha: sha256(readFileSync(join(ROOT, CORPUS_DIR, "manifest.json"))) };
  },
  select(pool, opts) {
    return splitPool(pool.items, opts);
  },
  meta: (pool) => ({
    source: {
      sampling: `every link A → B inside one vault of ${CORPUS_DIR} (${pool.items.length} pairs: unique target name, query of at least 8 words once the links to B are removed); the dev seed picks the dev pairs`,
      files: { [`${CORPUS_DIR}/manifest.json`]: pool.manifestSha },
    },
    fields: {
      vault: "the corpus vault (its folder under the corpus)",
      from: "the linking note A (the query, with every link to B removed)",
      to: "the linked note B (the gold related note)",
      query_sha256: "sha256 of A's text with its links to B removed; the harness rebuilds it from the corpus and checks it",
    },
  }),
};
