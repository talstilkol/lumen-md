/**
 * "What is stored on this device" (plan W13.P4): each category with its
 * size, a Delete button per category (with a confirmation; keys are
 * crypto-shredded), "Delete everything", and "Save the report (JSON)".
 * Opened from the palette; its own React root, a modal dialog.
 */
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { getLocale, t } from "../i18n";

const formatNumber = (n: number) => new Intl.NumberFormat(getLocale()).format(n);
import { uiConfirm } from "../ui/PromptDialog";
import "./localDataStrings";
import { browserStorage, CATEGORIES, inventory, reportJson, wipe, type DataCategory, type InventoryReport, type StorageDeps } from "./localData";

const size = (n: number | null) => (n === null ? t("localData.unknown") : n < 1024 * 1024 ? t("localData.kb", { n: formatNumber(Math.ceil(n / 1024)) }) : t("localData.mb", { n: formatNumber(Math.round((n / 1048576) * 10) / 10) }));

export function LocalDataDialog({ deps, onClose, save }: { deps: StorageDeps; onClose: () => void; save: (name: string, text: string) => void }) {
  const [report, setReport] = useState<InventoryReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const title = useRef<HTMLHeadingElement>(null);
  const refresh = () => void inventory(deps).then(setReport);
  useEffect(refresh, [deps]);
  useEffect(() => title.current?.focus(), []);

  const remove = async (c: DataCategory | "all") => {
    const ok = await uiConfirm({ title: t("localData.confirmTitle"), message: t(c === "all" ? "localData.confirmAll" : c === "keyring" ? "localData.confirmKeyring" : "localData.confirm", { what: c === "all" ? "" : t(`localData.cat.${c}`) }), okLabel: t("localData.delete") });
    if (!ok) return;
    setBusy(true);
    const gone = await wipe(c, deps);
    setBusy(false);
    setNote(t("localData.deleted", { n: formatNumber(gone.length) }));
    refresh();
  };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "grid", placeItems: "center", background: "rgb(0 0 0 / 0.4)" }} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="local-data-title" data-testid="local-data" style={{ background: "hsl(var(--bg))", color: "hsl(var(--fg))", borderRadius: 10, padding: 20, width: "min(560px, 94vw)", maxHeight: "86vh", overflow: "auto", display: "grid", gap: 12 }} tabIndex={-1}>
        <h2 id="local-data-title" ref={title} tabIndex={-1} style={{ margin: 0, fontSize: 18 }}>
          {t("localData.title")}
        </h2>
        <p style={{ margin: 0, fontSize: 13, color: "hsl(var(--fg-muted))" }}>{report ? t("localData.total", { used: size(report.usage), quota: size(report.quota) }) : t("localData.loading")}</p>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <tbody>
            {(report?.categories ?? []).map((c) => (
              <tr key={c.category} data-testid={`local-data-${c.category}`} style={{ borderTop: "1px solid hsl(var(--border))" }}>
                <th scope="row" style={{ textAlign: "start", padding: "8px 4px", fontWeight: 500 }}>
                  {t(`localData.cat.${c.category}`)}
                  <div style={{ fontSize: 12, fontWeight: 400, color: "hsl(var(--fg-muted))" }}>{t(`localData.about.${c.category}`)}</div>
                </th>
                {/* empty-allow: a size cell ("nothing stored"); the row's Delete is beside it */}
                <td style={{ padding: "8px 4px", whiteSpace: "nowrap" }}>{c.items.length ? size(c.bytes) : t("localData.empty")}</td>
                <td style={{ padding: "8px 4px", textAlign: "end" }}>
                  <button type="button" className="btn" disabled={busy || !c.items.length} onClick={() => void remove(c.category)} aria-label={t("localData.deleteWhat", { what: t(`localData.cat.${c.category}`) })} style={{ padding: "4px 10px", border: "1px solid hsl(var(--border))", borderRadius: 6 }}>
                    {t("localData.delete")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div role="status" style={{ minHeight: 18, fontSize: 13 }}>
          {note}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button type="button" className="btn" disabled={!report} onClick={() => report && save(`lumen-local-data-${report.created.slice(0, 10)}.json`, reportJson(report))} style={{ padding: "6px 12px", border: "1px solid hsl(var(--border))", borderRadius: 6 }}>
            {t("localData.export")}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => void remove("all")} style={{ padding: "6px 12px", border: "1px solid hsl(var(--danger))", color: "hsl(var(--danger))", borderRadius: 6 }}>
            {t("localData.deleteAll")}
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose} style={{ padding: "6px 12px", border: "none", borderRadius: 6, background: "hsl(var(--accent))", color: "hsl(var(--accent-fg))" }}>
            {t("localData.close")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Opens the dialog; focus returns to where it was when it closes. */
export function openLocalData(): void {
  const before = document.activeElement as HTMLElement | null;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const close = () => {
    root.unmount();
    host.remove();
    if (before && before !== document.body) before.focus?.();
  };
  const save = async (name: string, text: string) => (await import("../storage/exportFormats")).downloadBytes(name, new TextEncoder().encode(text), "application/json");
  root.render(<LocalDataDialog deps={browserStorage()} onClose={close} save={(n, s) => void save(n, s)} />);
  void CATEGORIES;
}
