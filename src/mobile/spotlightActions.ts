/**
 * The palette's "Spotlight and Siri: which notes…" (plan W13.M3): off →
 * recent → all → off. Loaded when the command runs.
 */
import { t } from "../i18n";
import { showAiToast } from "../ui/AiToast";
import "./spotlightStrings";
import { SPOTLIGHT_KEY, spotlightMode, type SpotlightMode } from "./spotlightIndex";

const NEXT: Record<SpotlightMode, SpotlightMode> = { off: "recent", recent: "all", all: "off" };

export function chooseSpotlightMode(storage: Pick<Storage, "getItem" | "setItem"> | null = localStorage): SpotlightMode {
  const next = NEXT[spotlightMode(storage)];
  try {
    storage?.setItem(SPOTLIGHT_KEY, next);
  } catch {
    // why: storage blocked: the choice cannot be kept, so nothing is indexed
    showAiToast(t("spotlight.notSaved"), "error");
    return "off";
  }
  window.dispatchEvent(new CustomEvent("lumen-spotlight-changed"));
  showAiToast(t(`spotlight.mode.${next}`), "info");
  return next;
}
