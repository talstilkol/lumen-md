/**
 * What `temml` resolves to when the package is not installed (plan W1.3,
 * W10.E77; vite.config.ts aliases it here, as it does y-websocket): no
 * renderer, so src/renderer/temmlEngine.ts says it is not available and the
 * preview uses KaTeX.
 */
const missing: null = null;
export default missing;
