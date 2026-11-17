/**
 * English strings used only by AbstractDialog.tsx, which loads on demand: they
 * travel with its chunk (src/i18n/lazy/abstractWriter.json) instead of the startup bundle.
 */

import english from "../i18n/lazy/abstractWriter.json";
import { registerEnglish } from "../i18n";

registerEnglish(english);
