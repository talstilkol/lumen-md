/**
 * English strings used only by the out-of-support notice (plan W13.T2),
 * which loads on demand: they travel with its chunk (src/i18n/lazy/supportNotice.json).
 */
import english from "../i18n/lazy/supportNotice.json";
import { registerEnglish } from "../i18n";

registerEnglish(english);
