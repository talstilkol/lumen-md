/**
 * The clip templates editor's English strings (plan 4.15, W10.E67) travel with
 * its lazy chunk (src/i18n/lazy/clipTemplates.json). Imported for its side
 * effect by ClipTemplatesEditor.tsx; the command name stays in the startup bundle.
 */
import english from "../i18n/lazy/clipTemplates.json";
import { registerEnglish } from "../i18n";

registerEnglish(english);
