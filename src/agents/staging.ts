/**
 * Staged changes — what agent write tools produce instead of writing.
 *
 * An agent never changes a file or the open document by itself. A write
 * tool (`write_file`, `set_frontmatter`, `replace_range`) computes the
 * change and the runtime stages it here; the user approves or rejects it,
 * and only an approval writes. The run's trace lists the staged ids
 * (`AgentRun.staged`), so every proposal can be traced to the run, the
 * agent and the tool call that made it.
 *
 * Two kinds:
 *   file   create / overwrite a workspace file. Approving writes it, but
 *          only if the file still has the content the change was computed
 *          from (`before`); otherwise the change is marked `conflict` and
 *          nothing is written.
 *   range  replace [from, to) of the open document. Approving hands it to
 *          the document applier the editor registers (`setDocumentApplier`),
 *          which applies it to the live buffer; without an editor, a change
 *          on a saved document is applied to its workspace file. The text
 *          at [from, to) must still be `before` — when it moved, a unique
 *          occurrence of `before` is used instead; otherwise `conflict`.
 *
 * The queue lives in memory for the session (a proposal is only meaningful
 * against the document it was computed from) and is capped; listeners
 * (a review panel) are told about every change. A run that is cancelled
 * withdraws its pending proposals (`discardRunChanges`).
 */

import type { ChangeProposal, StagedChange, StagedReceipt } from "./types";

const MAX_CHANGES = 200;

let changes: StagedChange[] = [];
let seq = 0;
const listeners = new Set<(list: readonly StagedChange[]) => void>();

export type DocumentApplier = (change: Extract<StagedChange, { kind: "range" }>) => boolean | Promise<boolean>;
let documentApplier: DocumentApplier | null = null;

function emit(): void {
  for (const l of [...listeners]) l(changes);
}

function update(id: string, patch: Partial<StagedChange>): StagedChange | undefined {
  let found: StagedChange | undefined;
  changes = changes.map((c) => {
    if (c.id !== id) return c;
    found = { ...c, ...patch } as StagedChange;
    return found;
  });
  emit();
  return found;
}

export function stageChange(proposal: ChangeProposal, meta: { tool: string; runId?: string; agentId?: string }): StagedChange {
  const change = { ...proposal, ...meta, id: `chg_${Date.now().toString(36)}_${(++seq).toString(36)}`, createdAt: Date.now(), status: "pending" } as StagedChange;
  // Settled changes go first when the cap is reached; pending ones are kept.
  const next = [...changes, change];
  while (next.length > MAX_CHANGES) {
    const i = next.findIndex((c) => c.status !== "pending");
    next.splice(i >= 0 ? i : 0, 1);
  }
  changes = next;
  emit();
  return change;
}

export function receiptOf(change: StagedChange): StagedReceipt {
  return { staged: true, changeId: change.id, kind: change.kind, path: change.path, summary: change.summary };
}

export function isStagedReceipt(v: unknown): v is StagedReceipt {
  return !!v && typeof v === "object" && (v as StagedReceipt).staged === true && typeof (v as StagedReceipt).changeId === "string";
}

export function getStagedChange(id: string): StagedChange | undefined {
  return changes.find((c) => c.id === id);
}

/** Oldest first; `pending` only by default. */
export function listStagedChanges(opts: { all?: boolean; runId?: string } = {}): StagedChange[] {
  return changes.filter((c) => (opts.all || c.status === "pending") && (!opts.runId || c.runId === opts.runId));
}

export function onStagedChanges(listener: (list: readonly StagedChange[]) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The editor registers how a document change reaches the live buffer (null to unregister). */
export function setDocumentApplier(fn: DocumentApplier | null): void {
  documentApplier = fn;
}

/**
 * Apply a range change to `text`: at its offsets when they still hold
 * `before`, else at the single occurrence of `before`. Null when neither.
 */
export function applyRangeToText(text: string, change: { from: number; to: number; before: string; after: string }): string | null {
  if (text.slice(change.from, change.to) === change.before) return text.slice(0, change.from) + change.after + text.slice(change.to);
  if (!change.before) return null;
  const at = text.indexOf(change.before);
  if (at < 0 || text.indexOf(change.before, at + 1) >= 0) return null;
  return text.slice(0, at) + change.after + text.slice(at + change.before.length);
}

async function workspace() {
  return import("../storage/workspace");
}

/**
 * Approve a pending change: this is the only path from an agent's
 * proposal to a write. Resolves to the change with its new status
 * (`applied`, or `conflict` with the reason).
 */
export async function approveStagedChange(id: string): Promise<StagedChange> {
  const change = getStagedChange(id);
  if (!change) throw new Error(`No staged change ${id}`);
  if (change.status !== "pending") throw new Error(`Change ${id} is already ${change.status}`);
  const conflict = (error: string) => update(id, { status: "conflict", error })!;
  try {
    if (change.kind === "file") {
      const ws = await workspace();
      const exists = await ws.workspaceHasFile(change.path);
      const current = exists ? await ws.readWorkspaceFile(change.path) : null;
      if (current !== change.before) return conflict(change.before === null ? "the file was created since" : "the file changed since the change was proposed");
      await ws.writeWorkspaceFile(change.path, change.after);
      return update(id, { status: "applied" })!;
    }
    if (documentApplier) {
      return (await documentApplier(change)) ? update(id, { status: "applied" })! : conflict("the document changed since the change was proposed");
    }
    if (!change.path) return conflict("no editor is open to apply the change to");
    const ws = await workspace();
    const next = applyRangeToText(await ws.readWorkspaceFile(change.path), change);
    if (next === null) return conflict("the document changed since the change was proposed");
    await ws.writeWorkspaceFile(change.path, next);
    return update(id, { status: "applied" })!;
  } catch (e) {
    return conflict((e as Error)?.message ?? String(e));
  }
}

export function rejectStagedChange(id: string): StagedChange | undefined {
  const change = getStagedChange(id);
  if (!change || change.status !== "pending") return change;
  return update(id, { status: "rejected" });
}

/** Withdraw a run's pending proposals (the run was cancelled). */
export function discardRunChanges(runId: string): number {
  let n = 0;
  changes = changes.map((c) => {
    if (c.runId !== runId || c.status !== "pending") return c;
    n++;
    return { ...c, status: "rejected", error: "the run was cancelled" } as StagedChange;
  });
  if (n) emit();
  return n;
}

/** Tests. */
export function clearStagedChanges(): void {
  changes = [];
  documentApplier = null;
  emit();
}
