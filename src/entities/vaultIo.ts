/**
 * The entity graph's vault reads and writes (plan W12.E5 wiring).
 *
 * `loadEntityFiles` reads what the review queue and the entity pages work
 * on: the queue files under `.lumen/entities/`, the entity notes under
 * `ישויות/`, and the vault's other notes (a merge relinks `[[links]]`
 * anywhere in the vault, and a page shows every mention with its paragraph).
 *
 * `applyEntityOp` is the controlled write path for one review operation
 * (approve, reject, merge, split or undo). It writes nothing unless every
 * file the operation touches still holds exactly the bytes the operation
 * was computed from, as the agent staging queue refuses an approval whose
 * text moved underneath (agents/staging.ts). Only the user's click in the
 * review panel calls it; extractors and agents only write proposals.
 */
import { ENTITY_ROOT } from "./model";
import { ENTITY_DIR, PROPOSALS_PATH } from "./store";
import type { Files, OpResult } from "./review";

/** The subset of storage/workspace this module uses (tests pass the real module over a memory vault). */
export interface EntityVault {
  listWorkspace(opts?: { includeHidden?: boolean }): Promise<Array<{ path: string }>>;
  readWorkspaceFile(path: string): Promise<string>;
  writeWorkspaceFile(path: string, content: string): Promise<unknown>;
  deleteWorkspaceFile(path: string): Promise<void>;
  workspaceHasFile(path: string): Promise<boolean>;
  workspaceHasEntry(path: string): Promise<boolean>;
  /** Review Z7-L1: compare-and-swap by text under the path's lock (null: only while nothing is there). */
  writeWorkspaceTextIf?(path: string, content: string, expect: string | null): Promise<boolean>;
  removeWorkspaceTextIf?(path: string, expect: string): Promise<boolean>;
}

const realVault = async (): Promise<EntityVault> => ({ ...(await import("../storage/workspace")), ...(await import("../storage/workspaceBulk")) }) as unknown as EntityVault;

const wanted = (p: string) => (p.startsWith(`${ENTITY_DIR}/`) && p.endsWith(".jsonl")) || (p.endsWith(".md") && !p.startsWith("."));

/** Is there anything for the graph review to show (a queue file or an entity folder)? Cheap: two stat calls. */
export async function hasEntityData(vault?: EntityVault): Promise<boolean> {
  const ws = vault ?? (await realVault());
  return (await ws.workspaceHasEntry(PROPOSALS_PATH)) || (await ws.workspaceHasEntry(ENTITY_ROOT));
}

export async function loadEntityFiles(vault?: EntityVault): Promise<Map<string, string>> {
  const ws = vault ?? (await realVault());
  const out = new Map<string, string>();
  for (const e of await ws.listWorkspace({ includeHidden: true })) {
    if (!wanted(e.path)) continue;
    try {
      out.set(e.path, await ws.readWorkspaceFile(e.path));
    } catch {
      /* why: removed between the listing and the read: leave it out */
    }
  }
  return out;
}

/** An operation was refused: a file it touches changed since it was computed. Nothing was written. */
export class EntityWriteConflict extends Error {
  constructor(public readonly path: string) {
    super(`${path} changed since the review panel read it; reload and try again`);
    this.name = "EntityWriteConflict";
  }
}

/**
 * Write one operation's result. `basis` is the file set the operation was
 * computed from. Every touched path is checked against it first (missing
 * counts as null). Then each file is written (or removed) by compare-and-swap
 * against that same text, under the path's lock (review Z7-L1), so an
 * autosave that lands after the check is never replaced. On the first
 * refusal the files already written go back to what they were, each only
 * while it still holds what this operation wrote, and the operation fails
 * with EntityWriteConflict.
 */
export async function applyEntityOp(basis: Files, result: OpResult, vault?: EntityVault): Promise<void> {
  const ws = vault ?? (await realVault());
  const current = async (p: string) => ((await ws.workspaceHasFile(p)) ? await ws.readWorkspaceFile(p) : null);
  // A vault without the locked calls (a test double) still compares right before each write.
  const writeIf =
    ws.writeWorkspaceTextIf?.bind(ws) ??
    (async (p: string, content: string, expect: string | null) => {
      if ((await current(p)) !== expect) return false;
      await ws.writeWorkspaceFile(p, content);
      return true;
    });
  const removeIf =
    ws.removeWorkspaceTextIf?.bind(ws) ??
    (async (p: string, expect: string) => {
      if ((await current(p)) !== expect) return false;
      await ws.deleteWorkspaceFile(p);
      return true;
    });
  const before = (p: string) => basis.get(p) ?? null;
  const touched = [...result.written, ...result.removed];
  for (const p of touched) if ((await current(p)) !== before(p)) throw new EntityWriteConflict(p);
  const done: Array<{ path: string; now: string | null }> = [];
  const steps = [...result.written.map((p) => ({ path: p, now: result.files.get(p) ?? null })), ...result.removed.map((p) => ({ path: p, now: null }))];
  for (const step of steps) {
    const was = before(step.path);
    const ok = step.now === null ? was === null || (await removeIf(step.path, was)) : await writeIf(step.path, step.now, was);
    if (!ok) {
      await rollBack(done);
      throw new EntityWriteConflict(step.path);
    }
    done.push(step);
  }

  async function rollBack(written: typeof done): Promise<void> {
    for (const { path, now } of written.reverse()) {
      const was = before(path);
      try {
        if (was === null) {
          if (now !== null) await removeIf(path, now);
        } else await writeIf(path, was, now);
      } catch {
        /* why: a file that cannot be put back stays as written; the review panel reloads and shows the vault as it is */
      }
    }
  }
}
