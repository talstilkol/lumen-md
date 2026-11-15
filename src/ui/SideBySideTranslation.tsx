/**
 * The side-by-side translation view (plan W12.H6): the note and its
 * translation in two columns, one row per paragraph, so they scroll
 * together. A paragraph whose source changed since it was translated is
 * marked out of date; "Translate" sends only those (and the missing ones),
 * and the result is saved as the sidecar `<note>.<lang>.md` (ai/mt/sideBySide).
 *
 * It names the layer that translated. Where Chrome's Translator API is not
 * available (phones, other browsers), the next local layer is used and the
 * view says so.
 */
import { useMemo, useState } from "react";
import { t } from "../i18n";
import "../ai/mt/strings";
import { align, parseSidecar, serializeSidecar, updateSidecar, type TranslateTexts } from "../ai/mt/sideBySide";

export interface SideBySideProps {
  sourcePath: string;
  sourceMd: string;
  /** The sidecar's text, or null when there is none yet. */
  sidecarMd: string | null;
  lang: string;
  translate: TranslateTexts;
  /** Is Chrome's Translator API there? (When not, the view says the next layer is used.) */
  chromeAvailable: boolean;
  onSave: (sidecarMd: string) => void | Promise<void>;
}

export function SideBySideTranslation({ sourcePath, sourceMd, sidecarMd, lang, translate, chromeAvailable, onSave }: SideBySideProps) {
  const sidecar = useMemo(() => (sidecarMd ? parseSidecar(sidecarMd) : null), [sidecarMd]);
  const rows = useMemo(() => align(sourceMd, sidecar), [sourceMd, sidecar]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const todo = rows.filter((r) => r.state !== "ok").length;
  const layer = sidecar?.layer ?? null;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await updateSidecar(sourcePath, sourceMd, sidecar, lang, translate);
      await onSave(serializeSidecar(r.sidecar));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label={t("mt.sideBySide.title")} data-testid="side-by-side" style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <strong style={{ flex: 1 }}>{t("mt.sideBySide.title")}</strong>
        {layer && <span data-testid="sbs-layer">{t("mt.sideBySide.layer", { layer: t(`mt.layer.name.${layer}`) })}</span>}
        {!chromeAvailable && <span data-testid="sbs-fallback" style={{ color: "hsl(var(--fg-muted))" }}>{t("mt.sideBySide.noChrome")}</span>}
        <button type="button" onClick={() => void run()} disabled={busy || todo === 0} style={{ minBlockSize: 24 }}>
          {todo ? t("mt.sideBySide.translate", { count: todo }) : t("mt.sideBySide.upToDate")}
        </button>
      </div>
      {error && <div role="alert">{t("mt.sideBySide.failed", { error })}</div>}
      <div role="table" aria-label={t("mt.sideBySide.title")} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px" }}>
        {rows.map((r, i) => (
          <div role="row" key={`${r.source.hash}-${i}`} data-state={r.state} data-testid="sbs-row" style={{ display: "contents" }}>
            <div role="cell" dir="auto" style={{ whiteSpace: "pre-wrap" }}>
              {r.source.text}
            </div>
            <div role="cell" dir="auto" lang={lang} style={{ whiteSpace: "pre-wrap", opacity: r.state === "stale" ? 0.6 : 1 }}>
              {r.state === "stale" && <span data-testid="sbs-stale" style={{ fontSize: 10, marginInlineEnd: 6, color: "hsl(var(--danger, 0 70% 50%))" }}>{t("mt.sideBySide.stale")}</span>}
              {r.translation ?? <span style={{ color: "hsl(var(--fg-muted))" }}>{t("mt.sideBySide.missing")}</span>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default SideBySideTranslation;
