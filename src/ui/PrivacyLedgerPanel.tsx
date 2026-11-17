/**
 * Privacy ledger panel (T37): every AI network request — where, how much,
 * why, under which policy — and what the policy blocked.
 */
import { Suspense, lazy, useEffect, useState, useSyncExternalStore } from "react";
import { ShieldCheck, X } from "lucide-react";
import { t, getLocale } from "../i18n";
import { auditMode, clearLedger, leftDevice, ledgerEntries, ledgerSummary, subscribeLedger, type LedgerEntry } from "../ai/privacyLedger";
import "../privacy/strings";
import { getAiPolicy } from "../ai/policy";
import { redactionLog, redactionTotals, subscribeRedactionLog } from "../ai/piiRedactor";
import { guardLog, guardTotals, subscribeGuardLog } from "../agents/guardLog";
import { EmptyState, learnHow } from "./EmptyState";
import { HelpButton } from "./HelpButton";
import "./privacyLedgerPanelStrings";
import { Modal } from "./Modal";
import { mcpBytesByClient, mcpClients, parseMcpLedger, readVaultMcpLedger, type McpLedgerRow } from "../privacy/mcpLedger";

interface Props {
  open: boolean;
  onClose: () => void;
  /** The vault's MCP ledger text (W11.I9); default: `.lumen/mcp/ledger.jsonl` of the open vault. */
  mcpLedger?: () => Promise<string | null>;
}

const btn: React.CSSProperties = { padding: "4px 10px", fontSize: 12, borderRadius: 6, border: "1px solid hsl(var(--border))", background: "transparent", color: "inherit", cursor: "pointer" };

function bytes(n: number | null): string {
  if (n === null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// W13.A3: when agents read AGENT-MEMORY.md, in its own chunk.
const MemoryReadsView = lazy(() => import("./MemoryReadsView"));

export function PrivacyLedgerPanel({ open, onClose, mcpLedger = readVaultMcpLedger }: Props) {
  const list = useSyncExternalStore(subscribeLedger, ledgerEntries, ledgerEntries);
  const [onlyCloud, setOnlyCloud] = useState(false);
  const redactions = useSyncExternalStore(subscribeRedactionLog, redactionLog, redactionLog);
  // W11.I2: the Rule of Two — runs that read outside content, and the approvals they asked for.
  const guard = useSyncExternalStore(subscribeGuardLog, guardLog, guardLog);
  const [exported, setExported] = useState<string | null>(null);

  // Plan W2.24: the session's ledger as a signed report (lazy: the signing code loads on use).
  const exportReport = () => {
    setExported(null);
    void import("../privacy/report")
      .then((m) => m.exportPrivacyReport(ledgerEntries(), { auditMode: auditMode() }))
      .then(
        (b) => {
          const r = JSON.parse(b.report) as { summary: { requests: number; leftDevice: number } };
          setExported(t("privacy.report.done", { n: r.summary.requests, left: r.summary.leftDevice }));
        },
        (e: unknown) => setExported(t("privacy.report.failed", { error: String((e as Error)?.message ?? e) })),
      );
  };

  // W11.I9: what MCP clients (outside agents) took from the vault, from the server's own ledger.
  const [tab, setTab] = useState<"requests" | "mcp" | "memory">("requests");
  const [mcp, setMcp] = useState<{ rows: McpLedgerRow[]; error?: string } | null>(null);
  const [mcpClient, setMcpClient] = useState("");
  useEffect(() => {
    if (!open) return;
    let live = true;
    mcpLedger().then(
      (text) => live && setMcp({ rows: text ? parseMcpLedger(text) : [] }),
      (e: unknown) => live && setMcp({ rows: [], error: String((e as Error)?.message ?? e) }),
    );
    return () => {
      live = false;
    };
  }, [open, mcpLedger]);

  if (!open) return null;
  const sum = ledgerSummary(list);
  const shown = [...list].reverse().filter((e) => !onlyCloud || leftDevice(e));
  const policy = getAiPolicy();
  const catLabel = (e: LedgerEntry) => t(`privacy.cat.${e.category}`);

  return (
    <Modal onClose={onClose} className="cmd-palette-backdrop" onClick={onClose} aria-label={t("privacy.title")}>
      <div className="cmd-palette" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760, padding: 0, display: "flex", flexDirection: "column", maxHeight: "82vh" }}>
        <header style={{ padding: "12px 16px", borderBottom: "1px solid hsl(var(--border))", display: "flex", gap: 10, alignItems: "center" }}>
          <ShieldCheck size={16} />
          <strong style={{ flex: 1 }}>{t("privacy.title")}</strong>
          <HelpButton topic="ai/privacy#the-privacy-ledger" />
          <button type="button" style={btn} onClick={onClose} aria-label={t("privacy.close")}>
            <X size={14} />
          </button>
        </header>
        <div style={{ padding: "10px 16px", display: "flex", flexWrap: "wrap", gap: "6px 16px", fontSize: 12.5, borderBottom: "1px solid hsl(var(--border))" }} data-testid="privacy-summary">
          <span>{t("privacy.policy", { policy: t(`privacy.policyName.${policy}`) })}</span>
          <span>{t("privacy.cloudRequests", { n: sum.cloudRequests, size: bytes(sum.cloudBytesOut) })}</span>
          <span>{t("privacy.localRequests", { n: sum.local })}</span>
          <span>{t("privacy.downloads", { n: sum.downloads })}</span>
          <span style={{ color: sum.blocked ? "hsl(var(--danger))" : undefined }}>{t("privacy.blocked", { n: sum.blocked })}</span>
          {sum.staticAssets > 0 && <span>{t("privacy.staticAssets", { n: sum.staticAssets })}</span>}
          <span data-testid="privacy-redacted">{t("pii.ledger.redacted", { n: redactionTotals(redactions).items, requests: redactionTotals(redactions).requests })}</span>
          {guard.length > 0 && <span data-testid="privacy-guard">{t("privacy.guard.summary", { ...guardTotals(guard) })}</span>}
        </div>
        <div role="tablist" style={{ padding: "8px 16px 0", display: "flex", gap: 6, fontSize: 12 }}>
          {(["requests", "mcp", "memory"] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} data-testid={`privacy-tab-${k}`} style={{ ...btn, fontWeight: tab === k ? 600 : 400 }} onClick={() => setTab(k)}>
              {t(`privacy.tab.${k}`)}
              {k === "mcp" && mcp?.rows.length ? ` (${mcp.rows.length})` : ""}
            </button>
          ))}
        </div>
        {tab === "memory" ? (
          <Suspense fallback={null}>
            <MemoryReadsView />
          </Suspense>
        ) : tab === "mcp" ? (
          <McpLedgerView state={mcp} client={mcpClient} onClient={setMcpClient} />
        ) : (
        <>
        {guard.some((g) => g.event !== "tainted") && (
          <ul style={{ margin: 0, padding: "6px 16px 8px 32px", fontSize: 12, borderBottom: "1px solid hsl(var(--border))" }} data-testid="privacy-guard-list" aria-label={t("privacy.guard.title")}>
            {[...guard].reverse().filter((g) => g.event !== "tainted").slice(0, 20).map((g) => (
              <li key={g.id} data-decision={g.event}>
                {t(`privacy.guard.${g.event}`, { tool: g.tool ?? "", what: t(`privacy.guard.scope.${g.scope ?? "write"}`), sources: g.sources, time: new Date(g.ts).toLocaleTimeString(getLocale()) })}
              </li>
            ))}
          </ul>
        )}
        <div style={{ padding: "8px 16px", display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center", flex: 1 }}>
            <input type="checkbox" checked={onlyCloud} onChange={(e) => setOnlyCloud(e.target.checked)} />
            {t("privacy.onlyLeaving")}
          </label>
          <button type="button" style={btn} onClick={exportReport} data-testid="privacy-export">
            {t("privacy.report.export")}
          </button>
          <button type="button" style={btn} onClick={clearLedger} disabled={!list.length}>
            {t("privacy.clear")}
          </button>
        </div>
        {(auditMode() || exported) && (
          <div style={{ padding: "0 16px 8px", fontSize: 12, display: "grid", gap: 4 }}>
            {auditMode() && <span data-testid="privacy-audit-mode">{t("privacy.audit.on")}</span>}
            {exported && <span role="status">{exported}</span>}
          </div>
        )}
        <div style={{ overflow: "auto", flex: 1 }}>
          {shown.length === 0 ? (
            <EmptyState
              style={{ fontSize: 13 }}
              message={t("privacy.empty")}
              action={{
                label: t("privacy.openAiSettings"),
                onClick: () => {
                  onClose();
                  window.dispatchEvent(new CustomEvent("lumen-open-ai-settings"));
                },
              }}
            />
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
                    <td style={{ padding: "6px 10px", whiteSpace: "nowrap", color: e.decision === "blocked" ? "hsl(var(--danger))" : undefined }}>
                      {t(`privacy.decision.${e.decision}`)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        </>
        )}
        <footer style={{ padding: "8px 16px", fontSize: 11.5, color: "hsl(var(--fg-muted))", borderTop: "1px solid hsl(var(--border))" }}>{t("privacy.footer")}</footer>
      </div>
    </Modal>
  );
}

/** The MCP tab (W11.I9): one row per MCP call, newest first, filtered by client. */
function McpLedgerView({ state, client, onClient }: { state: { rows: McpLedgerRow[]; error?: string } | null; client: string; onClient: (c: string) => void }) {
  if (!state) return <div style={{ padding: 16, fontSize: 12.5 }}>…</div>;
  if (state.error) return <div role="alert" style={{ padding: 16, fontSize: 12.5 }}>{t("privacy.mcp.unavailable", { error: state.error })}</div>;
  if (!state.rows.length) return <EmptyState testId="privacy-mcp-empty" message={t("privacy.mcp.empty")} action={learnHow("ai/mcp#turn-a-client-on")} />;
  const clients = mcpClients(state.rows);
  const shown = [...state.rows].reverse().filter((r) => !client || r.client === client);
  const sent = mcpBytesByClient(state.rows);
  return (
    <div style={{ overflow: "auto", flex: 1 }}>
      <div style={{ padding: "8px 16px", display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {t("privacy.mcp.client")}
          <select value={client} onChange={(e) => onClient(e.target.value)} data-testid="privacy-mcp-client">
            <option value="">{t("privacy.mcp.allClients")}</option>
            {clients.map((c) => (
              <option key={c} value={c}>
                {c} — {bytes(sent[c] ?? 0)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ color: "hsl(var(--fg-muted))" }}>
            {[t("privacy.col.time"), t("privacy.mcp.client"), t("privacy.mcp.col.tool"), t("privacy.mcp.col.path"), t("privacy.col.sent"), t("privacy.col.decision")].map((h) => (
              <th key={h} style={{ textAlign: "start", padding: "6px 10px", fontWeight: 600 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={`${r.ts}-${i}`} data-testid="privacy-mcp-row" data-client={r.client} data-decision={r.decision} style={{ borderTop: "1px solid hsl(var(--border))" }}>
              <td style={{ padding: "6px 10px", whiteSpace: "nowrap" }}>{new Date(r.ts).toLocaleString(getLocale())}</td>
              <td style={{ padding: "6px 10px" }}><bdi dir="ltr">{r.client}</bdi></td>
              <td style={{ padding: "6px 10px" }}><bdi dir="ltr">{r.tool}</bdi></td>
              <td style={{ padding: "6px 10px" }}>{r.path ? <bdi>{r.path}</bdi> : "—"}</td>
              <td style={{ padding: "6px 10px", whiteSpace: "nowrap" }}>{bytes(r.bytesOut)}</td>
              <td style={{ padding: "6px 10px", whiteSpace: "nowrap", color: r.decision === "denied" || r.decision === "rejected" ? "hsl(var(--danger))" : undefined }}>{t(`privacy.mcp.decision.${r.decision}`)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
