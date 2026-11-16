/**
 * English strings of the calendar connections (W10.C4–C6: Settings →
 * Calendar, the conflict dialog, the daily note's calendar block), which
 * all load on demand: they travel with their chunk
 * (src/i18n/lazy/calendarSettings.json) instead of the startup bundle.
 */

import english from "../i18n/lazy/calendarSettings.json";
import { registerEnglish } from "../i18n";

registerEnglish(english);
