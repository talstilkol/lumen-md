/**
 * The academic export dialog's strings (plan W5.16) travel with its lazy
 * chunk (src/i18n/lazy/academic.json) instead of the startup bundle.
 * Imported for its side effect by ./AcademicExportDialog and by the academic
 * calendar (src/academic/app.ts, W7.8), both only ever loaded with a
 * dynamic import.
 */

import english from "../i18n/lazy/academic.json";
import { registerEnglish } from "../i18n";

registerEnglish(english);
