/**
 * Privacy ledger panel (T37): every AI network request — where, how much,
 * why, under which policy — and what the policy blocked.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { ShieldCheck, X } from "lucide-react";
import { t, getLocale } from "../i18n";
import { clearLedger, leftDevice, ledgerEntries, ledgerSummary, subscribeLedger, type LedgerEntry } from "../ai/privacyLedger";
import { getAiPolicy } from "../ai/policy";

interface Props {
  open: boolean;
  onClose: () => void;
}

const btn: React.CSSProperties = { padding: "4px 10px", fontSize: 12, borderRadius: 6, border: "1px solid hsl(var(--border))", background: "transparent", color: "inherit", cursor: "pointer" };

function bytes(n: number | null): string {
  if (n === null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function PrivacyLedgerPanel({ open, onClose }: Props) {
  const list = useSyncExternalStore(subscribeLedger, ledgerEntries, ledgerEntries);
  const [onlyCloud, setOnlyCloud] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const sum = ledgerSummary(list);
  const shown = [...list].reverse().filter((e) => !onlyCloud || leftDevice(e));
  const policy = getAiPolicy();
  const catLabel = (e: LedgerEntry) => t(`privacy.cat.${e.category}`);

  return (
    <div className="cmd-palette-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label={t("privacy.title")}>
      <div className="cmd-palette" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760, padding: 0, display: "flex", flexDirection: "column", maxHeight: "82vh" }}>
        <header style={{ padding: "12px 16px", borderBottom: "1px solid hsl(var(--border))", display: "flex", gap: 10, alignItems: "center" }}>
          <ShieldCheck size={16} />
          <strong style={{ flex: 1 }}>{t("privacy.title")}</strong>
          <button type="button" style={btn} onClick={onClose} aria-label={t("privacy.close")}>
            <X size={14} />
          </button>
        </header>
        <div style={{ padding: "10px 16px", display: "flex", flexWrap: "wrap", gap: "6px 16px", fontSize: 12.5, borderBottom: "1px solid hsl(var(--border))" }} data-testid="privacy-summary">
          <span>{t("privacy.policy", { policy: t(`privacy.policyName.${policy}`) })}</span>
          <span>{t("privacy.cloudRequests", { n: sum.cloudRequests, size: bytes(sum.cloudBytesOut) })}</span>
          <span>{t("privacy.localRequests", { n: sum.local })}</span>
          <span>{t("privacy.downloads", { n: sum.downloads })}</span>
          <span style={{ color: sum.blocked ? "hsl(0 70% 55%)" : undefined }}>{t("privacy.blocked", { n: sum.blocked })}</span>
        </div>
        <div style={{ padding: "8px 16px", display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center", flex: 1 }}>
            <input type="checkbox" checked={onlyCloud} onChange={(e) => setOnlyCloud(e.target.checked)} />
            {t("privacy.onlyLeaving")}
          </label>
          <button type="button" style={btn} onClick={clearLedger} disabled={!list.length}>
            {t("privacy.clear")}
          </button>
        </div>
        <div style={{ overflow: "auto", flex: 1 }}>
          {shown.length === 0 ? (
            <p style={{ padding: "16px", color: "hsl(var(--fg-muted))", fontSize: 13, margin: 0 }}>{t("privacy.empty")}</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ color: "hsl(var(--fg-muted))", textAlign: "start" }}>
                  {["time", "where", "why", "sent", "received", "decision"].map((h) => (
                    <th key={h} style={{ textAlign: "start", padding: "6px 10px", fontWeight: 600 }}>{t(`privacy.col.${h}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.id} data-testid="privacy-row" data-decision={e.decision} style={{ borderTop: "1px solid hsl(var(--border))" }}>
                    <td style={{ padding: "6px 10px", whiteSpace: "nowrap" }}>{new Date(e.ts).toLocaleTimeString(getLocale())}</td>
                    <td style={{ padding: "6px 10px" }}>
                      <bdi dir="ltr">{e.host}</bdi>
                      <div style={{ color: "hsl(var(--fg-muted))" }}>{catLabel(e)}</div>
                    </td>
                    <td style={{ padding: "6px 10px" }}>{e.reason}</td>
                    <td style={{ padding: "6px 10px", whiteSpace: "nowrap" }}>{bytes(e.bytesOut)}</td>
                    <td style={{ padding: "6px 10px", whiteSpace: "nowrap" }}>{bytes(e.bytesIn)}</td>
                    <td style={{ padding: "6px 10px", whiteSpace: "nowrap", color: e.decision === "blocked" ? "hsl(0 70% 55%)" : undefined }}>
                      {t(`privacy.decision.${e.decision}`)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <footer style={{ padding: "8px 16px", fontSize: 11.5, color: "hsl(var(--fg-muted))", borderTop: "1px solid hsl(var(--border))" }}>{t("privacy.footer")}</footer>
      </div>
    </div>
  );
}
