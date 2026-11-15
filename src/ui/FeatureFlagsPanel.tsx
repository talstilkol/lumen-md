/**
 * Feature flags (plan 14.4): every flag, on or off on this device, with
 * where its value comes from. Opened from the palette (*Feature flags…*)
 * or the Beta badge. Nothing here leaves the device.
 */

import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import { buildChannel, classicLook, FLAGS, FLAGS_CHANGED, flagState, resetFlags, setClassicLook, setFlag } from "../flags/flags";
import "./featureFlagsPanelStrings";
import { HelpButton } from "./HelpButton";
import { Modal } from "./Modal";

// The host, the event name and the Beta badge live in ./FeatureFlagsHost (startup);
// this panel loads when it opens.
export function FeatureFlagsPanel({ onClose }: { onClose: () => void }) {
  const [, setTick] = useState(0);
  const ref = useRef<HTMLDivElement | null>(null);
  const channel = buildChannel();

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const onChange = () => setTick((n) => n + 1);
    window.addEventListener(FLAGS_CHANGED, onChange);
    return () => {
      window.removeEventListener(FLAGS_CHANGED, onChange);
      before?.focus?.();
    };
  }, [onClose]);

  return (
    <Modal onClose={onClose} aria-labelledby="feature-flags-title" style={{ position: "fixed", inset: 0, zIndex: 70, background: "var(--overlay)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        data-testid="feature-flags"
        style={{ inlineSize: "min(520px, 100%)", maxBlockSize: "80vh", overflowY: "auto", background: "hsl(var(--bg))", color: "hsl(var(--fg))", border: "1px solid hsl(var(--border))", borderRadius: 10, padding: 16 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h2 id="feature-flags-title" style={{ flex: 1, margin: 0, fontSize: 16, fontWeight: 600 }}>
            {t("flags.title")}
          </h2>
          <HelpButton topic="getting-started/beta#feature-flags" />
          <button type="button" className="btn" onClick={onClose} data-autofocus>
            {t("flags.close")}
          </button>
        </div>
        <p style={{ fontSize: 13, color: "hsl(var(--fg-muted))", margin: "8px 0 12px" }}>
          {channel === "beta" ? t("flags.intro.beta") : t("flags.intro.stable")}
        </p>
        {/* Plan W11.P15: one switch for every design change that ships behind a flag. */}
        <label data-testid="flags-classic" style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, paddingBlock: 8, borderBlockEnd: "1px solid hsl(var(--border))" }}>
          <input type="checkbox" checked={classicLook()} onChange={(e) => setClassicLook(e.currentTarget.checked)} />
          <span>
            <strong>{t("flags.classic")}</strong>
            <br />
            <span style={{ color: "hsl(var(--fg-muted))" }}>{t("flags.classic.desc")}</span>
          </span>
        </label>
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {FLAGS.map((f) => {
            const s = flagState(f.id)!;
            const name = t(`flag.${f.id}.name`);
            return (
              <li key={f.id} data-flag={f.id} style={{ display: "flex", gap: 12, alignItems: "flex-start", paddingBlock: 10, borderBlockEnd: "1px solid hsl(var(--border))" }}>
                <div style={{ flex: 1, minInlineSize: 0 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <strong style={{ fontSize: 14 }}>{name}</strong>
                    <span style={{ fontSize: 11, paddingInline: 5, borderRadius: 4, border: "1px solid hsl(var(--border))", color: "hsl(var(--fg-muted))" }}>{f.stage === "experimental" ? t("flags.stage.experimental") : f.stage === "beta" ? t("flags.stage.beta") : t("flags.stage.stable")}</span>
                  </div>
                  <div style={{ fontSize: 13, color: "hsl(var(--fg-muted))", marginBlockStart: 2 }}>{t(`flag.${f.id}.desc`)}</div>
                  <div style={{ fontSize: 12, color: "hsl(var(--fg-muted))", marginBlockStart: 4 }}>
                    {s.source === "classic" ? t("flags.source.classic") : s.source === "override" ? t("flags.source.override", { default: s.channelDefault ? t("flags.on") : t("flags.off") }) : t("flags.source.channel")}
                    {s.source === "override" && (
                      <>
                        {" · "}
                        <button type="button" onClick={() => setFlag(f.id, null)} style={{ border: "none", background: "none", padding: 0, color: "hsl(var(--accent))", cursor: "pointer", font: "inherit", textDecoration: "underline" }}>
                          {t("flags.useDefault")}
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <button type="button" role="switch" aria-checked={s.enabled} aria-label={name} onClick={() => setFlag(f.id, !s.enabled)} className="btn" style={{ minInlineSize: 64 }}>
                  {s.enabled ? t("flags.on") : t("flags.off")}
                </button>
              </li>
            );
          })}
        </ul>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBlockStart: 12 }}>
          <button type="button" className="btn" onClick={() => resetFlags()}>
            {t("flags.reset")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
