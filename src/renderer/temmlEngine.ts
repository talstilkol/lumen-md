/**
 * Temml, when the package is installed (plan W1.3, W10.E77). When it is not,
 * vite.config.ts aliases `temml` to a stub that is null, so this module says
 * it is not available and renderCore uses KaTeX. Loaded only when a note
 * has math (a dynamic import), never at startup.
 */
import temml from "temml";
import { createRehypeTemml, type TemmlLike } from "./temmlCore";

const engine = temml as TemmlLike | null;
export const available = !!engine && typeof engine.renderToString === "function";
export default available ? createRehypeTemml(engine!) : null;
