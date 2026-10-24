/**
 * size-limit per main chunk (plan 0.19). Gzip, the same measure as
 * scripts/bundle-budget.mjs, whose budgets these limits mirror; the Danger
 * job comments the table on every PR and fails over a limit.
 *
 *   npm run build && npm run size              check
 *   npm run size -- --json > size-limit.json   the input of dangerfile.ts
 *
 * The startup total (≤ 460 KB, every script index.html loads) stays in
 * bundle-budget.mjs: it is a sum over files named in the HTML, which
 * size-limit cannot express. A chunk name that matches no file fails.
 */
const chunk = (name, file, limit) => ({ name, path: `dist/assets/${file}`, limit, gzip: true, brotli: false });

module.exports = [
  chunk("app (startup runtime)", "app-*.js", "195 KB"),
  chunk("main (entry stub)", "main-*.js", "5 KB"),
  chunk("index (entry)", "index-*.js", "220 KB"),
  chunk("vendor: react", "vendor-react-*.js", "160 KB"),
  chunk("vendor: codemirror", "vendor-codemirror-*.js", "600 KB"),
  chunk("vendor: milkdown", "vendor-milkdown-*.js", "200 KB"),
  chunk("vendor: shiki", "vendor-shiki-*.js", "320 KB"),
  chunk("vendor: katex", "vendor-katex-*.js", "110 KB"),
  chunk("vendor: mermaid", "vendor-mermaid-*.js", "860 KB"),
  chunk("vendor: yjs", "vendor-yjs-*.js", "180 KB"),
];
