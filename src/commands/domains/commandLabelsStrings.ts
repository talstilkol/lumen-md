/**
 * English labels and toasts used only by the palette's command domains
 * (./index.ts and the builders it imports), which load after the first paint
 * (plan 0.2, ../sectionsLoader.ts): they travel with that chunk
 * (src/i18n/lazy/commandLabels.json) instead of the startup bundle (F14).
 */

import english from "../../i18n/lazy/commandLabels.json";
import { registerEnglish } from "../../i18n";

registerEnglish(english);
