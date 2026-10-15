/**
 * Inline "this needs a higher plan" notice used by entitlement-gated UI
 * (audit log, persistent collab). Purely presentational — the gate itself
 * lives in `billing/gates.ts`.
 */

import { Lock } from "lucide-react";
import { t } from "../i18n";

interface Props {
  title?: string;
  message: string;
  onClose?: () => void;
  /** Compact variant for use inside a form instead of a whole dialog. */
  compact?: boolean;
}

export function UpgradeNotice({ title, message, onClose, compact }: Props) {
  return (
    <div
      role="status"
      data-testid="upgrade-notice"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: compact ? 4 : 12,
        padding: compact ? "8px 10px" : 24,
        textAlign: compact ? "start" : "center",
        alignItems: compact ? "stretch" : "center",
        fontSize: compact ? 12 : 13,
        color: "hsl(var(--fg-muted))",
        border: compact ? "1px dashed hsl(var(--border))" : undefined,
        borderRadius: compact ? 8 : undefined,
      }}
    >
      {!compact && <Lock size={22} aria-hidden="true" style={{ opacity: 0.6 }} />}
      {title && !compact && (
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "hsl(var(--fg))" }}>{title}</h2>
      )}
      <p style={{ margin: 0, lineHeight: 1.5 }}>
        {compact && <Lock size={11} aria-hidden="true" style={{ marginInlineEnd: 6, verticalAlign: "-1px" }} />}
        {message}
      </p>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="icon-btn"
          style={{ width: "auto", padding: "6px 16px", fontSize: 12 }}
        >
          {t("billing.upgrade.close")}
        </button>
      )}
    </div>
  );
}
