/**
 * The graph proposals (W12.E5) inside the review panel, above the agents'
 * staged changes. It reads the vault's notes and the queue, shows what is
 * there, and runs the entity extraction worker (W12.E2,
 * entities/extract/scanVault.ts) over the notes; new proposals are merged
 * into the queue through `applyEntityOp`, like every operation here, which
 * refuses when a touched file changed since it was read (the status line
 * says so and the files are read again). With no local NER model the panel
 * notes that the rules ran alone. Nothing renders while there is neither a
 * graph nor a proposal.
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { applyEntityOp, hasEntityData, loadEntityFiles, type EntityVault } from "../entities/vaultIo";
import type { Files, OpResult } from "../entities/review";
import type { ExtractRun } from "../entities/extract/scanVault";

const EntityReviewPanel = lazy(() => import("./EntityReviewPanel").then((m) => ({ default: m.EntityReviewPanel })));

export interface EntityReviewHostProps {
  /** Tests pass a vault; the app uses the workspace. */
  vault?: EntityVault;
  /** Tests run the extractor in-process; the app uses the worker. */
  extract?: ExtractRun;
}

/** The extraction worker for one run; tests pass the extractor in-process. */
const workerRun: ExtractRun = async (req) => {
  const { extractInWorker, newExtractWorker } = await import("../entities/extract/protocol");
  const w = newExtractWorker();
  try {
    return await extractInWorker(w, { ...req, id: 1 });
  } finally {
    w.terminate();
  }
};

export function EntityReviewHost({ vault, extract = workerRun }: EntityReviewHostProps) {
  const [files, setFiles] = useState<Files | null>(null);
  const [notices, setNotices] = useState<Array<"rules-only">>([]);
  const current = useRef<Files | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let f: Map<string, string>;
      try {
        const graph = await hasEntityData(vault);
        f = await loadEntityFiles(vault);
        if (cancelled) return;
        if (graph) setFiles((current.current = f));
      } catch {
        /* why: no workspace (OPFS unavailable, a locked vault): no graph proposals to show */
        return;
      }
      try {
        const { entitiesOf } = await import("../entities/review");
        const { queueWith, rememberScanned, scanNotes } = await import("../entities/extract/scanVault");
        const res = await scanNotes(f, entitiesOf(f), extract, vault);
        if (cancelled) return;
        const basis = current.current ?? f;
        const op = queueWith(basis, res.incoming);
        if (op) await applyEntityOp(basis, op, vault);
        rememberScanned(res);
        if (cancelled) return;
        if (res.mode === "rules-only") setNotices(["rules-only"]);
        if (op) setFiles((current.current = op.files));
      } catch {
        /* why: no worker here, or the queue moved underneath: the next opening scans again */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [vault, extract]);

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
      <EntityReviewPanel files={files} onApply={onApply} notices={notices} />
    </Suspense>
  );
}
