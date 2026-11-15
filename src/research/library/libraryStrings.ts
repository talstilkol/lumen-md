/**
 * English strings used only by the library panel, which loads on demand:
 * they travel with its chunk (src/i18n/lazy/library.json) instead of the
 * startup bundle.
 */
import english from "../../i18n/lazy/library.json";
import { registerEnglish } from "../../i18n";

registerEnglish(english);
