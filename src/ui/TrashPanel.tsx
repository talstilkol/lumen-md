/**
 * Trash panel (T46): what was deleted in the last 30 days, with Restore
 * and Delete forever.
 */
import { useCallback, useEffect, useState } from "react";
import { Trash2, X } from "lucide-react";
import { t, getLocale } from "../i18n";
import { emptyTrash, listTrash, restoreFromTrash, TRASH_KEEP_MS, type TrashItem } from "../storage/trash";
import { toast } from "../store/useToastStore";

interface Props {
  open: boolean;
  onClose: () => void;
}

const btn: React.CSSProperties = { padding: "4px 10px", fontSize: 12, borderRadius: 6, border: "1px solid hsl(var(--border))", background: "transparent", color: "inherit", cursor: "pointer" };

export function TrashPanel({ open, onClose }: Props) {
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const reload = useCallback(async () => setItems(await listTrash()), []);

  useEffect(() => {
    if (open) void reload();
  }, [open, reload]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const restore = async (i: TrashItem) => {
    const where = await restoreFromTrash(i.id);
    window.dispatchEvent(new Event("lumen-workspace-changed"));
    toast.success(t("trash.restored", { path: where }));
    await reload();
  };
  const forever = async (i: TrashItem) => {
    await emptyTrash({ id: i.id });
    await reload();
  };
  const all = async () => {
    await emptyTrash();
    await reload();
  };
  const daysLeft = (i: TrashItem) => Math.max(0, Math.ceil((i.trashedAt + TRASH_KEEP_MS - Date.now()) / 86_400_000));

  return (
    <div className="cmd-palette-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label={t("trash.title")}>
      <div className="cmd-palette" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560, padding: 0, display: "flex", flexDirection: "column", maxHeight: "80vh" }}>
        <header style={{ padding: "12px 16px", borderBottom: "1px solid hsl(var(--border))", display: "flex", gap: 10, alignItems: "center" }}>
          <Trash2 size={16} />
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, flex: 1 }}>{t("trash.title")}</h2>
          {!!items?.length && (
            <button type="button" style={btn} onClick={() => void all()}>
              {t("trash.emptyAll")}
            </button>
          )}
          <button type="button" style={btn} onClick={onClose} aria-label={t("trash.close")}>
            <X size={14} />
          </button>
        </header>
        <div style={{ overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          {items && items.length === 0 && <p style={{ margin: 8, color: "hsl(var(--fg-muted))", fontSize: 13 }}>{t("trash.empty")}</p>}
          {items?.map((i) => (
            <div key={i.id} data-testid="trash-item" style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 8px", borderRadius: 6, background: "hsl(var(--bg-subtle))" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} dir="auto">{i.originalPath}</div>
                <div style={{ fontSize: 11, color: "hsl(var(--fg-muted))" }}>
                  {new Date(i.trashedAt).toLocaleString(getLocale())} · {t("trash.daysLeft", { n: String(daysLeft(i)) })}
                </div>
              </div>
              <button type="button" style={btn} onClick={() => void restore(i)}>{t("trash.restore")}</button>
              <button type="button" style={btn} onClick={() => void forever(i)}>{t("trash.deleteForever")}</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
