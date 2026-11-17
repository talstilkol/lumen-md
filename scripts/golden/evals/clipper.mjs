/**
 * Harness for the clipper golden set (plan 4.15, 7.10): the app's
 * extraction (src/research/clipExtract.ts: Defuddle, then Readability,
 * then Turndown — what a clip from the extension goes through) on each
 * saved page, checked against the page's expected article.
 *
 *   score({ items }) → {
 *     "title"        share of pages whose title is the expected one
 *     "author"       share of pages with an expected author whose author matches
 *     "headings"     share of expected headings found in the clip
 *     "paragraphs"   share of expected paragraphs found whole (normalised) in the clip
 *     "order"        share of pages whose paragraphs come in the expected order
 *     "include"      share of mustInclude strings present
 *     "noise.pages"  share of pages with any mustExclude text in the clip (target 0)
 *     "pages"
 *   }
 *
 * Needs a DOM: in Node it takes happy-dom's (a devDependency, the tests'
 * environment). Dev: `node scripts/golden/evals/clipper.mjs --dev`.
 */
import { readFileSync } from "node:fs";

/** Text for comparing: Markdown marks and entities out, quotes and dashes folded, spaces collapsed. */
export function norm(s) {
  return String(s ?? "")
    .normalize("NFKC")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>#]+/g, " ")
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, "$1")
    .replace(/[“”„]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Score `extract(html, url) → { title, author, markdown }` on the items; `read(item)` gives the page's HTML. */
export async function scoreWith(extract, items, read = (it) => readFileSync(it.file, "utf8")) {
  let title = 0;
  let authorN = 0;
  let author = 0;
  let headN = 0;
  let head = 0;
  let paraN = 0;
  let para = 0;
  let ordered = 0;
  let incN = 0;
  let inc = 0;
  let noisy = 0;
  for (const it of items) {
    const exp = it.expected ?? {};
    const out = await extract(read(it), it.url ?? `https://example.org/${it.id}`);
    const body = norm(out.markdown);
    if (norm(out.title) === norm(exp.title)) title++;
    if (exp.author) {
      authorN++;
      if (norm(out.author).includes(norm(exp.author))) author++;
    }
    for (const h of exp.headings ?? []) {
      headN++;
      if (body.includes(norm(h))) head++;
    }
    let last = -1;
    let inOrder = true;
    for (const p of exp.paragraphs ?? []) {
      paraN++;
      const at = body.indexOf(norm(p));
      if (at >= 0) {
        para++;
        if (at < last) inOrder = false;
        last = at;
      } else inOrder = false;
    }
    if (inOrder) ordered++;
    for (const s of exp.mustInclude ?? []) {
      incN++;
      if (body.includes(norm(s))) inc++;
    }
    if ((exp.mustExclude ?? []).some((s) => body.includes(norm(s)))) noisy++;
  }
  const r = (x) => Math.round(x * 10000) / 10000;
  const n = items.length || 1;
  return { title: r(title / n), author: authorN ? r(author / authorN) : 1, headings: headN ? r(head / headN) : 1, paragraphs: paraN ? r(para / paraN) : 1, order: r(ordered / n), include: incN ? r(inc / incN) : 1, "noise.pages": r(noisy / n), pages: items.length };
}

async function loadExtract() {
  const { Window } = await import("happy-dom");
  const w = new Window();
  globalThis.DOMParser ??= w.DOMParser;
  globalThis.Node ??= w.Node;
  globalThis.document ??= w.document;
  const { tsImport } = await import("tsx/esm/api");
  const m = await tsImport("../../../src/research/clipExtract.ts", import.meta.url);
  return (html, url) => m.extractPage(html, url);
}

export async function score({ items }) {
  return scoreWith(await loadExtract(), items);
}

if (process.argv[1]?.endsWith("evals/clipper.mjs") && process.argv.includes("--dev")) {
  const { loadSet } = await import("../../lib/golden.mjs");
  const { GOLDEN } = await import("../common.mjs");
  const { items } = loadSet(GOLDEN, "clipper", { split: "dev" });
  console.log(JSON.stringify({ set: "clipper", split: "dev", ...(await score({ items })) }, null, 2));
}
