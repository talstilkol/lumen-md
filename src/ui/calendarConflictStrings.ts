/**
 * English strings used only by CalendarConflictDialog, which loads on demand: they travel
 * with its chunk (src/i18n/lazy/calendarConflict.json) instead of the startup bundle.
 */

import english from "../i18n/lazy/calendarConflict.json";
import { registerEnglish } from "../i18n";

registerEnglish(english);
