/**
 * English strings used only by WritingChecksDialog.tsx, which loads on demand: they
 * travel with its chunk (src/i18n/lazy/writingChecksDialog.json) instead of the startup bundle.
 */

import english from "../i18n/lazy/writingChecksDialog.json";
import { registerEnglish } from "../i18n";

registerEnglish(english);
