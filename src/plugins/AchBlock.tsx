/**
 * ```ach block (plan R12.20): Analysis of Competing Hypotheses in a note
 * (src/research/ach.ts) — the matrix of evidence × hypotheses with each
 * cell's mark, the hypotheses ranked with the least inconsistent first, and
 * Heuer's checks: rows that don't tell the hypotheses apart, a linchpin row
 * the verdict rests on, and whether the leader holds without the rows at
 * risk of deception.
 *
 * The matrix is a real table (row and column headers, a caption), so a
 * screen reader walks it; in a right-to-left note the first hypothesis is
 * on the right. "Copy as a table" puts it on the clipboard as Markdown.
 * The block is plain text in the note, so it is the same in source and
 * WYSIWYG editing. Loaded on demand.
 */

import { useMemo, useState } from "react";
import { t } from "../i18n";
import "./achBlockStrings";
import { achMarkdownTable, markOf, parseAch, scoreAch, type AchMark } from "../research/ach";

const MARK_KEY: Record<AchMark, string> = { CC: "ach.mark.CC", C: "ach.mark.C", N: "ach.mark.N", I: "ach.mark.I", II: "ach.mark.II" };

export default function AchBlock({ source }: { source: string }) {
  const model = useMemo(() => parseAch(source), [source]);
  const score = useMemo(() => scoreAch(model), [model]);
  const [copied, setCopied] = useState(false);
  const byId = useMemo(() => new Map(model.hypotheses.map((h) => [h.id, h])), [model]);
  const rowInfo = useMemo(() => new Map(score.rows.map((r) => [r.id, r])), [score]);
  const ordered = score.hypotheses.map((s) => ({ ...s, text: byId.get(s.id)?.text ?? "" }));
  const title = model.title ?? t("ach.title");
  const labels = { evidence: t("ach.evidence"), weight: t("ach.weight"), inconsistency: t("ach.inconsistency"), consistency: t("ach.consistency") };

  const copy = () => {
    const md = achMarkdownTable(model, score, labels);
    void navigator.clipboard?.writeText(md).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="chart-block lumen-ach-block" dir="auto" data-ach-leader={score.leader ?? ""}>
      <div className="chart-block-header">
        <span style={{ fontWeight: 600 }} dir="auto">
          {title}
        </span>
        <button type="button" onClick={copy} className="chart-block-tab" data-ach-copy="">
          {copied ? t("ach.copied") : t("ach.copy")}
        </button>
        {/* the button's new label is not announced by itself: a polite live region says it once */}
        <span className="sr-only" role="status" aria-live="polite" data-ach-copied-status="">
          {copied ? t("ach.copied") : ""}
        </span>
      </div>
      <div style={{ padding: 8, fontSize: 13 }}>
        {model.problems.length > 0 && (
          <div role="alert" style={{ color: "hsl(var(--danger))", fontSize: 12, marginBlock: 4 }}>
            <ul>
              {model.problems.map((p) => (
                <li key={p} dir="auto">
                  {p}
                </li>
              ))}
            </ul>
          </div>
        )}
        {model.hypotheses.length < 2 ? (
          <p style={{ color: "hsl(var(--fg-muted))" }}>{t("ach.needTwo")}</p>
        ) : (
          <>
            <ol className="lumen-ach-ranking" aria-label={t("ach.ranking")}>
              {ordered.map((h) => (
                <li key={h.id} data-ach-rank={h.rank} aria-current={h.id === score.leader ? "true" : undefined}>
                  <strong dir="auto">
                    {h.id}
                    {h.text ? `: ${h.text}` : ""}
                  </strong>{" "}
                  <span>{t("ach.scores", { inconsistency: h.inconsistency, consistency: h.consistency })}</span>
                </li>
              ))}
            </ol>
            <p data-ach-summary="">{t("ach.leader", { id: score.leader ?? "", margin: score.margin ?? 0 })}</p>
            {score.linchpins.length > 0 && <p data-ach-linchpins="">{t("ach.linchpins", { rows: score.linchpins.join(", ") })}</p>}
            {score.deception.rows.length > 0 && (
              <p data-ach-deception="">{score.deception.changes ? t("ach.deception.changes", { id: score.deception.leaderWithout ?? "" }) : t("ach.deception.holds")}</p>
            )}
            {score.unmarked > 0 && <p style={{ color: "hsl(var(--fg-muted))" }}>{t("ach.unmarked", { count: score.unmarked })}</p>}
          </>
        )}
        {model.hypotheses.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table className="lumen-ach-table">
              <caption dir="auto">{t("ach.caption", { title })}</caption>
              <thead>
                <tr>
                  <th scope="col">{labels.evidence}</th>
                  <th scope="col">{labels.weight}</th>
                  {ordered.map((h) => (
                    <th key={h.id} scope="col" dir="auto" title={h.text || undefined}>
                      {h.id}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {model.rows.map((r) => {
                  const info = rowInfo.get(r.id);
                  return (
                    <tr key={r.id} data-ach-row={r.id} data-diagnostic={info?.diagnostic ? "" : undefined}>
                      <th scope="row" dir="auto">
                        {r.id}
                        {r.text ? `: ${r.text}` : ""}
                        {r.deceptive && <span className="lumen-ach-flag"> · {t("ach.flag.deceptive")}</span>}
                        {score.linchpins.includes(r.id) && <span className="lumen-ach-flag"> · {t("ach.flag.linchpin")}</span>}
                        {model.hypotheses.length > 1 && !info?.diagnostic && <span className="lumen-ach-flag"> · {t("ach.flag.notDiagnostic")}</span>}
                      </th>
                      <td>
                        <bdi>{r.weight}</bdi>
                      </td>
                      {ordered.map((h) => {
                        const m = markOf(r, h.id);
                        return (
                          <td key={h.id} data-mark={m} aria-label={`${m} — ${t(MARK_KEY[m])}`}>
                            <bdi>{m}</bdi>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">{labels.inconsistency}</th>
                  <td />
                  {ordered.map((h) => (
                    <td key={h.id}>
                      <bdi>{h.inconsistency}</bdi>
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">{labels.consistency}</th>
                  <td />
                  {ordered.map((h) => (
                    <td key={h.id}>
                      <bdi>{h.consistency}</bdi>
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
