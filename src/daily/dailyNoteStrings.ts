/**
 * English strings used only by dailyNote.ts, which loads on demand: they
 * travel with its chunk (src/i18n/lazy/dailyNote.json) instead of the startup bundle.
 */

import english from "../i18n/lazy/dailyNote.json";
import { registerEnglish } from "../i18n";

registerEnglish(english);
