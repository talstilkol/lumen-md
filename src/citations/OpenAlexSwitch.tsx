/**
 * The OpenAlex switch in Settings → Privacy (plan W12.X3): off by default;
 * on, each lookup still asks first (citations/openAlexLookup.ts).
 */
import { useId, useState } from "react";
import { t } from "../i18n";
import { openAlexEnabled, setOpenAlexEnabled } from "./openAlexLookup";
import "./openAlexStrings";

export function OpenAlexSwitch() {
  const id = useId();
  const [on, setOn] = useState(openAlexEnabled);
  return (
    <section aria-labelledby={`${id}-h`} data-testid="settings-openalex" style={{ marginTop: 16 }}>
      <h3 id={`${id}-h`} style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 600 }}>
        {t("openAlex.title")}
      </h3>
      <label htmlFor={id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
        <input
          id={id}
          type="checkbox"
          checked={on}
          data-setting="lumen.openAlex.enabled"
          aria-describedby={`${id}-note`}
          onChange={(e) => {
            setOpenAlexEnabled(e.target.checked);
            setOn(openAlexEnabled());
          }}
        />
        <span>{t("openAlex.switch")}</span>
      </label>
      <p id={`${id}-note`} style={{ margin: "2px 0 0", fontSize: 12, color: "hsl(var(--fg-muted))" }}>
        {t("openAlex.note")}
      </p>
    </section>
  );
}
