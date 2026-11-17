/**
 * English strings of the visualisations (plan W12.V1–V6), which load on
 * demand: they travel with the viz chunk (src/i18n/lazy/viz.json) instead of
 * the startup bundle. Everything in src/viz is reached through a dynamic
 * import only.
 */

import english from "../i18n/lazy/viz.json";
import { registerEnglish } from "../i18n";

registerEnglish(english);
