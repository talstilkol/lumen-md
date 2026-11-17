/**
 * Deleted and renamed files (T46, plan W13.S1 — Obsidian Sync's "deleted
 * files" screen, and more): what was deleted in the last 30 days, and what
 * was renamed or moved, each searchable (niqqud and accents ignored), with
 * multi-select — click, Shift+click for a range, Shift+↑/↓ from the
 * keyboard, "select all shown" — and a bulk restore to the original place.
 * Below: the vault's version-history retention (./TrashRetention).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trash2, X } from "lucide-react";
import { t, getLocale } from "../i18n";
import { emptyTrash, listTrash, restoreManyFromTrash, TRASH_KEEP_MS, type TrashItem } from "../storage/trash";
import { canUndoRename, forgetRenames, listRenames, type RenameEntry } from "../storage/renameLog";
import { safeMove } from "../storage/fileOps";
import { onWorkspaceChanged } from "../storage/workspaceEvents";
import { toast } from "../store/useToastStore";
import { EmptyState } from "./EmptyState";
import { uiConfirm } from "./PromptDialog";
import { HelpButton } from "./HelpButton";
import "./trashPanelStrings";
import { Modal } from "./Modal";
import "../storage/attachmentCleanupStrings";
import { attachmentPolicy, setAttachmentPolicy, type AttachmentPolicy } from "../storage/attachmentPolicy";
import { clickSelect, emptySelection, matches, prune, toggleAll, type Selection } from "./trashSelection";
import { TrashRetention } from "./TrashRetention";
import { trashBtn as btn, trashBtnPrimary } from "./trashStyles";

interface Props {
  open: boolean;
  onClose: () => void;
}

type Tab = "deleted" | "renamed";

/**
 * A vault path, each folder and the file name isolated (<bdi>): an English
 * name inside a Hebrew path (or the reverse) keeps its own order, and
 * `2026-11-02.md` never shows as `md.2026-11-02`.
 */
/** The direction of a path's first strong character (dir="auto" skips <bdi> content, so it is worked out here). */
export function pathDir(path: string): "rtl" | "ltr" {
  const m = /[\p{L}]/u.exec(path);
  return m && /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/.test(m[0]) ? "rtl" : "ltr";
}

function PathText({ path }: { path: string }) {
  const parts = path.split("/");
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && "/"}
          <bdi>{p}</bdi>
        </span>
      ))}
    </>
  );
}
interface Row {
  id: string;
  path: string;
  detail: string;
}

export function TrashPanel({ open, onClose }: Props) {
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [renames, setRenames] = useState<RenameEntry[] | null>(null);
  const [tab, setTab] = useState<Tab>("deleted");
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState<Selection>(emptySelection);
  const [progress, setProgress] = useState<string | null>(null);
  const [policy, setPolicy] = useState<AttachmentPolicy>(attachmentPolicy);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const reload = useCallback(async () => {
    const [tr, rn] = await Promise.all([listTrash(), listRenames()]);
    setItems(tr);
    setRenames(rn);
  }, []);

  useEffect(() => {
    if (open) void reload();
  }, [open, reload]);

  // Ctrl+Z outside the editor (or a delete) can change the trash while the
  // panel is open: show what is in it now, not what was when it opened.
  useEffect(() => {
    if (!open) return;
    return onWorkspaceChanged((c) => {
      if (c.kind === "structure") void reload();
    }, { debounceMs: 100 });
  }, [open, reload]);

  const locale = getLocale();
  const rows: Row[] = useMemo(() => {
    const daysLeft = (at: number) => Math.max(0, Math.ceil((at + TRASH_KEEP_MS - Date.now()) / 86_400_000));
    if (tab === "deleted")
      return (items ?? []).map((i) => ({ id: i.id, path: i.originalPath, detail: `${new Date(i.trashedAt).toLocaleString(locale)} · ${t("trash.daysLeft", { n: String(daysLeft(i.trashedAt)) })}` }));
    return (renames ?? []).map((r) => ({ id: r.id, path: r.from, detail: `${t("trash.renamedTo", { path: r.to })} · ${new Date(r.at).toLocaleString(locale)}` }));
  }, [tab, items, renames, locale]);
  const visible = useMemo(() => rows.filter((r) => matches(r.path, query) || (tab === "renamed" && matches(r.detail, query))), [rows, query, tab]);
  const visibleIds = useMemo(() => visible.map((r) => r.id), [visible]);

  // A reload (a restore, Ctrl+Z, another tab) drops ids that are gone from the selection.
  useEffect(() => setSel((s) => prune(s, rows.map((r) => r.id))), [rows]);

  if (!open) return null;

  const focusAfter = () => {
    // Restored rows vanish: focus the first row left, else the search box — never <body>.
    requestAnimationFrame(() => {
      const first = listRef.current?.querySelector<HTMLInputElement>("input[type=checkbox]");
      (first ?? searchRef.current)?.focus();
    });
  };

  const restoreDeleted = async (ids: string[]) => {
    if (!ids.length) return;
    setProgress(t("trash.restoring", { done: "0", total: String(ids.length) }));
    const r = await restoreManyFromTrash(ids, (done, total) => setProgress(t("trash.restoring", { done: String(done), total: String(total) })));
    setProgress(null);
    if (r.restored.length) {
      window.dispatchEvent(new Event("lumen-workspace-changed"));
      toast.success(r.restored.length === 1 ? t("trash.restored", { path: r.restored[0].path }) : t("trash.restoredMany", { count: String(r.restored.length) }));
    }
    if (r.failed.length) toast.error(t("trash.restoreFailedMany", { n: String(r.failed.length) }));
    await reload();
    focusAfter();
  };

  const undoRenames = async (ids: string[]) => {
    const want = new Set(ids);
    let ok = 0;
    let skipped = 0;
    const done: string[] = [];
    // Newest first, so a chain a → b → c unwinds back to a.
    for (const e of (renames ?? []).filter((r) => want.has(r.id))) {
      if (!(await canUndoRename(e))) {
        skipped++;
        continue;
      }
      const moved = await safeMove(e.to, e.from, { folder: e.folder, noLog: true }).catch(() => null);
      if (moved) {
        ok++;
        done.push(e.id);
      } else skipped++;
    }
    await forgetRenames(done);
    if (ok) toast.success(t("trash.renamesUndone", { n: String(ok) }));
    if (skipped) toast.error(t("trash.renamesSkipped", { n: String(skipped) }));
    await reload();
    focusAfter();
  };

  const restore = (ids: string[]) => (tab === "deleted" ? restoreDeleted(ids) : undoRenames(ids));

  const forever = async (i: Row) => {
    if (!(await uiConfirm({ message: t("trash.deleteForeverConfirm", { path: i.path }) }))) return;
    await emptyTrash({ id: i.id });
    await reload();
    focusAfter();
  };
  const all = async () => {
    if (!(await uiConfirm({ message: t("trash.emptyAllConfirm", { n: items?.length ?? 0 }) }))) return;
    await emptyTrash();
    await reload();
    focusAfter();
  };

  const selectedShown = visibleIds.filter((id) => sel.selected.has(id));
  const allShown = visibleIds.length > 0 && selectedShown.length === visibleIds.length;

  const onRowKey = (e: React.KeyboardEvent<HTMLInputElement>, id: string) => {
    if (!e.shiftKey || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
    e.preventDefault();
    const at = visibleIds.indexOf(id);
    const to = visibleIds[at + (e.key === "ArrowDown" ? 1 : -1)];
    if (!to) return;
    // Shift+↓ extends the selection the way Shift+click does, anchored where it started.
    setSel((s) => clickSelect(s.anchor ? s : { selected: new Set([...s.selected, id]), anchor: id }, visibleIds, to, true));
    listRef.current?.querySelector<HTMLInputElement>(`input[data-id="${CSS.escape(to)}"]`)?.focus();
  };

  const count = { deleted: items?.length ?? 0, renamed: renames?.length ?? 0 };
  const loaded = tab === "deleted" ? items !== null : renames !== null;

  return (
    <Modal onClose={onClose} className="cmd-palette-backdrop" onClick={onClose} aria-labelledby="trash-title">
      <div className="cmd-palette" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640, padding: 0, display: "flex", flexDirection: "column", maxHeight: "86vh" }}>
        <header style={{ padding: "12px 16px", borderBottom: "1px solid hsl(var(--border))", display: "flex", gap: 10, alignItems: "center" }}>
          <Trash2 size={16} aria-hidden />
          <h2 id="trash-title" style={{ margin: 0, fontSize: 15, fontWeight: 600, flex: 1 }}>
            {t("trash.titleFull")}
          </h2>
          {tab === "deleted" && !!items?.length && (
            <button type="button" style={btn} onClick={() => void all()}>
              {t("trash.emptyAll")}
            </button>
          )}
          <HelpButton topic="workspace/panels#trash" />
          <button type="button" style={btn} onClick={onClose} aria-label={t("trash.close")}>
            <X size={14} aria-hidden />
          </button>
        </header>
        <div role="tablist" aria-label={t("trash.titleFull")} style={{ display: "flex", gap: 4, padding: "8px 16px 0" }}>
          {(["deleted", "renamed"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              id={`trash-tab-${k}`}
              aria-selected={tab === k}
              aria-controls="trash-tabpanel"
              tabIndex={tab === k ? 0 : -1}
              className={`seg-btn${tab === k ? " active" : ""}`}
              onClick={() => {
                setTab(k);
                setSel(emptySelection);
              }}
              onKeyDown={(e) => {
                if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                const next = k === "deleted" ? "renamed" : "deleted";
                setTab(next);
                setSel(emptySelection);
                (e.currentTarget.parentElement?.querySelector(`#trash-tab-${next}`) as HTMLElement | null)?.focus();
              }}
            >
              {t(`trash.tab.${k}`, { n: String(count[k]) })}
            </button>
          ))}
        </div>
        <div id="trash-tabpanel" role="tabpanel" aria-labelledby={`trash-tab-${tab}`} style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 16px", flexWrap: "wrap" }}>
            <input
              ref={searchRef}
              type="search"
              data-testid="trash-search"
              aria-label={t("trash.search")}
              placeholder={t("trash.search")}
              value={query}
              dir="auto"
              onChange={(e) => setQuery(e.target.value)}
              style={{ flex: 1, minWidth: 160, padding: "4px 8px", fontSize: 13, borderRadius: 6, border: "1px solid hsl(var(--border))", background: "transparent", color: "inherit" }}
            />
            <label style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 12 }}>
              <input type="checkbox" data-testid="trash-select-all" checked={allShown} disabled={!visibleIds.length} onChange={() => setSel((s) => toggleAll(s, visibleIds))} />
              {t("trash.selectAll")}
            </label>
            <button
              type="button"
              data-testid="trash-restore-selected"
              style={selectedShown.length ? trashBtnPrimary : btn}
              aria-disabled={!selectedShown.length || !!progress}
              onClick={() => {
                if (selectedShown.length && !progress) void restore(selectedShown);
              }}
            >
              {tab === "deleted" ? t("trash.restoreSelected", { n: String(selectedShown.length) }) : t("trash.undoSelected", { n: String(selectedShown.length) })}
            </button>
          </div>
          <p aria-live="polite" data-testid="trash-progress" style={{ margin: "0 16px", fontSize: 12 }}>
            {progress ?? ""}
          </p>
          <ul
            ref={listRef}
            tabIndex={0}
            aria-label={t(`trash.tab.${tab}`, { n: String(count[tab]) })}
            style={{ listStyle: "none", margin: 0, overflowY: "auto", padding: "4px 12px 12px", display: "flex", flexDirection: "column", gap: 6, flex: 1, minHeight: 80 }}
          >
            {loaded && rows.length === 0 && (
              <li>
                <EmptyState style={{ fontSize: 13 }} message={t(tab === "deleted" ? "trash.empty" : "trash.noRenames")} action={{ label: t("trash.backToNotes"), onClick: onClose }} />
              </li>
            )}
            {loaded && rows.length > 0 && visible.length === 0 && (
              <li style={{ fontSize: 13, padding: 8, color: "hsl(var(--fg-muted))" }}>{t("trash.noMatch", { q: query })}</li>
            )}
            {visible.map((r) => {
              const checked = sel.selected.has(r.id);
              return (
                <li
                  key={r.id}
                  data-testid="trash-item"
                  data-selected={checked || undefined}
                  style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 8px", borderRadius: 6, background: checked ? "hsl(var(--accent) / 0.12)" : "hsl(var(--bg-subtle))" }}
                >
                  <input
                    type="checkbox"
                    data-id={r.id}
                    checked={checked}
                    aria-label={t("trash.selectRow", { path: r.path })}
                    style={{ width: 18, height: 18, margin: 3 }}
                    onClick={(e) => {
                      const shift = e.shiftKey;
                      setSel((s) => clickSelect(s, visibleIds, r.id, shift));
                    }}
                    onChange={() => undefined}
                    onKeyDown={(e) => onRowKey(e, r.id)}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div id={`trash-path-${r.id}`} style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "start" }} dir={pathDir(r.path)}>
                      <PathText path={r.path} />
                    </div>
                    <div style={{ fontSize: 11, color: "hsl(var(--fg-muted))" }} dir="auto">
                      {r.detail}
                    </div>
                  </div>
                  <button type="button" style={btn} onClick={() => void restore([r.id])} aria-describedby={`trash-path-${r.id}`}>
                    {tab === "deleted" ? t("trash.restore") : t("trash.undoRename")}
                  </button>
                  {tab === "deleted" && (
                    <button type="button" style={btn} onClick={() => void forever(r)} aria-describedby={`trash-path-${r.id}`}>
                      {t("trash.deleteForever")}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
        <footer style={{ padding: "10px 16px", borderTop: "1px solid hsl(var(--border))", display: "flex", flexDirection: "column", gap: 10, fontSize: 12 }}>
          <TrashRetention />
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <label htmlFor="trash-attachment-policy" style={{ flex: 1 }}>
              {t("attachCleanup.setting")}
            </label>
            <select
              id="trash-attachment-policy"
              data-testid="attachment-policy"
              value={policy}
              onChange={(e) => {
                const next = e.target.value as AttachmentPolicy;
                setAttachmentPolicy(next);
                setPolicy(next);
              }}
            >
              <option value="ask">{t("attachCleanup.setting.ask")}</option>
              <option value="always">{t("attachCleanup.setting.always")}</option>
              <option value="never">{t("attachCleanup.setting.never")}</option>
            </select>
          </div>
        </footer>
      </div>
    </Modal>
  );
}
