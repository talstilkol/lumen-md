/**
 * The automations manager (plan W5.24): every "when … then …" rule with an
 * on/off switch, a dry run of one rule (or all of them) on the open note that
 * shows the very lines each change would write — and writes nothing — and
 * the log of runs, each with its own byte-exact undo. Deleting a rule can be
 * undone too. Loaded on demand from the palette (./openPanel.tsx).
 *
 * Keyboard: the dialog traps focus (Modal); after every action focus lands
 * on what the action produced (the dry run's heading, the "Undo" of a
 * deleted rule, a run's "Undone" mark), never on the page body.
 */
import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import "./automationStrings";
import "../ui/PromptDialog.css";
import "./AutomationsPanel.css";
import { Modal } from "../ui/Modal";
import { explainError } from "../lib/userError";
import { describeRule, dryRunEventFor, previewChanges, type ChangePreview } from "./describe";
import type { Plan, Rule, RunLogEntry, VaultEvent } from "./engine";

export type UndoResult = { ok: true; entry: RunLogEntry } | { ok: false; reason: "none" } | { ok: false; reason: "changed"; path: string };

/** What the panel needs from ./app.ts (injected, so tests run it over an in-memory vault). */
export interface AutomationsApi {
  loadRules(): Promise<Rule[]>;
  readLog(): Promise<RunLogEntry[]>;
  setRuleEnabled(id: string, enabled: boolean): Promise<Rule[]>;
  deleteRule(id: string): Promise<{ rule: Rule; index: number } | null>;
  restoreRule(rule: Rule, index: number): Promise<Rule[]>;
  dryRun(event: VaultEvent, only?: Rule[]): Promise<Plan>;
  undoRunById(id: string): Promise<UndoResult>;
}

export interface AutomationsPanelProps {
  api: AutomationsApi;
  /** The open note (path in the vault, or null when it is not saved there). */
  doc: { path: string | null; text: string };
  today: string;
  onNewRule: () => void;
  onClose: () => void;
}

interface DryResult {
  title: string;
  previews: ChangePreview[];
  plan: Plan;
}

const DRY = "\u0000dry";
/** A path or name inside a sentence of the other direction: isolated (FSI … PDI), so "Inbox/פגישה.md" keeps its order. */
const iso = (s: string) => `\u2068${s}\u2069`;

/** The log's event ("created <path>", "changed <path>", "daily <date>") in the reader's language. */
export function eventLabel(event: string): string {
  const m = /^(created|changed|daily) (.*)$/s.exec(event);
  if (!m) return event;
  return m[1] === "daily" ? t("automations.manager.event.daily", { date: iso(m[2]) }) : t(`automations.manager.event.${m[1]}`, { path: iso(m[2]) });
}

export function AutomationsPanel({ api, doc, today, onNewRule, onClose }: AutomationsPanelProps) {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [log, setLog] = useState<RunLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<{ rule: Rule; index: number } | null>(null);
  const [dry, setDry] = useState<DryResult | null>(null);
  const [busy, setBusy] = useState(false);
  const dryHeading = useRef<HTMLHeadingElement | null>(null);
  const undoDeleteBtn = useRef<HTMLButtonElement | null>(null);
  const statusRef = useRef<HTMLParagraphElement | null>(null);
  const newBtn = useRef<HTMLButtonElement | null>(null);
  const focusNext = useRef<(() => void) | null>(null);

  const fail = (e: unknown) => setError(t("automations.failed", { error: explainError(e) }));

  useEffect(() => {
    let live = true;
    Promise.all([api.loadRules(), api.readLog()])
      .then(([r, l]) => live && (setRules(r), setLog(l)))
      .catch((e) => live && (setRules([]), fail(e)));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open
  }, []);

  // Move focus after the render an action caused (its target exists only then).
  useEffect(() => {
    const f = focusNext.current;
    focusNext.current = null;
    f?.();
  });

  const nameOf = (id: string) => rules?.find((r) => r.id === id.replace(DRY, ""))?.name ?? id.replace(DRY, "");

  async function toggle(r: Rule, on: boolean) {
    setError(null);
    try {
      setRules(await api.setRuleEnabled(r.id, on));
      setStatus(t(on ? "automations.manager.turnedOn" : "automations.manager.turnedOff", { name: r.name }));
    } catch (e) {
      fail(e);
    }
  }

  async function remove(r: Rule) {
    setError(null);
    try {
      const d = await api.deleteRule(r.id);
      if (!d) return;
      setDeleted(d);
      setRules((cur) => (cur ?? []).filter((x) => x.id !== r.id));
      setStatus(t("automations.manager.deleted", { name: r.name }));
      focusNext.current = () => undoDeleteBtn.current?.focus();
    } catch (e) {
      fail(e);
    }
  }

  async function restore() {
    if (!deleted) return;
    try {
      setRules(await api.restoreRule(deleted.rule, deleted.index));
      setStatus(t("automations.manager.restored", { name: deleted.rule.name }));
      const id = deleted.rule.id;
      setDeleted(null);
      focusNext.current = () => document.getElementById(`automation-rule-${id}-on`)?.focus();
    } catch (e) {
      fail(e);
    }
  }

  async function runDry(only: Rule[] | null) {
    setError(null);
    const list = only ?? (rules ?? []).filter((r) => r.enabled);
    if (!list.length) return;
    setBusy(true);
    try {
      // A dry run of one rule tries it even when it is off, and even if a daily rule already ran today.
      const clones = list.map((r) => ({ ...r, id: `${r.id}${DRY}`, enabled: true }));
      const merged: Plan = { changes: [], fired: [], stopped: [], dailyRan: {}, postponed: [] };
      // One event per distinct kind of trigger (a daily rule and a note rule see different events).
      const groups = new Map<string, { event: VaultEvent; rules: Rule[] }>();
      for (const r of clones) {
        const ev = dryRunEventFor(r, doc, today);
        if (!ev) continue;
        const key = JSON.stringify(ev);
        const g = groups.get(key) ?? { event: ev, rules: [] };
        g.rules.push(r);
        groups.set(key, g);
      }
      for (const g of groups.values()) {
        const p = await api.dryRun(g.event, g.rules);
        merged.changes.push(...p.changes);
        merged.fired.push(...p.fired);
        merged.stopped.push(...p.stopped);
        merged.postponed.push(...p.postponed);
      }
      const note = iso(doc.path ?? t("automations.manager.noNoteName"));
      setDry({ title: only?.length === 1 ? t("automations.manager.dryTitleOne", { rule: iso(only[0].name), note }) : t("automations.manager.dryTitleAll", { note }), previews: previewChanges(merged.changes), plan: merged });
      focusNext.current = () => dryHeading.current?.focus();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function undo(entry: RunLogEntry) {
    setError(null);
    try {
      const r = await api.undoRunById(entry.id);
      if (r.ok) {
        setLog((cur) => cur.map((e) => (e.id === entry.id ? { ...e, undone: true } : e)));
        setStatus(t("automations.manager.undoDone", { event: eventLabel(entry.event) }));
      } else setStatus(r.reason === "changed" ? t("automations.undo.changed", { path: r.path }) : t("automations.undo.none"));
      focusNext.current = () => statusRef.current?.focus();
    } catch (e) {
      fail(e);
    }
  }

  const lang = typeof document !== "undefined" ? document.documentElement.lang || undefined : undefined;
  const when = (at: string) => {
    try {
      return new Date(at).toLocaleString(lang, { dateStyle: "short", timeStyle: "short" });
    } catch {
      return at;
    }
  };
  const anyOn = !!rules?.some((r) => r.enabled);

  return (
    <Modal aria-labelledby="automations-title" aria-describedby="automations-intro" onClose={onClose} className="prompt-backdrop" data-testid="automations-panel">
      <div className="prompt-dialog automations-panel">
        <div className="automations-head">
          <h2 id="automations-title" className="prompt-title automations-h2">
            {t("automations.manager.title")}
          </h2>
          <div className="automations-tools">
            <button ref={newBtn} type="button" className="prompt-btn prompt-btn-ok" onClick={onNewRule} data-testid="automations-new">
              {t("automations.manager.newRule")}
            </button>
            <button type="button" className="prompt-btn prompt-btn-cancel" onClick={() => void runDry(null)} disabled={!anyOn || !doc.path || busy} data-testid="automations-dry-all">
              {t("automations.manager.dryAll")}
            </button>
          </div>
        </div>
        <p id="automations-intro" className="prompt-message automations-intro">
          {t("automations.manager.intro")}
          {!doc.path && (
            <>
              {" "}
              {t("automations.manager.noNote")}
            </>
          )}
        </p>
        {error && (
          <p role="alert" className="automations-error">
            {error}
          </p>
        )}
        <p ref={statusRef} role="status" tabIndex={-1} className="automations-status" data-testid="automations-status">
          {status}
          {deleted && (
            <>
              {" "}
              <button ref={undoDeleteBtn} type="button" className="prompt-btn prompt-btn-cancel automations-small" onClick={() => void restore()} data-testid="automations-undo-delete">
                {t("automations.manager.undoDelete")}
              </button>
            </>
          )}
        </p>
        <div className="automations-body" tabIndex={0} aria-label={t("automations.manager.title")}>
          <section aria-labelledby="automations-rules-h">
            <h3 id="automations-rules-h" className="automations-h3">
              {t("automations.manager.rules", { count: rules?.length ?? 0 })}
            </h3>
            {rules === null ? (
              <p className="automations-muted">{t("automations.manager.loading")}</p>
            ) : rules.length === 0 ? (
              <p className="automations-muted" data-testid="automations-empty">
                {t("automations.manager.rulesEmpty")}
              </p>
            ) : (
              <ul className="automations-list">
                {rules.map((r) => {
                  const d = describeRule(r, t);
                  const id = `automation-rule-${r.id}`;
                  return (
                    <li key={r.id} className="automations-rule" data-testid={id} data-enabled={r.enabled ? "true" : "false"}>
                      <label className="automations-switch">
                        <input id={`${id}-on`} type="checkbox" role="switch" checked={r.enabled} onChange={(e) => void toggle(r, e.currentTarget.checked)} aria-describedby={`${id}-desc`} />
                        <span className="automations-name" dir="auto">
                          {r.name}
                        </span>
                      </label>
                      <div id={`${id}-desc`} className="automations-desc">
                        <div dir="auto">
                          <span className="automations-kw">{t("automations.manager.when")}</span> {d.when}
                        </div>
                        {d.then.map((x, i) => (
                          <div key={i} dir="auto">
                            <span className="automations-kw">{t("automations.manager.then")}</span> {x}
                          </div>
                        ))}
                        {r.notOnRestDays && <div className="automations-muted">{t("automations.restDays.notOnRestDays")}</div>}
                      </div>
                      <div className="automations-row-actions">
                        <button type="button" className="prompt-btn prompt-btn-cancel automations-small" onClick={() => void runDry([r])} disabled={busy || (!doc.path && r.when.kind !== "daily")} aria-label={t("automations.manager.dryOneLabel", { name: r.name })}>
                          {t("automations.manager.dryOne")}
                        </button>
                        <button type="button" className="prompt-btn prompt-btn-cancel automations-small automations-danger" onClick={() => void remove(r)} aria-label={t("automations.manager.deleteLabel", { name: r.name })}>
                          {t("automations.manager.delete")}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {dry && (
            <section aria-labelledby="automations-dry-h" className="automations-dry" data-testid="automations-dry">
              <h3 id="automations-dry-h" ref={dryHeading} tabIndex={-1} className="automations-h3" dir="auto">
                {dry.title}
              </h3>
              <p className="automations-safe" data-testid="automations-dry-safe">
                {t("automations.manager.nothingWritten")}
              </p>
              {!dry.previews.length && !dry.plan.postponed.length && <p className="automations-muted">{t("automations.dryRun.none")}</p>}
              {dry.previews.map((c, i) => (
                <Preview key={i} c={c} ruleName={nameOf(c.rule)} />
              ))}
              {dry.plan.postponed.map((x, i) => (
                <p key={`p${i}`} className="automations-muted">
                  {t(x.why.reason === "shabbat" ? "automations.dryRun.postponedShabbat" : "automations.dryRun.postponedYomTov", { rule: nameOf(x.rule), until: x.until })}
                </p>
              ))}
              {dry.plan.stopped.length > 0 && <p className="automations-muted">{t("automations.dryRun.stopped", { count: dry.plan.stopped.length })}</p>}
            </section>
          )}

          <section aria-labelledby="automations-runs-h">
            <h3 id="automations-runs-h" className="automations-h3">
              {t("automations.manager.runs")}
            </h3>
            {log.length === 0 ? (
              <p className="automations-muted" data-testid="automations-runs-empty">
                {t("automations.manager.runsEmpty")}
              </p>
            ) : (
              <ul className="automations-list">
                {log.map((e) => {
                  const files = [...new Set(e.changes.map((c) => (c.kind === "write" ? c.path : c.kind === "move" ? c.to : c.path ?? "")).filter(Boolean))];
                  return (
                    <li key={e.id} className="automations-run" data-testid={`automation-run-${e.id}`} data-undone={e.undone ? "true" : "false"}>
                      <div className="automations-run-main">
                        <span className="automations-muted">{when(e.at)}</span>{" "}
                        <span dir="auto">{eventLabel(e.event)}</span>
                        <div className="automations-muted" dir="auto">
                          {t("automations.manager.runChanges", { count: e.changes.length })}
                          {files.length ? ` · ${files.slice(0, 3).join(", ")}${files.length > 3 ? "…" : ""}` : ""}
                        </div>
                      </div>
                      {e.undone ? (
                        <span className="automations-badge">{t("automations.manager.undone")}</span>
                      ) : (
                        <button type="button" className="prompt-btn prompt-btn-cancel automations-small" onClick={() => void undo(e)} aria-label={t("automations.manager.undoLabel", { event: eventLabel(e.event) })}>
                          {t("automations.manager.undo")}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
        <div className="prompt-actions">
          <button type="button" className="prompt-btn prompt-btn-cancel" onClick={onClose} data-testid="automations-close">
            {t("automations.manager.close")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Preview({ c, ruleName }: { c: ChangePreview; ruleName: string }) {
  return (
    <div className="automations-change" data-testid="automations-change">
      <div className="automations-change-head" dir="auto">
        <strong>{ruleName}</strong> · <bdi>{c.path}</bdi>{" "}
        {c.kind === "write" && <span className="automations-muted">{c.created ? t("automations.manager.newNote") : t("automations.manager.lines", { added: c.added, removed: c.removed })}</span>}
        {c.kind === "move" && <span className="automations-muted">{t("automations.manager.movedFrom", { from: c.from ?? "" })}</span>}
        {c.kind === "agent" && <span className="automations-muted">{t("automations.manager.agentWaits")}</span>}
      </div>
      {c.lines.length > 0 && (
        // A code-like block in its own direction per line: Hebrew lines read right to left, + and − stay at the start.
        <div className="automations-diff" role="group" aria-label={t("automations.manager.diffLabel", { path: c.path })} tabIndex={0}>
          {c.lines.map((l, i) =>
            l.op === "gap" ? (
              <div key={i} className="automations-gap" aria-hidden="true">
                ⋯
              </div>
            ) : (
              <div key={i} className={`automations-line automations-${l.op}`}>
                <span className="automations-sign" aria-hidden="true">
                  {l.op === "add" ? "+" : l.op === "del" ? "−" : " "}
                </span>
                {l.op !== "eq" && <span className="sr-only">{t(l.op === "add" ? "automations.manager.added" : "automations.manager.removed")} </span>}
                <span dir="auto">{l.line || " "}</span>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

export default AutomationsPanel;
