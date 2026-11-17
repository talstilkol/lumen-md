/**
 * English strings used only by the document scanner (plan W13.M4), which
 * loads on demand: they travel with its chunk (src/i18n/lazy/docScan.json).
 */
import english from "../i18n/lazy/docScan.json";
import { registerEnglish } from "../i18n";

registerEnglish(english);
