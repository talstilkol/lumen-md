/**
 * English strings used only by claimsAction, which loads on demand: they travel
 * with its chunk (src/i18n/lazy/claimsAction.json) instead of the startup bundle.
 */

import english from "../../i18n/lazy/claimsAction.json";
import { registerEnglish } from "../../i18n";

registerEnglish(english);
