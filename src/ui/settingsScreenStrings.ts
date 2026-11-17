/**
 * English strings used only by SettingsScreen.tsx, which loads on demand: they
 * travel with its chunk (src/i18n/lazy/settingsScreen.json) instead of the startup bundle.
 */

import english from "../i18n/lazy/settingsScreen.json";
import searchEnglish from "../i18n/lazy/settingsSearch.json";
import { registerEnglish } from "../i18n";

registerEnglish(english);
// W13.E4: the settings search's result strings and keywords.
registerEnglish(searchEnglish);
