/**
 * The file viewers' English strings travel with their lazy chunk
 * (src/i18n/lazy/fileViewer.json) instead of the startup bundle. Imported
 * for its side effect by the modules that show them.
 */
import english from "../i18n/lazy/fileViewer.json";
import { registerEnglish } from "../i18n";

registerEnglish(english);
