/**
 * Settings → Security: error and performance reports (plan W11.S19). Two
 * separate switches, both off by default, and the user's own error tracker
 * (a GlitchTip or Sentry DSN). Nothing is sent without a switch on AND a
 * tracker; what is sent is described next to each switch.
 */
import { useState } from "react";
import { t } from "../i18n";
import { getMonitoringConsent, getPerformanceConsent, getUserDsn, monitoringDsn, setMonitoringConsent, setPerformanceConsent, setUserDsn } from "../lib/telemetry";
import "./monitoringSettingsStrings";

const muted: React.CSSProperties = { fontSize: 12, color: "hsl(var(--fg-muted))" };
const field: React.CSSProperties = { width: "100%", padding: "6px 8px", border: "1px solid hsl(var(--border))", borderRadius: 6, background: "transparent", color: "inherit", font: "inherit" };

export function MonitoringSettings() {
  const [errors, setErrors] = useState(getMonitoringConsent);
  const [perf, setPerf] = useState(getPerformanceConsent);
  const [dsn, setDsn] = useState(() => getUserDsn() ?? "");
  const [dsnError, setDsnError] = useState(false);
  const [tracker, setTracker] = useState(() => monitoringDsn());
  return (
    <section aria-labelledby="monitoring-settings-title" style={{ display: "grid", gap: 8, marginTop: 16 }} data-testid="monitoring-settings">
      <h3 id="monitoring-settings-title" style={{ margin: 0, fontSize: 14 }}>
        {t("monitoring.settings.title")}
      </h3>
      <div style={muted}>{t(tracker ? "monitoring.settings.tracker" : "monitoring.settings.noTracker", { host: tracker ? new URL(tracker).host : "" })}</div>
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13 }}>
        <input type="checkbox" checked={errors} onChange={(e) => (setMonitoringConsent(e.target.checked), setErrors(e.target.checked))} />
        <span>
          {t("monitoring.settings.errors")}
          <span style={{ ...muted, display: "block" }}>{t("monitoring.settings.errorsNote")}</span>
        </span>
      </label>
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13 }}>
        <input type="checkbox" checked={perf} onChange={(e) => (setPerformanceConsent(e.target.checked), setPerf(e.target.checked))} />
        <span>
          {t("monitoring.settings.performance")}
          <span style={{ ...muted, display: "block" }}>{t("monitoring.settings.performanceNote")}</span>
        </span>
      </label>
      <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
        {t("monitoring.settings.dsn")}
        <input
          dir="ltr"
          type="url"
          spellCheck={false}
          placeholder="https://<key>@glitchtip.example.org/1"
          value={dsn}
          onChange={(e) => setDsn(e.target.value)}
          onBlur={() => {
            const ok = setUserDsn(dsn);
            setDsnError(!ok);
            if (ok) setTracker(monitoringDsn());
          }}
          style={field}
          aria-invalid={dsnError}
        />
      </label>
      <div role={dsnError ? "alert" : undefined} style={dsnError ? { fontSize: 12, color: "hsl(var(--danger))" } : muted}>
        {t(dsnError ? "monitoring.settings.dsnInvalid" : "monitoring.settings.dsnNote")}
      </div>
    </section>
  );
}
