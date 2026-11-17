/**
 * English strings of the system-search switch in Settings → Privacy (plan
 * W13.K3), which loads on demand: they travel with that chunk
 * (src/i18n/lazy/osSearch.json) instead of the startup bundle.
 */
import english from "../i18n/lazy/osSearch.json";
import { registerEnglish } from "../i18n";

registerEnglish(english);
