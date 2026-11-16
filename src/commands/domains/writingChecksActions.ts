/**
 * The flows behind the writing commands that need more than a dialog
 * (wave 13): loaded on demand from the palette.
 */
import { t } from "../../i18n";
import { showAiToast } from "../../ui/AiToast";
import { isAbort } from "../../ai/aiAbort";
import { explainError } from "../../lib/userError";
import { useAppStore } from "../../store/useStore";
import { cancellable } from "./context";

interface Target {
  getContent: () => string;
  path: string | null;
  lang: "he" | "en";
}

/** W13.W13: pick an older version from the note's history and explain the change to now. */
export async function explainChangeFlow(tg: Target): Promise<void> {
  const doc = useAppStore.getState().doc;
  const [{ listSnapshots, historyKey }, { uiSelect }] = await Promise.all([import("../../storage/history"), import("../../ui/PromptDialog")]);
  const now = tg.getContent();
  const versions = (await listSnapshots(historyKey(doc))).filter((s) => s.content !== now).slice(0, 50);
  if (!versions.length) {
    showAiToast(t("toast.explainChangeNoHistory"), "info");
    return;
  }
  const fmt = new Intl.DateTimeFormat(tg.lang === "he" ? "he-IL" : undefined, { dateStyle: "medium", timeStyle: "short" });
  const pick = await uiSelect({ message: t("toast.explainChangePick"), choices: versions.map((v) => ({ value: String(v.id), label: fmt.format(v.timestamp) })) });
  const older = versions.find((v) => String(v.id) === pick);
  if (!older) return;
  try {
    const [{ explainChange, explainChangeAgent }, { runAgent, AgentRunError }] = await Promise.all([import("../../agents/writing/explainChange"), import("../../agents/runtime")]);
    showAiToast(t("toast.explainChangeWorking"), "info");
    const r = await cancellable((signal) =>
      explainChange(older.content, now, {
        lang: tg.lang,
        signal,
        // The local model writes the summary; without one (or if it fails) the rules do.
        model: async (input) => {
          try {
            const run = await runAgent(explainChangeAgent, input, { signal });
            if (run.status !== "ok" || !run.output) throw new AgentRunError(run, run.error ?? run.status);
            return run.output;
          } catch (e) {
            if (isAbort(e)) throw e;
            return "";
          }
        },
      }),
    );
    const { openExplainChangeDialog } = await import("../../ui/ExplainChangeDialog");
    openExplainChangeDialog(r, fmt.format(older.timestamp), tg.lang);
  } catch (e) {
    if (isAbort(e)) return;
    showAiToast(t("toast.explainChangeFailed", { error: explainError(e) }), "error");
  }
}
