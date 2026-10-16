/**
 * KaTeX rehype plugin, split out of the eager pipeline (A7 lever 1/3).
 *
 * Imported dynamically by `pipeline.ts` so `vendor-katex` (~84 KB gz) is no
 * longer a static dependency of the main chunk. The import ORDER below is
 * load-bearing: katex must evaluate before mhchem mutates its internals,
 * otherwise the production chunk hits a TDZ error ("Cannot access 'xn'
 * before initialization") — see the vendor-katex note in vite.config.ts.
 */
import "katex";
// Side-effect import: registers \ce{}/\pu{} macros on KaTeX
import "katex/contrib/mhchem";
import rehypeKatex from "rehype-katex";

export default rehypeKatex;
