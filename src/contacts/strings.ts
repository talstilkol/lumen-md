/**
 * The vCard commands' English strings travel with their lazy chunk
 * (src/i18n/lazy/contacts.json) instead of the startup bundle.
 */
import english from "../i18n/lazy/contacts.json";
import { registerEnglish } from "../i18n";

registerEnglish(english);
