/**
 * Settings > AI: what happened to each agent's suggestions on this device
 * (plan W13.A4) — accepted, edited first, rejected, cancelled, the median
 * time to decide, and a mark on an agent the eval should look at again.
 */
import { useState } from "react";
import { t } from "../i18n";
import { EVAL_AGENTS } from "../agents/agentIds";
import { clearOutcomes, FLAG_BELOW, FLAG_MIN_DECISIONS, loadOutcomes, outcomesReport, setShareOutcomes, shareOutcomesEnabled, type AgentReportRow } from "../metrics/suggestionOutcomes";
import "./suggestionOutcomesStrings";

const pct = (x: number | null) => (x === null ? "—" : new Intl.NumberFormat(document.documentElement.lang || undefined, { style: "percent", maximumFractionDigits: 0 }).format(x));
const secs = (ms: number | null) => (ms === null ? "—" : t("outcomes.seconds", { n: Math.max(1, Math.round(ms / 1000)) }));

export default function SuggestionOutcomesSection({ captionStyle, mutedStyle, buttonStyle }: { captionStyle: React.CSSProperties; mutedStyle: React.CSSProperties; buttonStyle: React.CSSProperties }) {
  const [rows, setRows] = useState<AgentReportRow[]>(() => outcomesReport(loadOutcomes(), EVAL_AGENTS));
  const [share, setShare] = useState(() => shareOutcomesEnabled());
  const cell: React.CSSProperties = { padding: "3px 6px", textAlign: "start", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
  return (
    <>
      <div id="ai-set-outcomes" style={captionStyle}>{t("outcomes.title")}</div>
      <div style={mutedStyle}>{t("outcomes.intro", { below: pct(FLAG_BELOW), min: FLAG_MIN_DECISIONS })}</div>
      <div tabIndex={0} role="region" aria-labelledby="ai-set-outcomes" style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
          <thead>
            <tr>
              {["agent", "proposed", "accepted", "edited", "rejected", "cancelled", "median"].map((h) => (
                <th key={h} scope="col" style={{ ...cell, fontWeight: 600, borderBottom: "1px solid hsl(var(--border))" }}>
                  {t(`outcomes.col.${h}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.agent} data-testid="outcome-row" data-agent={r.agent} data-flagged={r.flagged ? "1" : "0"}>
                <th scope="row" style={{ ...cell, fontWeight: 500 }}>
                  <bdi>{r.agent}</bdi>
                  {r.flagged && (
                    <span role="note" style={{ marginInlineStart: 6, fontSize: 11, padding: "0 6px", borderRadius: 8, border: "1px solid hsl(var(--danger, 0 72% 51%))", color: "hsl(var(--fg))", fontWeight: 600 }}>
                      {t("outcomes.flagged")}
                    </span>
                  )}
                </th>
                <td style={cell}>{r.proposed}</td>
                <td style={cell}>{pct(r.acceptRate)}</td>
                <td style={cell}>{pct(r.editRate)}</td>
                <td style={cell}>{pct(r.rejectRate)}</td>
                <td style={cell}>{pct(r.cancelRate)}</td>
                <td style={cell}>{secs(r.medianMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5 }}>
        <input type="checkbox" checked={share} onChange={(e) => (setShareOutcomes(e.target.checked), setShare(e.target.checked))} />
        <span>{t("outcomes.share")}</span>
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" style={buttonStyle} onClick={() => (clearOutcomes(), setRows(outcomesReport(loadOutcomes(), EVAL_AGENTS)))}>
          {t("outcomes.clear")}
        </button>
      </div>
    </>
  );
}
