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
import { EmptyState, learnHow } from "./EmptyState";

export interface EntityGraphScreenProps {
  onClose: () => void;
  /** Tests pass a vault; the app reads the workspace. */
  vault?: EntityVault;
  initialMode?: "graph" | "table";
}

const EntityGraphView = lazy(() => import("./EntityGraphView").then((m) => ({ default: m.EntityGraphView })));
// W12.E6 / R12.7: an entity's page and timeline, when one is chosen.
const EntityPagePanel = lazy(() => import("./EntityPagePanel").then((m) => ({ default: m.EntityPagePanel })));

/** W12.E8's formats, by their own names (the same in every language). */
const EXPORT_FORMATS = [
  ["jsonld", "JSON-LD (schema.org)"],
  ["graphml", "GraphML"],
  ["turtle", "RDF/Turtle (PROV-O)"],
  ["neo4j", "Neo4j CSV"],
] as const;

const bar: React.CSSProperties = { display: "flex", alignItems: "center", gap: 12, padding: "8px 16px", borderBottom: "1px solid hsl(var(--border))" };
const muted: React.CSSProperties = { padding: "2rem", color: "hsl(var(--fg-muted))" };

export function EntityGraphScreen({ onClose, vault, initialMode }: EntityGraphScreenProps) {
  const [data, setData] = useState<EntityGraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<string | null>(null);

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

  // A source link on the page: open its note, then select the cited paragraph.
  const openAt = async (note: string, anchor: string | null) => {
    const ws = vault ?? (await import("../storage/workspace"));
    const content = await ws.readWorkspaceFile(note);
    useAppStore.getState().openTab({ name: note.split("/").pop()!, content, workspaceName: note });
    const { anchorLines } = await import("./EntityPagePanel");
    const at = anchorLines(content, anchor);
    if (at) window.dispatchEvent(new CustomEvent("lumen-reveal-line", { detail: { ...at, content } }));
    onClose();
  };
  const chosen = page && data ? data.entities.find((e) => e.id === page) : undefined;

  // W12.E8: the graph as JSON-LD, GraphML, Turtle (PROV-O) or Neo4j import CSV, downloaded — never sent anywhere.
  const exportAs = async (format: string) => {
    if (!data || !format) return;
    const { exportGraph } = await import("../entities/export");
    const files = exportGraph({ entities: data.entities, edges: data.edges }, format as "jsonld" | "graphml" | "turtle" | "neo4j");
    for (const [name, text] of Object.entries(files)) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
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
        {data && data.entities.length > 0 && (
          <label style={{ fontSize: 12, color: "hsl(var(--fg-muted))", marginInlineStart: "auto" }}>
            {t("entityGraph.export.label")}{" "}
            <select data-testid="entity-graph-export" value="" onChange={(e) => void exportAs(e.target.value)}>
              <option value="">…</option>
              {EXPORT_FORMATS.map(([value, name]) => (
                <option key={value} value={value}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="button" className="icon-btn" onClick={onClose} style={{ marginInlineStart: data && data.entities.length > 0 ? undefined : "auto", width: "auto", padding: "4px 12px", fontSize: 12 }}>
          {t("entityGraph.screen.close")}
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {error ? (
          <p role="alert" style={muted}>{t("entityGraph.screen.failed", { error })}</p>
        ) : !data ? (
          <p style={muted}>{t("entityGraph.screen.loading")}</p>
        ) : !data.entities.length ? (
          <EmptyState testId="entity-graph-empty" message={t("entityGraph.screen.empty")} action={learnHow("workspace/entity-graph")} />
        ) : (
          <Suspense fallback={<p style={muted}>{t("entityGraph.screen.loading")}</p>}>
            {chosen ? (
              <EntityPagePanel
                entity={chosen}
                entities={data.entities}
                edges={data.edges}
                texts={data.texts}
                dates={new Map([...data.notes].map(([p, n]) => [p, n.date]))}
                onOpen={(note, anchor) => void openAt(note, anchor)}
                onOpenNote={() => void open(chosen.id)}
                onBack={() => setPage(null)}
              />
            ) : (
              <EntityGraphView entities={data.entities} edges={data.edges} notes={data.notes} onOpenEntity={setPage} initialMode={initialMode} />
            )}
          </Suspense>
        )}
      </div>
    </Modal>
  );
}
