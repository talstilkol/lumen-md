/**
 * "What this shared vault may carry" (plan W13.S2): one switch per kind of
 * code or configuration — plugins, themes, CSS snippets, hotkeys, settings,
 * automations, agent skills — all off by default, kept on this device only.
 * Turning one on asks first and says what it means: the other members'
 * files of that kind reach this device (a plugin still only runs after its
 * permission screen).
 */
import { useState } from "react";
import { t } from "../../../../i18n";
import { uiConfirm } from "../../../../ui/PromptDialog";
import { loadConsent, PROTECTED_KINDS, saveConsent, type SharedConsent as Consent } from "../../sharedVault";
import { card, muted } from "./styles";

export function SharedConsent({ vault }: { vault: string }) {
  const [c, setC] = useState<Consent>(() => loadConsent(vault));
  const toggle = async (kind: (typeof PROTECTED_KINDS)[number], on: boolean) => {
    if (on && !(await uiConfirm({ message: t("e2ee.shared.confirm", { kind: t(`e2ee.shared.kind.${kind}`) }) }))) return;
    const next = { ...c, [kind]: on };
    saveConsent(vault, next);
    setC(next);
  };
  return (
    <section style={card} aria-labelledby={`shared-consent-${vault}`} data-testid="shared-consent">
      <h3 id={`shared-consent-${vault}`} style={{ margin: 0, fontSize: 14 }}>
        {t("e2ee.shared.title")}
      </h3>
      <p style={{ ...muted, margin: 0 }}>{t("e2ee.shared.intro")}</p>
      <fieldset style={{ border: 0, margin: 0, padding: 0, display: "grid", gap: 4 }}>
        <legend className="sr-only">{t("e2ee.shared.title")}</legend>
        {PROTECTED_KINDS.map((k) => (
          <label key={k} style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 28, fontSize: 13 }}>
            <input type="checkbox" checked={c[k]} onChange={(e) => void toggle(k, e.target.checked)} data-testid={`shared-consent-${k}`} style={{ width: 18, height: 18 }} />
            {t(`e2ee.shared.kind.${k}`)}
          </label>
        ))}
      </fieldset>
    </section>
  );
}
