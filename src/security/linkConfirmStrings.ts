/**
 * English strings of the link confirmation (W13.X5), which loads on demand: they travel with its chunk
 * (src/i18n/lazy/linkConfirm.json) instead of the startup bundle.
 */

import english from "../i18n/lazy/linkConfirm.json";
import { registerEnglish } from "../i18n";

registerEnglish(english);
