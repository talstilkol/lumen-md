/**
 * "Indexing 3,200 / 10,000" in the status bar while a large vault is read
 * (plan W13.V6), gone when the index is ready. The workspace is usable all
 * along; search fills in as the notes arrive. Screen readers hear the start,
 * each quarter and the end — not every percent.
 */
import { useSyncExternalStore } from "react";
import { getLocale, t } from "../i18n";
import { indexProgress, subscribeIndexProgress } from "../storage/indexProgress";

export function IndexProgressStatus() {
  const p = useSyncExternalStore(subscribeIndexProgress, indexProgress, () => null);
  const locale = getLocale();
  const pct = p ? Math.floor((p.done * 100) / Math.max(1, p.total)) : 0;
  // The live region is there before anything is said in it (review 14 Low 8): a region mounted together
  // with its first text is often not announced.
  return (
    <>
      {p && (
        <span className="sb-item" data-testid="index-progress" title={t("status.indexing.title")}>
          <span aria-hidden="true">{t("status.indexing", { done: p.done.toLocaleString(locale), total: p.total.toLocaleString(locale) })}</span>
        </span>
      )}
      <span className="sr-only" role="status" data-testid="index-progress-sr">
        {p ? t("status.indexing.sr", { pct: Math.floor(pct / 25) * 25 }) : ""}
      </span>
    </>
  );
}
