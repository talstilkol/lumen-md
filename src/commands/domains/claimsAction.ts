/**
 * `ai.claims` (R12.11): the paragraph at the cursor (or the selected text)
 * → candidate claims, each with the verifier's quote, proposed as a
 * `[!claims]` callout under the paragraph. The AI suggests and the user
 * approves: the callout is staged for review (agents/staging, the review
 * panel's diff with approve / reject), never written straight into the
 * note; approving it applies it as AI-authored text in one undoable edit.
 * Nothing becomes a fact: the callout lists candidates, and the toast says
 * how many were dropped.
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
    // Staged, not dispatched: the review panel shows the insertion as a diff, and only its approval writes it,
    // marked as AI text (reviewBridge applies approved changes with aiAuthored, 5.9 / W10.E37).
    const [{ stageChange, rangeContext, textFingerprint }, { currentDocumentKey }] = await Promise.all([import("../../agents/staging"), import("../../agents/docKey")]);
    stageChange(
      {
        kind: "range",
        path: doc.workspaceName ?? null,
        from: p.end,
        to: p.end,
        before: "",
        after: `\n\n${callout}`,
        context: rangeContext(content, p.end, p.end),
        basis: textFingerprint(content),
        docKey: currentDocumentKey(),
        summary: callout.split("\n")[0].replace(/^>\s*\[!claims\]\s*/, ""),
      },
      { tool: "insert_claims", agentId: claimExtractorAgent.id, runId: `claims-${Date.now().toString(36)}` },
    );
    showAiToast(t("toast.claimsDone", { defaultValue: "{{kept}} candidate claims · {{dropped}} dropped without a quote", kept: r.claims.length, dropped: r.dropped.length }), "success");
  } catch (e) {
    if (isAbort(e)) return;
    if ((await import("../../agents/suggestions")).reportAgentFailure(e, "ai.claims")) return;
    showAiToast(t("toast.claimsFailed", { defaultValue: "Could not extract claims: {{error}}", error: explainError(e) }), "error");
  }
}
