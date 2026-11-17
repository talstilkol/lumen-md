/**
 * Plan W10.B19 (audit W2.2): a "related notes" gold set derived from REAL
 * notes. The public Obsidian vaults of plan W4.30
 * (src/__tests__/fixtures/obsidian-corpus, byte-for-byte copies at pinned
 * commits, licences in its manifest) link their notes to each other. A note
 * A that links to a note B in the same vault is a gold pair: B is related
 * to A. The link is removed from A's text before A is used as the query,
 * so the link itself can't give the answer away.
 *
 * Plain JavaScript; the test passes the app's index class and relatedNotes in.
 */

/** [[Target]], [[Target|alias]], [[Target#heading]] (not embeds), and [text](Target.md). */
const WIKI = /(?<!!)\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]/g;
const MDLINK = /(?<!!)\[[^\]]*\]\(<?([^)>\s]+\.md)>?(?:#[^)]*)?\)/g;

const baseName = (p) => decodeURIComponent(p).split("/").pop().replace(/\.md$/i, "").trim().toLowerCase();

/**
 * Gold pairs from real links.
 * @param {Array<{ id: string, notes: Array<{ path: string, text: string }> }>} vaults
 * @returns {Array<{ vault: string, from: string, to: string, query: string }>}
 */
export function realLinkPairs(vaults, { minWords = 8 } = {}) {
  const pairs = [];
  for (const v of vaults) {
    const byName = new Map();
    for (const n of v.notes) {
      const k = baseName(n.path);
      byName.set(k, byName.has(k) ? null : n.path); // null: two notes share the name, skip
    }
    for (const a of v.notes) {
      const targets = new Map();
      for (const m of a.text.matchAll(WIKI)) targets.set(baseName(m[1]), true);
      for (const m of a.text.matchAll(MDLINK)) if (!/^[a-z]+:/i.test(m[1])) targets.set(baseName(m[1]), true);
      for (const name of targets.keys()) {
        const to = byName.get(name);
        if (!to || to === a.path) continue;
        // Remove every link to B from A, keeping the rest of A as it is.
        const query = a.text
          .replace(WIKI, (all, t) => (baseName(t) === name ? "" : all))
          .replace(MDLINK, (all, t) => (baseName(t) === name ? "" : all));
        if (query.split(/\s+/).filter(Boolean).length < minWords) continue;
        pairs.push({ vault: v.id, from: a.path, to, query });
      }
    }
  }
  return pairs;
}

/**
 * Recall@k of `related(index, text, { self, limit })` on the pairs, one
 * index per vault (a note is related within its own vault).
 */
export function recallAt(Index, related, vaults, pairs, k = 5) {
  const indexes = new Map();
  for (const v of vaults) {
    const index = new Index();
    for (const n of v.notes) index.set(n.path, n.text, baseName(n.path));
    indexes.set(v.id, index);
  }
  let hit = 0;
  const perVault = {};
  for (const p of pairs) {
    const got = related(indexes.get(p.vault), p.query, { self: p.from, limit: k }).map((h) => h.path);
    const ok = got.includes(p.to);
    if (ok) hit++;
    const pv = (perVault[p.vault] ??= { pairs: 0, hit: 0 });
    pv.pairs++;
    if (ok) pv.hit++;
  }
  return { pairs: pairs.length, hit, recall: pairs.length ? Math.round((hit / pairs.length) * 1000) / 1000 : 0, perVault };
}

/**
 * The related-real golden set's items (eval/golden/related-real: vault,
 * from, to, query_sha256) back to pairs with their query, rebuilt from the
 * corpus. An item whose pair is no longer a real link of the corpus, or
 * whose query changed, is refused: the score would not be the set's.
 * `hash` is sha256 (hex) of a string.
 */
export function pairsOfItems(items, vaults, hash) {
  const byId = new Map(realLinkPairs(vaults).map((p) => [`${p.vault}:${p.from}→${p.to}`, p]));
  return items.map((it) => {
    const p = byId.get(`${it.vault}:${it.from}→${it.to}`);
    if (!p) throw new Error(`related-real: ${it.id} is not a link of the corpus`);
    if (hash(p.query) !== it.query_sha256) throw new Error(`related-real: ${it.id}: its query changed (corpus drift)`);
    return p;
  });
}

/** Score the set with the app's index class and relatedNotes: { "recall@5": … } over the items given. */
export function scoreWith(Index, related, { items, vaults, hash }) {
  const pairs = pairsOfItems(items, vaults, hash);
  const r = recallAt(Index, related, vaults, pairs, 5);
  return { "recall@5": r.recall, pairs: r.pairs };
}

/** Build one TypeScript module of the app through Vite, in memory (CI only). */
async function bundle(rel) {
  const { build } = await import("vite");
  const { fileURLToPath } = await import("node:url");
  const out = await build({ configFile: false, logLevel: "silent", build: { write: false, minify: false, lib: { entry: fileURLToPath(new URL(rel, import.meta.url)), formats: ["es"], fileName: "m" } } });
  const chunk = (Array.isArray(out) ? out[0] : out).output.find((o) => o.type === "chunk");
  return import(`data:text/javascript;base64,${Buffer.from(chunk.code).toString("base64")}`);
}

/** run-evals.mjs entry: Recall@5 of the app's related notes on the test split. */
export async function score({ items }) {
  const [{ Bm25Index }, { relatedNotes }, { corpusVaults }, { sha256 }] = await Promise.all([bundle("../../../src/search/bm25.ts"), bundle("../../../src/related/related.ts"), import("../sets/related-real.mjs"), import("../fetch.mjs")]);
  const { "recall@5": recall } = scoreWith(Bm25Index, relatedNotes, { items, vaults: corpusVaults(), hash: sha256 });
  return { "recall@5": recall };
}
