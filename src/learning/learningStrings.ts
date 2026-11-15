/**
 * English strings used only by the learning plans dialog (plan W12.H4),
 * which loads on demand: they travel with its chunk
 * (src/i18n/lazy/learning.json) instead of the startup bundle.
 */
import english from "../i18n/lazy/learning.json";
import { registerEnglish } from "../i18n";

registerEnglish(english);
