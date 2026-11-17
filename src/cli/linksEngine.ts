/**
 * The entry `mcp-server/scripts/bundle-bases.mjs` bundles into
 * `mcp-server/dist/links-engine.js` (plan W13.K1): the app's own link
 * rewrite and name key, so `lumen move` changes links exactly as moving a
 * note in the app does. Pure: no workspace, no store, no DOM.
 */
export { rewriteLinks } from "../storage/linkRewriteCore";
export { noteKey } from "../lib/slug";
