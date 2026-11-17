/**
 * "Show where I am" for shared vaults (plan W13.S6): off by default; a
 * device name the user picks (never the account, never the OS name); and
 * the plain-language promise — the relay sees sealed bytes only, and nothing
 * is sent in airplane mode.
 */
import { useState } from "react";
import { t } from "../../../../i18n";
import { MAX_DEVICE_NAME, presenceDeviceName, presenceEnabled, setPresenceDeviceName, setPresenceEnabled } from "../../../../collab/vaultPresence";
import { card, field, muted } from "./styles";

export function PresenceSettings({ onChange }: { onChange?: () => void }) {
  const [on, setOn] = useState(presenceEnabled);
  const [name, setName] = useState(presenceDeviceName);
  const missing = on && !name;
  return (
    <section style={card} aria-labelledby="presence-title" data-testid="presence-settings">
      <h3 id="presence-title" style={{ margin: 0, fontSize: 14 }}>
        {t("e2ee.presence.title")}
      </h3>
      <p style={{ ...muted, margin: 0 }}>{t("e2ee.presence.intro")}</p>
      <label style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 28, fontSize: 13 }}>
        <input
          type="checkbox"
          checked={on}
          data-testid="presence-on"
          style={{ width: 18, height: 18 }}
          onChange={(e) => {
            setPresenceEnabled(e.target.checked);
            setOn(e.target.checked);
            onChange?.();
          }}
        />
        {t("e2ee.presence.on")}
      </label>
      <label htmlFor="presence-device" style={{ fontSize: 13 }}>
        {t("e2ee.presence.device")}
      </label>
      <input
        id="presence-device"
        data-testid="presence-device"
        style={field}
        dir="auto"
        maxLength={MAX_DEVICE_NAME}
        value={name}
        placeholder={t("e2ee.presence.devicePlaceholder")}
        aria-invalid={missing || undefined}
        aria-describedby={missing ? "presence-missing" : undefined}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          setName(setPresenceDeviceName(name));
          onChange?.();
        }}
      />
      {missing && (
        <p id="presence-missing" style={{ ...muted, margin: 0 }}>
          {t("e2ee.presence.needName")}
        </p>
      )}
    </section>
  );
}
