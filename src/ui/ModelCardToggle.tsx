/**
 * "Model card" in the review screen's run header (plan W13.A5): opens the
 * card of the agent that proposed the changes, with the model its run used
 * (from the run trace) when the trace has it.
 */
import { lazy, Suspense, useEffect, useId, useState } from "react";
import { t } from "../i18n";
import "./modelCardStrings";

const ModelCard = lazy(() => import("./ModelCard"));

export function ModelCardToggle({ agent, runId, buttonStyle }: { agent: string; runId?: string; buttonStyle?: React.CSSProperties }) {
  const [open, setOpen] = useState(false);
  const [model, setModel] = useState<string | null>(null);
  const id = useId();
  useEffect(() => {
    if (!open || !runId) return;
    let live = true;
    void import("../agents/trace")
      .then((m) => m.listRuns().find((r) => r.id === runId)?.model ?? null)
      .then((x) => live && setModel(x))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [open, runId]);
  return (
    <>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} style={{ padding: "2px 8px", fontSize: 11.5, borderRadius: 6, border: "1px solid hsl(var(--border))", background: "transparent", color: "inherit", cursor: "pointer", ...buttonStyle }}>
        {t("modelCard.open")}
      </button>
      {open && (
        <div id={id} style={{ flexBasis: "100%" }}>
          <Suspense fallback={null}>
            <ModelCard agent={agent} model={model} />
          </Suspense>
        </div>
      )}
    </>
  );
}

export default ModelCardToggle;
