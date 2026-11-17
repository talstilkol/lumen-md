/**
 * The confirmation a `lumen://` link gets before it writes or opens
 * anything (plan W13.X5): what it will do, in plain words; a warning for a
 * file type that can run code; "always allow from this source on this
 * device" only where remembering is safe. Focus starts on "Don't allow":
 * Enter on an unexpected dialog never runs the link.
 */
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { t } from "../i18n";
import { Modal } from "../ui/Modal";
import "./linkConfirmStrings";
import type { LinkAction, LinkDecision } from "./linkConfirm";
import { HelpButton } from "../ui/HelpButton";

const BTN = "inline-flex items-center rounded-md border border-border bg-bg px-3 py-1.5 text-sm text-fg hover:bg-bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const BTN_PRIMARY = "inline-flex items-center rounded-md border border-accent bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

const sourceLabel = (source: string): string => {
  if (source.startsWith("clip:")) return source.slice(5);
  const k = source.slice(5);
  return k === "new" || k === "capture" || k === "open" ? t(`link.source.${k}`) : source;
};

export function LinkConfirmDialog(props: { decision: LinkDecision; onAnswer: (a: { ok: boolean; always: boolean }) => void }) {
  const { decision: d } = props;
  const [always, setAlways] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelRef.current?.focus(), []);
  const answer = (ok: boolean) => props.onAnswer({ ok, always: ok && always });
  return (
    <Modal
      aria-labelledby="link-confirm-title"
      aria-describedby="link-confirm-what"
      data-testid="link-confirm"
      onClose={() => answer(false)}
      style={{ position: "fixed", inset: 0, zIndex: 260, background: "var(--overlay)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div style={{ background: "hsl(var(--bg))", color: "hsl(var(--fg))", border: "1px solid hsl(var(--border))", borderRadius: 12, maxWidth: 480, width: "100%", padding: 20 }}>
        <span style={{ float: "inline-end", marginInlineStart: 8 }}><HelpButton topic="security" /></span>
        <h2 id="link-confirm-title" style={{ margin: "0 0 10px", fontSize: 17 }}>
          {t("link.confirm.title")}
        </h2>
        {d.describe && (
          <p id="link-confirm-what" style={{ margin: "0 0 10px", fontSize: 14, overflowWrap: "anywhere" }}>
            <bdi>{t(d.describe.key, d.describe.values)}</bdi>
          </p>
        )}
        {d.warning && (
          <p data-testid="link-confirm-warning" role="alert" style={{ margin: "0 0 10px", fontSize: 13, color: "hsl(var(--danger))", fontWeight: 600 }}>
            {t(d.warning.key, d.warning.values)}
          </p>
        )}
        <p style={{ margin: "0 0 12px", fontSize: 12, color: "hsl(var(--fg-muted))" }}>{t("link.confirm.source")}</p>
        {d.source && (
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, margin: "0 0 14px" }}>
            <input type="checkbox" data-testid="link-confirm-always" checked={always} onChange={(e) => setAlways(e.currentTarget.checked)} style={{ marginTop: 3 }} />
            <span>
              {t("link.always", { source: sourceLabel(d.source) })}
              <span style={{ display: "block", fontSize: 11, color: "hsl(var(--fg-muted))" }}>{t("link.always.hint")}</span>
            </span>
          </label>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button ref={cancelRef} type="button" className={BTN} onClick={() => answer(false)}>
            {t("link.cancel")}
          </button>
          <button type="button" className={BTN_PRIMARY} data-testid="link-confirm-allow" onClick={() => answer(true)}>
            {t("link.allow")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Show the confirmation; resolves with the answer. */
export function askLinkConfirm(decision: LinkDecision, _a?: LinkAction): Promise<{ ok: boolean; always: boolean }> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (a: { ok: boolean; always: boolean }) => {
      try {
        root.unmount();
      } catch {
        /* why: already unmounted */
      }
      host.remove();
      resolve(a);
    };
    root.render(<LinkConfirmDialog decision={decision} onAnswer={done} />);
  });
}

/** The app's confirmation for a link: the dialog, the device-only allow list, the privacy ledger. */
export async function confirmLinkInApp(a: LinkAction): Promise<boolean> {
  const { confirmLink, recordLinkDecision } = await import("./linkConfirm");
  return confirmLink(a, { ask: askLinkConfirm, record: (x, decision, how) => void recordLinkDecision(x, decision, how) });
}
