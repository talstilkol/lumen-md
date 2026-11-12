/**
 * The embed placeholder's English strings (plan W4.15) travel with its lazy
 * chunk (src/i18n/lazy/contentFrame.json) instead of the startup bundle.
 * Imported for its side effect by src/renderer/RemoteFrame.tsx, which is
 * only loaded with a dynamic import.
 */

import english from "../i18n/lazy/contentFrame.json";
import { registerEnglish } from "../i18n";

registerEnglish(english);
