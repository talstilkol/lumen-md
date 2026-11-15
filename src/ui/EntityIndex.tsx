/**
 * The approved entities of one type (plan W12.E6), opened from ⌘K
 * ("Entities: People", "Entities: Laws", "Entities: Sources", …). Choosing
 * one shows its entity page; a relation's source link or a mention opens
 * the note at that paragraph (`[[note#^id]]`). Esc closes; Back returns to
 * the list. Reads the vault once on open (entities/vaultIo.ts).
 */
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { t } from "../i18n";
import type { EntityType } from "../entities/model";
import { edgesOf, entitiesOf, type Files } from "../entities/review";
import { loadEntityFiles, type EntityVault } from "../entities/vaultIo";
import "./entityGraphStrings";

const EntityPage = lazy(() => import("./EntityPage").then((m) => ({ default: m.EntityPage })));

export interface EntityIndexProps {
  type: EntityType;
  onClose: () => void;
  vault?: EntityVault;
}

const btn: React.CSSProperties = { padding: "4px 10px", fontSize: 12, borderRadius: 6, border: "1px solid hsl(var(--border))", background: "transparent", color: "inherit", cursor: "pointer" };

export function openBlock(note: string, anchor: string | null): void {
  window.dispatchEvent(new CustomEvent("lumen-open-file", { detail: anchor ? { path: note, heading: `^${anchor}` } : { path: note } }));
}

export function EntityIndex({ type, onClose, vault }: EntityIndexProps) {
  const [files, setFiles] = useState<Files | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadEntityFiles(vault)
      .then((f) => !cancelled && setFiles(f))
      .catch(() => !cancelled && setFiles(new Map()));
    return () => {
      cancelled = true;
    };
  }, [vault]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const all = useMemo(() => (files ? entitiesOf(files) : []), [files]);
  const edges = useMemo(() => (files ? edgesOf(files) : []), [files]);
  const names = useMemo(() => new Map(all.map((e) => [e.id, e.name])), [all]);
  const list = useMemo(() => all.filter((e) => e.type === type).sort((a, b) => a.name.localeCompare(b.name, "he")), [all, type]);
  const entity = chosen ? all.find((e) => e.id === chosen) : undefined;
  const title = t(`cmd.entities.${type}`);

  return (
    <div className="cmd-palette-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label={title} data-testid="entity-index">
      <div className="cmd-palette" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720, padding: 0, display: "flex", flexDirection: "column", maxHeight: "85vh" }}>
        <header style={{ padding: "14px 18px", borderBottom: "1px solid hsl(var(--border))", display: "flex", gap: 10, alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, flex: 1 }}>{title}</h2>
          {entity && (
            <button type="button" style={btn} onClick={() => setChosen(null)}>
              {t("entityGraph.index.back")}
            </button>
          )}
          <button type="button" style={btn} onClick={onClose}>
            {t("entityGraph.index.close")}
          </button>
        </header>
        <div style={{ padding: 18, overflowY: "auto", fontSize: 13 }}>
          {!files ? null : entity ? (
            <Suspense fallback={null}>
              <EntityPage entity={entity} edges={edges} notes={files} names={names} onOpenBlock={(note, anchor) => (onClose(), openBlock(note, anchor))} />
            </Suspense>
          ) : list.length === 0 ? (
            <p>{t("entityGraph.index.empty")}</p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
              {list.map((e) => (
                <li key={e.id}>
                  <button type="button" style={{ ...btn, inlineSize: "100%", textAlign: "start" }} onClick={() => setChosen(e.id)} dir="auto">
                    {e.name}
                    {e.aliases.length > 0 && <span style={{ color: "hsl(var(--fg-muted))" }}> · {e.aliases.join(" · ")}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
