/**
 * The "Fill references from OpenAlex" action on the open note (plan
 * W12.X3), shared by ⌘K (`cite.fillReferencesOpenAlex`) and the
 * properties panel's button. Loaded on use.
 *
 * Only the saved text is looked at and proposed on: a note with unsaved
 * edits is asked to be saved first, so the proposal's base is the file the
 * review queue checks before it writes.
 */
import { t } from "../i18n";
import { useAppStore } from "../store/useStore";
import { uiAlert } from "../ui/PromptDialog";
import { showAiToast } from "../ui/AiToast";
import { explainError } from "../lib/userError";
import { fillReferencesFromOpenAlex, sourceDoi, type FillResult } from "./fillReferences";
import type { LookupOptions } from "./openAlexLookup";
import "./openAlexStrings";

export type FillOutcome = FillResult["status"] | "unsaved" | "failed";

export async function fillReferencesForOpenNote(opts: Pick<LookupOptions, "ask" | "fetch"> = {}): Promise<FillOutcome> {
  const doc = useAppStore.getState().doc;
  if (!sourceDoi(doc.content)) {
    await uiAlert({ message: t("openAlex.fill.noDoi") });
    return "no-doi";
  }
  const path = doc.workspaceName;
  if (!path || doc.dirty) {
    await uiAlert({ message: t("openAlex.fill.saveFirst") });
    return "unsaved";
  }
  try {
    const [{ readWorkspaceFile }, { autofillQueue, openAutofillPanel }] = await Promise.all([import("../storage/workspace"), import("../ui/AutofillPanel")]);
    const text = await readWorkspaceFile(path);
    const r = await fillReferencesFromOpenAlex({ path, text }, autofillQueue(), opts);
    switch (r.status) {
      case "no-doi":
        await uiAlert({ message: t("openAlex.fill.noDoi") });
        break;
      case "off":
        await uiAlert({ message: t("openAlex.fill.off") });
        break;
      case "declined":
        break; // why: the user said no; nothing was sent, nothing to say
      case "unchanged":
        showAiToast(t("openAlex.fill.unchanged"), "info");
        break;
      case "queued":
        openAutofillPanel();
        showAiToast(t("openAlex.fill.queued", { n: r.added }), "success");
        break;
    }
    return r.status;
  } catch (e) {
    showAiToast(t("openAlex.fill.failed", { error: explainError(e) }), "error");
    return "failed";
  }
}
