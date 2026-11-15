/**
 * The "Inbox: sort with the local model" command (plan W10.C21): the inbox
 * is triaged by a local structured engine (capture/triage) and the result is
 * staged as one change for the review panel. Nothing is written until the
 * user approves it there. Loaded on use.
 */
import { t } from "../i18n";
import { toast } from "../store/useToastStore";
import { explainError } from "../lib/userError";
import { readWorkspaceFile, workspaceHasFile } from "../storage/workspace";
import { stageChange } from "../agents/staging";
import { StructuredOutputError } from "../ai/structured";
import { triageInbox } from "./triage";
import "./strings";

const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export async function triageInboxFlow(): Promise<void> {
  try {
    // quickCapture loads on use too (its strings are lazy): a dynamic import keeps it that way.
    const { INBOX_PATH } = await import("./quickCapture");
    if (!(await workspaceHasFile(INBOX_PATH))) {
      toast.info(t("capture.triage.empty"));
      return;
    }
    const before = await readWorkspaceFile(INBOX_PATH);
    toast.info(t("capture.triage.running"));
    const r = await triageInbox(before, localDay());
    if (!r.changed) {
      toast.info(r.failed ? t("capture.triage.failedSome", { count: r.failed }) : t("capture.triage.nothing"));
      return;
    }
    stageChange({ kind: "file", path: INBOX_PATH, before, after: r.after, summary: t("capture.triage.summary", { count: r.changed, engine: r.engines.join(", ") }) }, { tool: "triage_inbox", agentId: "inbox-triage" });
    window.dispatchEvent(new CustomEvent("lumen-open-agent-review"));
  } catch (e) {
    if (e instanceof StructuredOutputError) toast.error(t("capture.triage.noModel"));
    else toast.error(t("capture.failed", { error: explainError(e) }));
  }
}
