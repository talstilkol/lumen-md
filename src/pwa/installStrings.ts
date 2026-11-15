/**
 * English strings used only by InstallDialog, which loads on demand: they travel
 * with its chunk (src/i18n/lazy/install.json) instead of the startup bundle.
 */

import english from "../i18n/lazy/install.json";
import { registerEnglish } from "../i18n";

registerEnglish(english);
