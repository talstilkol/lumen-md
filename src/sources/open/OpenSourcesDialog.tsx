/**
 * The open-sources dialog (plan W7.24): one search over Sefaria, the
 * Knesset, data.gov.il / the CBS and the Ben-Yehuda library, with a rights
 * badge on every result, a filter by kind, and a switch per source.
 *
 * Local results appear as you type (nothing is sent). "Search online"
 * asks once, then queries only the sources that are on, through the
 * ledgered fetch. Keyboard: type, ↑/↓, Enter inserts, Alt+O searches online,
 * Esc closes; Tab reaches the filters and the switches.
 */
import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { getLocale, t } from "../../i18n";
import "./strings";
import "../../citations/CiteDialog.css";
import "./OpenSourcesDialog.css";
import { enabledSources, setSourceEnabled, type OpenSourceId } from "./gate";
import { KINDS, merge, type Kind, type LocalSources, type OpenResult } from "./search";
import { explainError } from "../../lib/userError";
import { HelpButton } from "../../ui/HelpButton";
import { Modal } from "../../ui/Modal";

export interface DialogDeps {
  /** Saved laws and the downloaded library (read from the vault once). */
  loadLocal: () => Promise<Omit<LocalSources, "enabled">>;
  searchLocal: (q: string, src: LocalSources, kind: Kind | null) => OpenResult[];
  /** The gated online search; null when the user declined. */
  searchOnline: (q: string, enabled: Record<OpenSourceId, boolean>, kind: Kind | null) => Promise<OpenResult[] | null>;
  /** The Markdown a result becomes (fetching what it needs, behind the same gate). null: nothing to insert. */
  insertion: (r: OpenResult) => Promise<string | null>;
  onInsert: (markdown: string) => void;
  onClose: () => void;
  /** W11.H16: import a file of the Open Book of Laws the user chose (stays on the device). */
  importOpenLaw?: (file: File, signal: AbortSignal, onProgress: (p: { done: number; total: number }) => void) => Promise<NonNullable<LocalSources["openLaw"]>>;
}

const SOURCES: readonly OpenSourceId[] = ["sefaria", "knesset", "openlaw", "datagov", "benyehuda", "registers"];

export function OpenSourcesDialog(d: DialogDeps) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Kind | null>(null);
  const [enabled, setEnabled] = useState(() => enabledSources());
  const [local, setLocal] = useState<Omit<LocalSources, "enabled"> | null>(null);
  const [online, setOnline] = useState<OpenResult[]>([]);
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const lawFile = useRef<HTMLInputElement>(null);
  const lawButton = useRef<HTMLButtonElement>(null);
  const [importing, setImporting] = useState<AbortController | null>(null);

  useEffect(() => {
    input.current?.focus();
    void d.loadLocal().then(setLocal, () => setLocal({ laws: [], library: null }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    setOnline([]);
    setSel(0);
  }, [query, kind]);

  const results = useMemo(() => (local ? merge(d.searchLocal(query, { ...local, enabled }, kind), online) : online), [d, local, query, kind, enabled, online]);

  const goOnline = async () => {
    if (!query.trim() || busy) return;
    setBusy(true);
    setStatus(t("openSources.searching"));
    try {
      const r = await d.searchOnline(query, enabled, kind);
      if (r === null) setStatus(t("openSources.declined"));
      else {
        setOnline(r);
        setStatus(t("openSources.found", { count: r.length }));
      }
    } catch (e) {
      setStatus(t("openSources.failed", { error: explainError(e, "open-sources") }));
    } finally {
      setBusy(false);
    }
  };

  const choose = async (r: OpenResult | undefined) => {
    if (!r || busy) return;
    setBusy(true);
    try {
      const md = await d.insertion(r);
      if (md) {
        d.onInsert(md);
        d.onClose();
      } else setStatus(t("openSources.declined"));
    } catch (e) {
      setStatus(t("openSources.failed", { error: explainError(e, "open-sources") }));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: OpenSourceId) => {
    setSourceEnabled(id, !enabled[id]);
    setEnabled(enabledSources());
  };

  // W11.H16: the user's own copy of the Open Book of Laws, read from a file on this device.
  const importLaw = async (file: File | undefined) => {
    if (!file || !d.importOpenLaw || importing) return;
    const ac = new AbortController();
    setImporting(ac);
    setStatus(t("openSources.openLaw.importing", { done: 0, total: "…" }));
    try {
      const index = await d.importOpenLaw(file, ac.signal, (p) => setStatus(t("openSources.openLaw.importing", { done: p.done, total: p.total })));
      setLocal((l) => ({ laws: l?.laws ?? [], library: l?.library ?? null, openLaw: index }));
      setStatus(t("openSources.openLaw.imported", { count: index.count }));
    } catch (e) {
      setStatus(ac.signal.aborted ? t("openSources.openLaw.cancelled") : t("openSources.openLaw.failed", { error: explainError(e, "open-sources") }));
    } finally {
      setImporting(null);
      if (lawFile.current) lawFile.current.value = "";
      lawButton.current?.focus();
    }
  };

  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      d.onClose();
    } else if (e.key === "ArrowDown" && e.target === input.current) {
      e.preventDefault();
      setSel((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp" && e.target === input.current) {
      e.preventDefault();
      setSel((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && e.target === input.current) {
      e.preventDefault();
      if (results.length) void choose(results[sel]);
      else void goOnline();
    } else if (e.altKey && e.code === "KeyO") {
      e.preventDefault();
      void goOnline();
    }
  };

  const active = results[sel] ? `os-opt-${sel}` : undefined;
  return (
    <Modal aria-labelledby="os-title" className="cite-backdrop" onMouseDown={(e) => e.target === e.currentTarget && d.onClose()}>
      <div className="cite-dialog os-dialog" data-testid="open-sources" onKeyDown={onKey}>
        <h2 id="os-title" className="os-title">
          {t("openSources.title")} <HelpButton topic="workspace/open-sources" />
        </h2>
        <div className="cite-fields">
          <input
            ref={input}
            dir="auto"
            type="search"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="os-results"
            aria-activedescendant={active}
            aria-autocomplete="list"
            value={query}
            placeholder={t("openSources.placeholder")}
            aria-label={t("openSources.placeholder")}
            onChange={(e) => setQuery(e.target.value)}
            data-testid="open-sources-query"
          />
          <button type="button" onClick={() => void goOnline()} disabled={busy || !query.trim()} data-testid="open-sources-online" aria-keyshortcuts="Alt+O">
            {t("openSources.online")}
          </button>
        </div>
        <div className="os-kinds" role="radiogroup" aria-label={t("openSources.kind")}>
          {[null, ...KINDS].map((k) => (
            <label key={k ?? "all"} className="os-kind">
              <input type="radio" name="os-kind" checked={kind === k} onChange={() => setKind(k)} />
              {t(`openSources.kind.${k ?? "all"}`)}
            </label>
          ))}
        </div>
        <ul id="os-results" className="cite-list" role="listbox" aria-label={t("openSources.results")}>
          {!results.length && <li className="cite-empty">{query.trim() ? t("openSources.noLocal") : t("openSources.hint")}</li>}
          {results.map((r, i) => (
            <li
              key={r.key}
              id={`os-opt-${i}`}
              role="option"
              aria-selected={i === sel}
              className={`cite-item${i === sel ? " sel" : ""}`}
              onMouseEnter={() => setSel(i)}
              onMouseDown={(e) => (e.preventDefault(), void choose(r))}
              data-testid="open-sources-item"
              data-rights={r.rights}
            >
              <span className="cite-title" dir="auto">
                {r.title}
              </span>
              <span className="cite-meta" dir="auto">
                {[t(`openSources.source.${r.source}`), r.detail].filter(Boolean).join(" · ")} {r.local ? `· ${t("openSources.onDevice")}` : ""}
              </span>
              <span className={`os-badge os-badge-${r.rights}`} data-testid="open-sources-badge">
                {t(`openSources.rights.${r.rights}`)}
              </span>
              {r.terms && (
                // R12.19: each register's licence light and its terms of use.
                <span className={`os-terms os-light-${r.terms.light}`} data-testid="open-sources-terms" dir="auto">
                  {t(`openSources.light.${r.terms.light}`)} · {getLocale() === "he" ? r.terms.noteHe : r.terms.noteEn}{" "}
                  <a href={r.terms.termsUrl} target="_blank" rel="noopener noreferrer" onMouseDown={(e) => e.stopPropagation()}>
                    {t("openSources.terms")}
                  </a>
                </span>
              )}
            </li>
          ))}
        </ul>
        <p className="os-status" role="status" aria-live="polite">
          {status}
        </p>
        <fieldset className="os-switches">
          <legend>{t("openSources.switches")}</legend>
          {SOURCES.map((id) => (
            <Fragment key={id}>
              <label className="os-switch">
                <input type="checkbox" checked={enabled[id]} onChange={() => toggle(id)} data-testid={`open-sources-switch-${id}`} />
                <span>{t(`openSources.source.${id}`)}</span>
                <span className="os-sends">{t(`openSources.sends.${id}`)}</span>
              </label>
              {id === "openlaw" && enabled.openlaw && d.importOpenLaw && (
                <div className="os-openlaw" data-testid="open-law-import">
                  <span className="os-sends" dir="auto">
                    {local?.openLaw ? t("openSources.openLaw.have", { count: local.openLaw.count, date: local.openLaw.imported.slice(0, 10) }) : t("openSources.openLaw.none")}
                  </span>
                  <input ref={lawFile} type="file" accept=".jsonl,.json,.ndjson,application/json" hidden tabIndex={-1} aria-hidden="true" onChange={(e) => void importLaw(e.target.files?.[0])} data-testid="open-law-file" />
                  {importing ? (
                    <button type="button" ref={lawButton} onClick={() => importing.abort()} data-testid="open-law-cancel">
                      {t("openSources.openLaw.cancel")}
                    </button>
                  ) : (
                    <button type="button" ref={lawButton} onClick={() => lawFile.current?.click()} data-testid="open-law-pick">
                      {local?.openLaw ? t("openSources.openLaw.replace") : t("openSources.openLaw.import")}
                    </button>
                  )}
                </div>
              )}
            </Fragment>
          ))}
        </fieldset>
        <div className="cite-foot">
          <span>{t("openSources.keys")}</span>
        </div>
      </div>
    </Modal>
  );
}

/* ─── Opening it over the app ──────────────────────────────────────── */

let open: { root: Root; host: HTMLElement } | null = null;

export async function openSourcesDialog(): Promise<void> {
  if (open) return;
  const app = await import("./app");
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  open = { root, host };
  const opener = document.activeElement as HTMLElement | null;
  const close = () => {
    if (!open) return;
    open.root.unmount();
    open.host.remove();
    open = null;
    opener?.focus?.();
  };
  root.render(
    <OpenSourcesDialog
      loadLocal={app.loadLocal}
      searchLocal={app.searchLocal}
      searchOnline={app.searchOnlineGated}
      insertion={app.insertion}
      onClose={close}
      importOpenLaw={(file, signal, onProgress) => import("../openlaw/app").then((m) => m.importOpenLawFile(file, { signal, onProgress }))}
      onInsert={(text) => window.dispatchEvent(new CustomEvent("lumen-mobile-insert", { detail: { insert: `\n\n${text}\n`, cursorOffset: 0 } }))}
    />,
  );
}
