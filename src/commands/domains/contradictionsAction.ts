/**
 * `entities.contradictions` (R12.10): the contradiction finder over the
 * vault (no model), its report staged in the review panel, which opens.
 * Loaded on demand from the palette.
 */
import { t } from "../../i18n";
import { showAiToast } from "../../ui/AiToast";
import { explainError } from "../../lib/userError";

export async function findContradictionsFlow(): Promise<void> {
  try {
    const { runContradictor } = await import("../../agents/contradictor");
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const { candidates } = await runContradictor({ today });
    showAiToast(t("cmd.entities.contradictions.done", { n: String(candidates.length) }), "info");
    window.dispatchEvent(new Event("lumen-open-agent-review"));
  } catch (e) {
    showAiToast(t("cmd.entities.contradictions.failed", { error: explainError(e) }), "error");
  }
}
