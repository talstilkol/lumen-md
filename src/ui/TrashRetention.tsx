/**
 * Version-history retention, per vault (plan W13.S1), shown in the
 * "Deleted and renamed files" screen: how long old versions of notes and of
 * attachments are kept, what changing it would free (measured on this
 * vault's history, not guessed), and "Apply now".
 */
import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import {
  ATTACHMENT_DAY_OPTIONS,
  getRetention,
  NOTE_RETENTION_OPTIONS,
  runRetention,
  setRetention,
  type NoteRetention,
  type RetentionSettings,
} from "../storage/historyRetention";
import { getHistoryVault } from "../storage/history";
import { toast } from "../store/useToastStore";
import { trashBtn } from "./trashStyles";

/** A size, isolated (FSI…PDI) so "2.6 KB" keeps its order inside a Hebrew sentence. */
export function formatSize(bytes: number): string {
  return `\u2068${sizeText(bytes)}\u2069`;
}

function sizeText(bytes: number): string {
  if (bytes < 1024) return t("trash.retention.bytes", { n: String(bytes) });
  if (bytes < 1024 * 1024) return t("trash.retention.kb", { n: (bytes / 1024).toFixed(1) });
  return t("trash.retention.mb", { n: (bytes / 1024 / 1024).toFixed(1) });
}

export function TrashRetention() {
  const vault = getHistoryVault();
  const [s, setS] = useState<RetentionSettings>(() => getRetention(vault ?? ""));
  const [saving, setSaving] = useState<{ versions: number; documents: number; bytes: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const notesRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    let live = true;
    setSaving(null);
    void runRetention(Date.now(), { dryRun: true, settings: s })
      .then((r) => live && setSaving(r ?? { versions: 0, documents: 0, bytes: 0 }))
      .catch(() => live && setSaving({ versions: 0, documents: 0, bytes: 0 }));
    return () => {
      live = false;
    };
  }, [s]);

  if (vault === null) return null;
  const update = (next: RetentionSettings) => {
    setRetention(vault, next);
    setS(next);
  };
  const apply = async () => {
    setBusy(true);
    try {
      const r = await runRetention(Date.now(), { settings: s });
      toast.success(t("trash.retention.applied", { n: String(r?.versions ?? 0), size: formatSize(r?.bytes ?? 0) }));
      setSaving({ versions: 0, documents: 0, bytes: 0 });
    } catch {
      toast.error(t("trash.retention.failed"));
    } finally {
      setBusy(false);
      // The button is disabled now (nothing left to free): focus goes to the setting, never to <body>.
      notesRef.current?.focus();
    }
  };

  return (
    <section aria-labelledby="trash-retention-h" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <h3 id="trash-retention-h" style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>
        {t("trash.retention.title")}
      </h3>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <label htmlFor="retention-notes" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {t("trash.retention.notes")}
          <select ref={notesRef} id="retention-notes" data-testid="retention-notes" value={s.notes} onChange={(e) => update({ ...s, notes: e.target.value as NoteRetention })}>
            {NOTE_RETENTION_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {t(`trash.retention.notes.${o}`)}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="retention-attachments" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {t("trash.retention.attachments")}
          <select
            id="retention-attachments"
            data-testid="retention-attachments"
            value={String(s.attachmentDays)}
            onChange={(e) => update({ ...s, attachmentDays: Number(e.target.value) })}
          >
            {ATTACHMENT_DAY_OPTIONS.map((d) => (
              <option key={d} value={String(d)}>
                {d === 0 ? t("trash.retention.notes.forever") : t("trash.retention.days", { n: String(d) })}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <p aria-live="polite" data-testid="retention-saving" style={{ margin: 0, flex: 1, color: "hsl(var(--fg-muted))" }}>
          {saving === null
            ? t("trash.retention.measuring")
            : saving.versions === 0
              ? t("trash.retention.nothing")
              : t("trash.retention.saving", { n: String(saving.versions), docs: String(saving.documents), size: formatSize(saving.bytes) })}
        </p>
        <button type="button" style={trashBtn} disabled={busy || !saving?.versions} onClick={() => void apply()} data-testid="retention-apply">
          {t("trash.retention.apply")}
        </button>
      </div>
    </section>
  );
}
