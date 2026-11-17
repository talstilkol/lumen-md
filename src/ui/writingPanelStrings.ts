/**
 * English strings used only by the writing suggestions panel and the writing
 * commands' bodies, which load on demand: they travel with that chunk
 * (src/i18n/lazy/writingPanel.json) instead of the startup bundle.
 */

import english from "../i18n/lazy/writingPanel.json";
import { registerEnglish } from "../i18n";

registerEnglish(english);
