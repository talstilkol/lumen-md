/**
 * `ai.claims` (R12.11): the paragraph at the cursor (or the selected text)
 * → candidate claims, each with the verifier's quote, inserted under the
 * paragraph as a `[!claims]` callout in one undoable edit. Nothing becomes a
 * fact: the callout lists candidates, and the toast says how many were
 * dropped.
 */
import { t } from "../../i18n";
import { showAiToast } from "../../ui/AiToast";
import { isAbort } from "../../ai/aiAbort";
import { hasHebrew } from "../../text/hebrew";
import { explainError } from "../../lib/userError";
import { cancellable, type CommandContext } from "./context";
import "./claimsActionStrings";

export async function claimsFlow({ getEditorView, liveDoc }: Pick<CommandContext, "getEditorView" | "liveDoc">): Promise<void> {
  const view = getEditorView?.();
  if (!view) return;
  const doc = liveDoc();
  const [{ extractClaims, claimExtractorAgent, claimsCallout, paragraphAt }, { runAgent, AgentRunError }] = await Promise.all([import("../../agents/defs/claimExtractor"), import("../../agents/runtime")]);
  const content = view.state.doc.toString();
  const p = paragraphAt(content, view.state.selection.main.head);
  if (!p) {
    showAiToast(t("toast.claimsNoParagraph", { defaultValue: "Put the cursor in a paragraph first." }), "info");
    return;
  }
  try {
    showAiToast(t("toast.claimsExtracting", { defaultValue: "Turning the paragraph into claims…" }), "info");
    const r = await cancellable((signal) =>
      extractClaims(p.text, { note: doc.workspaceName ?? doc.name, anchor: p.anchor }, async (input) => {
        const run = await runAgent(claimExtractorAgent, input, { signal, document: content });
        if (run.status !== "ok" || !run.output) throw new AgentRunError(run, run.error ?? run.status);
        return { output: run.output, model: run.model };
      }),
    );
    const callout = claimsCallout(r, hasHebrew(p.text) ? "he" : "en");
    // The callout is the model's output: marked as AI text at the insertion (5.9, W10.E37).
    const { aiAuthored } = await import("../../editor/aiAuthorship");
    view.dispatch({ changes: { from: p.end, insert: `\n\n${callout}` }, annotations: aiAuthored.of(true) });
    showAiToast(t("toast.claimsDone", { defaultValue: "{{kept}} candidate claims · {{dropped}} dropped without a quote", kept: r.claims.length, dropped: r.dropped.length }), "success");
  } catch (e) {
    if (isAbort(e)) return;
    if ((await import("../../agents/suggestions")).reportAgentFailure(e, "ai.claims")) return;
    showAiToast(t("toast.claimsFailed", { defaultValue: "Could not extract claims: {{error}}", error: explainError(e) }), "error");
  }
}
