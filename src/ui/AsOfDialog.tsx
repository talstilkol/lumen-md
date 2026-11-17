/**
 * W12.S2 — "What I knew then": a date slider over the vault's history, a
 * search of the vault as it was, a note opened read-only under a "this is
 * how it was on …" bar, and a then-vs-now word diff with "restore
 * paragraph" (one editor transaction, so Ctrl+Z undoes it).
 *
 * The slider is a native range input: in RTL the browser runs it right to
 * left, and arrow keys move it a day. The dialog states from which date
 * history exists (S1's `historyFrom`/`gitFrom`); nothing earlier is shown.
 */
import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { History, X } from "lucide-react";
import { getLocale, t } from "../i18n";
import { coverageFrom, vaultAsOf, type AsOfVault } from "../storage/asOf";
import { restoreHunks, type RestoreHunk } from "../storage/asOfRestore";
import { searchAsOf, type AsOfHit } from "../search/asOfSearch";
import { wordDiff } from "../collab/wordDiff";
import { toast } from "../store/useToastStore";
import { Modal } from "./Modal";
import "./asOfStrings";
import { HelpButton } from "./HelpButton";

const DAY = 86_400_000;
const field = { padding: "6px 8px", borderRadius: 6, border: "1px solid hsl(var(--border))", background: "hsl(var(--bg))", color: "inherit" } as const;

export interface AsOfDialogProps {
  onClose: () => void;
  /** The note open in the editor (its history key), for "restore paragraph". */
  activeName?: string | null;
  /** Put a restored paragraph into the open note; false when the editor's text moved on. */
  applyRestore?: (h: RestoreHunk) => boolean;
  /** "Now" (tests pass a fixed clock). */
  now?: number;
  /** Reads the vault as of a date (default: the history store, S1). */
  load?: (date: number) => Promise<AsOfVault>;
}

const historyLoad = (d: number) => vaultAsOf(d);

/** End of the day `days` days after the epoch, so a day's last save is included. */
const endOfDay = (days: number) => (days + 1) * DAY - 1;

export function AsOfDialog({ onClose, activeName = null, applyRestore, now: nowProp, load = historyLoad }: AsOfDialogProps) {
  const [now] = useState(() => nowProp ?? Date.now());
  const today = Math.floor(now / DAY);
  const [day, setDay] = useState(today);
  const [query, setQuery] = useState("");
  const [past, setPast] = useState<AsOfVault | null>(null);
  const [present, setPresent] = useState<AsOfVault | null>(null);
  const [hits, setHits] = useState<AsOfHit[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [compare, setCompare] = useState(false);
  const fmt = useMemo(() => new Intl.DateTimeFormat(getLocale(), { dateStyle: "long" }), []);

  useEffect(() => {
    let live = true;
    void load(now).then((v) => live && setPresent(v));
    return () => {
      live = false;
    };
  }, [load, now]);

  useEffect(() => {
    let live = true;
    const at = Math.min(endOfDay(day), now);
    void load(at).then(async (v) => {
      if (!live) return;
      setPast(v);
      const found = query.trim() ? await searchAsOf(v, query) : [];
      if (live) setHits(found);
    });
    return () => {
      live = false;
    };
  }, [day, query, load, now]);

  const from = present ? coverageFrom(present) : null;
  const minDay = from === null ? today : Math.min(today, Math.floor(from / DAY));
  const asOfLabel = fmt.format(Math.min(endOfDay(day), now));
  const note = open ? past?.notes.get(open) : undefined;
  const current = open ? present?.notes.get(open)?.content ?? "" : "";
  const hunks = useMemo(() => (note && compare ? restoreHunks(note.content, current) : []), [note, current, compare]);
  const canRestore = !!applyRestore && open !== null && open === activeName;

  const restore = (h: RestoreHunk) => {
    if (applyRestore?.(h)) toast.info(t("asOf.restored"));
    else toast.info(t("asOf.openToRestore"));
  };

  return (
    <Modal aria-labelledby="as-of-title" className="cmd-palette-backdrop" onClose={onClose} onClick={onClose}>
      <div className="cmd-palette" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760, maxHeight: "86vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid hsl(var(--border))" }}>
          <History size={16} aria-hidden="true" />
          <h2 id="as-of-title" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
            {t("asOf.title")}
          </h2>
          <HelpButton topic="workspace/history" />
          <button type="button" onClick={onClose} aria-label={t("asOf.close")} style={{ marginInlineStart: "auto", border: "none", background: "transparent", color: "inherit", cursor: "pointer" }}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>
        <div style={{ overflow: "auto", padding: "12px 16px", display: "grid", gap: 12 }}>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 12 }}>
              {t("asOf.date")}: <strong>{asOfLabel}</strong>
            </span>
            <input
              type="range"
              data-testid="as-of-slider"
              min={minDay}
              max={today}
              step={1}
              value={day}
              aria-valuetext={asOfLabel}
              onChange={(e) => {
                setDay(Number(e.target.value));
                setOpen(null);
              }}
            />
          </label>
          <p role="note" style={{ margin: 0, fontSize: 12, opacity: 0.8 }}>
            {from === null ? t("asOf.noHistory") : t("asOf.coverage", { date: fmt.format(from) })}
          </p>
          {!open ? (
            <>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ fontSize: 12 }}>{t("asOf.query")}</span>
                <input type="search" dir="auto" value={query} onChange={(e) => setQuery(e.target.value)} style={field} />
              </label>
              {query.trim() !== "" && (
                <p role="status" style={{ margin: 0, fontSize: 12 }}>
                  {/* empty-action: the search field right above */}
                  {hits.length ? t("asOf.results", { count: hits.length }) : t("asOf.none")}
                </p>
              )}
              <ul data-testid="as-of-results" style={{ margin: 0, paddingInlineStart: 18, fontSize: 13 }}>
                {hits.map((h) => (
                  <li key={h.id}>
                    <button type="button" dir="auto" onClick={() => setOpen(h.id)} style={{ border: "none", background: "transparent", color: "inherit", cursor: "pointer", textAlign: "start", padding: 2 }}>
                      {h.id} — {fmt.format(h.timestamp)}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              <div role="status" data-testid="as-of-banner" style={{ padding: "6px 10px", borderRadius: 6, background: "hsl(var(--muted))", fontSize: 13 }}>
                {t("asOf.banner", { date: fmt.format(note?.timestamp ?? endOfDay(day)) })}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" onClick={() => setOpen(null)} style={field}>
                  {t("asOf.back")}
                </button>
                <button type="button" aria-pressed={compare} onClick={() => setCompare((c) => !c)} style={field}>
                  {t("asOf.compare")}
                </button>
              </div>
              {!compare ? (
                <pre data-testid="as-of-note" dir="auto" tabIndex={0} aria-readonly="true" style={{ whiteSpace: "pre-wrap", margin: 0, padding: 10, border: "1px solid hsl(var(--border))", borderRadius: 6, fontFamily: "inherit" }}>
                  {note?.content ?? ""}
                </pre>
              ) : hunks.length === 0 ? (
                <p style={{ margin: 0, fontSize: 13 }}>{t("asOf.same")}</p>
              ) : (
                <ol data-testid="as-of-hunks" style={{ margin: 0, paddingInlineStart: 18, display: "grid", gap: 10 }}>
                  {hunks.map((h, i) => (
                    <li key={i}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{t(`asOf.${h.kind}`)}</div>
                      <div className="version-diff" dir="auto" style={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.6 }}>
                        {wordDiff(h.now, h.then).map((op, k) =>
                          op.type === "equal" ? <span key={k}>{op.text}</span> : op.type === "insert" ? <ins key={k} className="critic-ins">{op.text}</ins> : <del key={k} className="critic-del">{op.text}</del>,
                        )}
                      </div>
                      {h.kind !== "added" && (
                        <button type="button" disabled={!canRestore} title={canRestore ? undefined : t("asOf.openToRestore")} onClick={() => restore(h)} style={{ ...field, marginTop: 4 }}>
                          {t("asOf.restore")}
                        </button>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function openAsOfDialog(opts: Omit<AsOfDialogProps, "onClose"> = {}): void {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const close = () => {
    try {
      root.unmount();
    } catch {
      // why: the dialog root is already unmounted
    }
    host.remove();
  };
  root.render(<AsOfDialog {...opts} onClose={close} />);
}
