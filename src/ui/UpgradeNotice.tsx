/**
 * Inline "this needs a higher plan" notice used by entitlement-gated UI
 * (audit log, persistent collab). Purely presentational — the gate itself
 * lives in `billing/gates.ts`.
 */

import { Lock } from "lucide-react";
import { t } from "../i18n";
import { canPurchasePlans, hasManageableSubscription, manageBilling, upgradeTo } from "../billing/planActions";

interface Props {
  title?: string;
  message: string;
  onClose?: () => void;
  /** Compact variant for use inside a form instead of a whole dialog. */
  compact?: boolean;
  /** Plan that unlocks the feature: shows an "Upgrade" action (billing builds only). */
  plan?: "pro" | "team";
}

export function UpgradeNotice({ title, message, onClose, compact, plan }: Props) {
  const showActions = !!plan && canPurchasePlans();
  const manage = showActions && hasManageableSubscription();
  const actionStyle = { width: "auto", padding: compact ? "3px 10px" : "6px 16px", fontSize: compact ? 11 : 12 } as const;
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
      {showActions && (
        <div style={{ display: "flex", gap: 8, justifyContent: compact ? "flex-start" : "center", flexWrap: "wrap" }}>
          <button
            type="button"
            data-testid="upgrade-action"
            className="icon-btn"
            style={{ ...actionStyle, fontWeight: 600, color: "hsl(var(--accent))" }}
            onClick={() => void upgradeTo(plan!)}
          >
            {plan === "team" ? t("billing.action.upgradeTeam") : t("billing.action.upgradePro")}
          </button>
          {manage && (
            <button type="button" data-testid="manage-billing" className="icon-btn" style={actionStyle} onClick={() => void manageBilling()}>
              {t("billing.action.manage")}
            </button>
          )}
        </div>
      )}
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
