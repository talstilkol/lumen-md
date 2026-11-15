/**
 * English strings used only by MonitoringSettings, which loads on demand: they travel
 * with its chunk (src/i18n/lazy/monitoringSettings.json) instead of the startup bundle.
 */

import english from "../i18n/lazy/monitoringSettings.json";
import { registerEnglish } from "../i18n";

registerEnglish(english);
