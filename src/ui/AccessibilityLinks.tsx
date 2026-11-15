/**
 * W11.Q7: the accessibility statement (regulation 35, IS 5568) and the
 * conformance report (WCAG 2.2, EN 301 549) are one click away in the app:
 * from the status bar at the foot of every screen, and from Settings' About
 * line. The site has both in its sidebar (docs/astro.config.mjs).
 */
import { docsUrl } from "../lib/docsLinks";
import { getLocale, t } from "../i18n";
import { version } from "../../package.json";

const loc = () => (getLocale() === "he" ? "he" : undefined);
export const statementUrl = () => docsUrl("a11yStatement", undefined, loc());
export const acrUrl = () => docsUrl("acr", undefined, loc());

/** One link in the status bar: the statement. */
export function StatusBarA11yLink() {
  return (
    <a className="sb-item" href={statementUrl()} target="_blank" rel="noreferrer noopener" title={t("about.a11yStatement.hint")} data-testid="status-a11y-statement" style={{ textDecoration: "none", color: "inherit" }}>
      {t("about.a11yStatement")}
    </a>
  );
}

/** Settings' About line: the version, the statement and the report. */
export function SettingsAbout() {
  return (
    <footer data-testid="settings-about" style={{ padding: "8px 16px", fontSize: 12, borderTop: "1px solid hsl(var(--border))", display: "flex", flexWrap: "wrap", gap: 12, color: "hsl(var(--fg-muted))" }}>
      <span>{t("about.version", { version })}</span>
      <a href={statementUrl()} target="_blank" rel="noreferrer noopener" style={{ color: "inherit" }}>
        {t("about.a11yStatement")}
      </a>
      <a href={acrUrl()} target="_blank" rel="noreferrer noopener" style={{ color: "inherit" }}>
        {t("about.acr")}
      </a>
    </footer>
  );
}
