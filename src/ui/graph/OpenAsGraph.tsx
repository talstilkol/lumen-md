/**
 * The "Open as graph" button of a Base or a query block (plan W13.G9): the
 * dialog (./SetGraphDialog.tsx, with the graph code and its strings) loads
 * only when it is pressed. The host gives the label (its own strings).
 */
import { lazy, Suspense, useState } from "react";
import type { RowFile } from "../../graph/baseGraph";

const SetGraphDialog = lazy(() => import("./SetGraphDialog"));

export function OpenAsGraph({ label, title, rows, paths, testId }: { label: string; title: string; rows?: () => readonly RowFile[]; paths?: () => readonly string[]; testId: string }) {
  const [open, setOpen] = useState<{ rows?: readonly RowFile[]; paths?: readonly string[] } | null>(null);
  return (
    <>
      <button type="button" onClick={() => setOpen({ rows: rows?.(), paths: paths?.() })} style={{ fontSize: 11 }} data-testid={testId}>
        {label}
      </button>
      {open && (
        <Suspense fallback={null}>
          <SetGraphDialog
            title={title}
            rows={open.rows}
            paths={open.paths}
            onClose={() => setOpen(null)}
            onOpen={(path) => {
              window.dispatchEvent(new CustomEvent("lumen-open-file", { detail: { path } }));
              setOpen(null);
            }}
          />
        </Suspense>
      )}
    </>
  );
}
