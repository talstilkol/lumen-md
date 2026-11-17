/**
 * The native menu bar's English strings (plan W13.K5) travel with the
 * desktop shell's lazy chunk (src/i18n/lazy/nativeMenu.json), never the
 * startup bundle; nativeMenu.ts loads only on the desktop.
 */

import english from "../i18n/lazy/nativeMenu.json";
import { registerEnglish } from "../i18n";

registerEnglish(english);
