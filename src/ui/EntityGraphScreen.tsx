/**
 * The entity graph as a full-screen view over the workspace (plan W12.E7,
 * W12.X3): every entity and every relation of the vault, citations
 * included, in the W12.E7 view (graph or table, filters, time slider,
 * neighbourhood, "Citations only"). An entity opens its note: the entity
 * note, or the source note a cited source came from.
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { t } from "../i18n";
import { loadEntityGraph, type EntityGraphData } from "../entities/graphData";
import type { EntityVault } from "../entities/vaultIo";
import { useAppStore } from "../store/useStore";
import { Modal } from "./Modal";
import { explainError } from "../lib/userError";
import "./entityGraphStrings";

export interface EntityGraphScreenProps {
  onClose: () => void;
  /** Tests pass a vault; the app reads the workspace. */
  vault?: EntityVault;
  initialMode?: "graph" | "table";
}

const EntityGraphView = lazy(() => import("./EntityGraphView").then((m) => ({ default: m.EntityGraphView })));

const bar: React.CSSProperties = { display: "flex", alignItems: "center", gap: 12, padding: "8px 16px", borderBottom: "1px solid hsl(var(--border))" };
const muted: React.CSSProperties = { padding: "2rem", color: "hsl(var(--fg-muted))" };

export function EntityGraphScreen({ onClose, vault, initialMode }: EntityGraphScreenProps) {
  const [data, setData] = useState<EntityGraphData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    loadEntityGraph(vault).then(
      (d) => !off && setData(d),
      (e: unknown) => !off && setError(explainError(e)),
    );
    return () => {
      off = true;
    };
  }, [vault]);

  const open = async (id: string) => {
    const path = data?.noteOf.get(id);
    if (!path) return;
    const ws = vault ?? (await import("../storage/workspace"));
    const content = await ws.readWorkspaceFile(path);
    useAppStore.getState().openTab({ name: path.split("/").pop()!, content, workspaceName: path });
    onClose();
  };

  return (
    <Modal onClose={onClose} aria-labelledby="entity-graph-title" data-testid="entity-graph-screen" style={{ position: "fixed", inset: 0, zIndex: 9999, background: "hsl(var(--bg))", display: "flex", flexDirection: "column" }}>
      <div style={bar}>
        <h2 id="entity-graph-title" style={{ margin: 0, fontSize: 14, color: "hsl(var(--fg))" }}>
          {t("entityGraph.screen.title")}
        </h2>
        {data && (
          <span style={{ fontSize: 12, color: "hsl(var(--fg-muted))" }}>
            {t("entityGraph.screen.counts", { entities: String(data.entities.length), edges: String(data.edges.length) })}
          </span>
        )}
        <button type="button" className="icon-btn" onClick={onClose} style={{ marginInlineStart: "auto", width: "auto", padding: "4px 12px", fontSize: 12 }}>
          {t("entityGraph.screen.close")}
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {error ? (
          <p role="alert" style={muted}>{t("entityGraph.screen.failed", { error })}</p>
        ) : !data ? (
          <p style={muted}>{t("entityGraph.screen.loading")}</p>
        ) : !data.entities.length ? (
          <p data-testid="entity-graph-empty" style={muted}>{t("entityGraph.screen.empty")}</p>
        ) : (
          <Suspense fallback={<p style={muted}>{t("entityGraph.screen.loading")}</p>}>
            <EntityGraphView entities={data.entities} edges={data.edges} notes={data.notes} onOpenEntity={(id) => void open(id)} initialMode={initialMode} />
          </Suspense>
        )}
      </div>
    </Modal>
  );
}
