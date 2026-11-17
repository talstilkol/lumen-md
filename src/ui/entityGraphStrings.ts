/**
 * English strings used only by the entity graph's panels (W12.E5–E7),
 * which load on demand: they travel with their chunk
 * (src/i18n/lazy/entityGraph.json) instead of the startup bundle.
 */

import english from "../i18n/lazy/entityGraph.json";
import { registerEnglish } from "../i18n";

registerEnglish(english);
