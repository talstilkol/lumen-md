/**
 * English of the commands' hints (the second line under a command in the
 * palette, the toolbar's menus and the AI button's list): they travel in
 * this chunk (src/i18n/lazy/cmdHints.json) instead of the startup bundle.
 * The palette imports it; commands/hints.ts loads it for the toolbar and
 * the AI button, on idle time or when one of their menus opens.
 */

import english from "../i18n/lazy/cmdHints.json";
import { registerEnglish } from "../i18n";

registerEnglish(english);
