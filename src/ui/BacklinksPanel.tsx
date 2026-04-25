import { useEffect, useState } from "react";
import { Link2 } from "lucide-react";
import { findBacklinks, type BacklinkHit } from "../storage/workspaceIndex";
import { t } from "../i18n";

interface Props {
  /** Active workspace path. */
  filePath: string | null;
  /** Called with the source file's path when a backlink is clicked. */
  onOpen: (fromPath: string) => void;
}

export function BacklinksPanel({ filePath, onOpen }: Props) {
  const [hits, setHits] = useState<BacklinkHit[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!filePath) {
      setHits(null);
      return;
    }
    setLoading(true);
    findBacklinks(filePath)
      .then((h) => {
        if (!cancelled) {
          setHits(h);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHits([]);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  // Refresh on workspace changes.
  useEffect(() => {
    if (!filePath) return;
    function refresh() {
      findBacklinks(filePath!)
        .then((h) => setHits(h))
        .catch(() => {});
    }
    window.addEventListener("lumen-workspace-changed", refresh);
    return () =>
      window.removeEventListener("lumen-workspace-changed", refresh);
  }, [filePath]);

  return (
    <aside className="backlinks-panel" aria-label={t("backlinks.title")}>
      <div className="file-tree-header">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Link2 size={12} />
          {t("backlinks.title")}
        </span>
      </div>
      {!filePath && (
        <div style={{ padding: "1rem", color: "hsl(var(--fg-muted))", fontSize: 12 }}>
          {t("backlinks.selectFile")}
        </div>
      )}
      {filePath && loading && (
        <div style={{ padding: "1rem", color: "hsl(var(--fg-muted))", fontSize: 12 }}>
          {t("backlinks.scanning")}
        </div>
      )}
      {filePath && !loading && hits && hits.length === 0 && (
        <div style={{ padding: "1rem", color: "hsl(var(--fg-muted))", fontSize: 12 }}>
          {t("backlinks.empty")}
        </div>
      )}
      {hits && hits.length > 0 && (
        <ul className="backlinks-list" role="list" aria-label={t("backlinks.title")}>
          {hits.map((h, i) => (
            <li key={i} role="listitem">
              <button
                type="button"
                className="backlink-item"
                onClick={() => onOpen(h.fromPath)}
                title={h.fromPath}
              >
                <span className="backlink-from">{h.fromName}</span>
                <span className="backlink-snippet">{h.snippet}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
