/** English of the immersive reader (plan W13.R5), shipped with its lazy chunk. */
import { registerEnglish } from "../i18n";
import strings from "../i18n/lazy/immersive.json";
import modeStrings from "../i18n/lazy/readingMode.json";

registerEnglish(strings);
// The line-focus names are the reading menu's.
registerEnglish(modeStrings);
