/**
 * English strings used only by ExplainChangeDialog.tsx, which loads on demand: they
 * travel with its chunk (src/i18n/lazy/explainChange.json) instead of the startup bundle.
 */

import english from "../i18n/lazy/explainChange.json";
import { registerEnglish } from "../i18n";

registerEnglish(english);
