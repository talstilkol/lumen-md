/**
 * English strings of the reading list's commands (plan W12.X2), used only
 * by commands/domains/readingActions.ts, which loads on use: they travel
 * with its chunk (src/i18n/lazy/readingList.json), not the startup bundle.
 */

import english from "../i18n/lazy/readingList.json";
import { registerEnglish } from "../i18n";

registerEnglish(english);
