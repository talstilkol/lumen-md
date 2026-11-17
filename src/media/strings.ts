/**
 * The media embed's English strings travel with its lazy chunk
 * (src/i18n/lazy/media.json) instead of the startup bundle.
 */
import english from "../i18n/lazy/media.json";
import { registerEnglish } from "../i18n";

registerEnglish(english);
