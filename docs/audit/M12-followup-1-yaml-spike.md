# M12-followup-1 — `yaml/parse` vs full `yaml` spike

## Question

Can we swap full `yaml` for parse-only to save ~10 KB gzipped on main?

## Finding

**No safe swap available.** The `yaml` package's `exports` field only
exposes `.` (the full API) and `./util`. There's no `yaml/parse` entry
point.

Inspecting the source map confirms: 71 files of `yaml/browser/dist/`
ship in main, including `stringify/` files that we never call. Vite's
tree-shaking can't prune them because the `yaml` package's main entry
re-exports both `parse` and `stringify`, and `Document.toString()`
(which we don't call but which is on the class) pulls the stringify
graph at class evaluation time.

## Options considered

### Option 1: Swap to `js-yaml` (~30 KB raw, smaller)
**Rejected.** Different YAML semantics (1.1 vs 1.2), different API
shape, would require touching every YAML.parse() call site + the
existing test suite. Saves ~7 KB gzipped at best; cost of behavioural
risk + porting effort exceeds the value.

### Option 2: Hand-rolled minimal frontmatter parser
**Rejected.** Most Lumen frontmatter is simple key-value YAML, but
"most" isn't "all" — wiki-link targets, structured tags, and nested
metadata can be complex. Maintaining a parallel parser is a
maintenance trap.

### Option 3: Lazy-load `yaml` from pipeline.ts
**Rejected.** `extractFrontmatter` and `extractToc` are called
synchronously by the Outline panel + tags panel + wiki-link
resolution. Converting all those call sites to async is a
large-surface refactor for marginal savings.

### Option 4: Accept the cost
**Selected.** After lazy-loading rehype-raw (M12-followup-2 saved
49 KB), the main bundle is at 178 KB / 195 KB budget. The 17 KB of
headroom + the marginal nature of the yaml win (~7-12 KB) means it's
not worth the risk-adjusted effort.

## Recommendation

Leave `yaml` as-is. Revisit only if main bundle approaches the budget
ceiling again, OR if Vite's tree-shaking gets smarter about
cross-module-boundary dead-code elimination, OR if the `yaml`
maintainers publish a `yaml/parse` entry point upstream.

## Bonus finding

The `yaml/browser/dist/` files use ESM `require()` calls visible in
the bundle (271 KB of source). This means `yaml` ships its CommonJS
build to the browser. The package's `exports.browser.import` field
could be pointing to a real ESM build that tree-shakes better. Worth
filing an upstream issue if you want this optimised.
