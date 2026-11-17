/**
 * English strings used only by the writing-goal status item and dialog, which load on demand:
 * they travel with their chunk (src/i18n/lazy/writingGoals.json) instead of the startup bundle.
 */

import english from "../i18n/lazy/writingGoals.json";
import { registerEnglish } from "../i18n";

registerEnglish(english);
