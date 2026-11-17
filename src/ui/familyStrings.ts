/**
 * English of the family tree and GEDCOM (W13.G7): it travels with the
 * entity graph's chunk (src/i18n/lazy/family.json), not the startup bundle.
 */
import english from "../i18n/lazy/family.json";
import { registerEnglish } from "../i18n";

registerEnglish(english);
