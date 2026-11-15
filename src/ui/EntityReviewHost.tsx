/**
 * The graph proposals (W12.E5) inside the review panel, above the agents'
 * staged changes. It costs two stat calls when the vault has no entity
 * graph (then it renders nothing); otherwise it reads the vault's notes
 * and the queue, loads the panel's chunk, and writes each operation
 * through `applyEntityOp`, which refuses when a touched file changed since
 * it was read (the status line says so and the files are read again).
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { applyEntityOp, hasEntityData, loadEntityFiles, type EntityVault } from "../entities/vaultIo";
import type { Files, OpResult } from "../entities/review";

const EntityReviewPanel = lazy(() => import("./EntityReviewPanel").then((m) => ({ default: m.EntityReviewPanel })));

export interface EntityReviewHostProps {
  /** Tests pass a vault; the app uses the workspace. */
  vault?: EntityVault;
}

export function EntityReviewHost({ vault }: EntityReviewHostProps) {
  const [files, setFiles] = useState<Files | null>(null);
  const current = useRef<Files | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (!(await hasEntityData(vault))) return;
        const f = await loadEntityFiles(vault);
        if (!cancelled) setFiles((current.current = f));
      } catch {
        /* why: no workspace (OPFS unavailable, a locked vault): no graph proposals to show */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [vault]);

  const onApply = useCallback(
    async (r: OpResult) => {
      const basis = current.current;
      if (!basis) return;
      try {
        await applyEntityOp(basis, r, vault);
      } catch (e) {
        // A touched file moved underneath: read the vault again, and let the panel show why.
        const fresh = await loadEntityFiles(vault).catch(() => basis);
        setFiles((current.current = fresh));
        throw e;
      }
      setFiles((current.current = r.files));
    },
    [vault],
  );

  if (!files) return null;
  return (
    <Suspense fallback={null}>
      <EntityReviewPanel files={files} onApply={onApply} />
    </Suspense>
  );
}
