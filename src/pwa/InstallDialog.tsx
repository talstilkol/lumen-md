/**
 * "Install Lumen as an app" (plan W11.P13): the browser's own <install>
 * element where there is one, else a button for navigator.install() or the
 * kept beforeinstallprompt, else the steps for this browser. Opened from the
 * command palette (`app.install`).
 */
import { useEffect, useRef, useState, createElement } from "react";
import { Download, X } from "lucide-react";
import { t } from "../i18n";
import { currentEnv, installCount, installMode, recordInstall, runInstall, type GuideId, type InstallEnv, type InstallMode } from "./install";
import { onPromptChange } from "./installPrompt";
import "./installStrings";
import { Modal } from "../ui/Modal";
import { HelpButton } from "../ui/HelpButton";

const btn: React.CSSProperties = { padding: "6px 12px", fontSize: 13, borderRadius: 6, border: "1px solid hsl(var(--border))", background: "transparent", color: "inherit", cursor: "pointer" };
const primary: React.CSSProperties = { ...btn, background: "hsl(var(--accent))", color: "hsl(var(--accent-fg))", borderColor: "transparent" };

const GUIDE_STEPS: Record<GuideId, number> = { ios: 4, macSafari: 2, firefoxAndroid: 2, firefoxDesktop: 1, other: 1 };

function Guide({ guide }: { guide: GuideId }) {
  return (
    <div data-testid={`install-guide-${guide}`}>
      <p style={{ margin: "0 0 6px", fontSize: 13, fontWeight: 600 }}>{t(`install.guide.${guide}.title`)}</p>
      <ol style={{ margin: 0, paddingInlineStart: 20, fontSize: 13, display: "flex", flexDirection: "column", gap: 4 }}>
        {Array.from({ length: GUIDE_STEPS[guide] }, (_, i) => (
          <li key={i}>{t(`install.guide.${guide}.${i + 1}`)}</li>
        ))}
      </ol>
    </div>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Tests pass a made-up browser; the app reads the real one. */
  env?: () => InstallEnv;
}

export function InstallDialog({ open, onClose, env = currentEnv }: Props) {
  const [mode, setMode] = useState<InstallMode>(() => installMode(env()));
  const [status, setStatus] = useState<"idle" | "installed" | "dismissed">("idle");
  const [count, setCount] = useState(() => installCount());
  const el = useRef<HTMLElement | null>(null);

  useEffect(() => onPromptChange(() => setMode(installMode(env()))), [env]);

  const done = (outcome: "installed" | "dismissed" | "unavailable") => {
    if (outcome === "installed") {
      setCount(recordInstall());
      setStatus("installed");
    } else if (outcome === "dismissed") setStatus("dismissed");
    else setMode({ kind: "guide", guide: "other" });
  };

  const doneRef = useRef(done);
  doneRef.current = done;
  // The <install> element's own events (Chrome / Edge 148+).
  useEffect(() => {
    const node = el.current;
    if (!node || mode.kind !== "element") return;
    const ok = () => doneRef.current("installed");
    const no = () => doneRef.current("dismissed");
    // The browser checked the manifest and can't install from it (invalidReason, e.g. "install_data_invalid"): show the steps.
    const checked = () => {
      if ((node as HTMLElement & { invalidReason?: string }).invalidReason) doneRef.current("unavailable");
    };
    node.addEventListener("promptaction", ok);
    node.addEventListener("promptdismiss", no);
    node.addEventListener("validationstatuschanged", checked);
    return () => {
      node.removeEventListener("promptaction", ok);
      node.removeEventListener("promptdismiss", no);
      node.removeEventListener("validationstatuschanged", checked);
    };
  }, [mode.kind, open]);

  if (!open) return null;

  const body = () => {
    if (status === "installed") return <p role="status" data-testid="install-done" style={{ margin: 0, fontSize: 13 }}>{t("install.done")}</p>;
    switch (mode.kind) {
      case "installed":
        return <p data-testid="install-already" style={{ margin: 0, fontSize: 13 }}>{t("install.already")}</p>;
      case "element":
        // The browser draws this button; its fallback content is the generic steps.
        return createElement("install", { ref: el, "data-testid": "install-element" }, <Guide guide="other" />);
      case "api":
      case "prompt":
        return (
          <button type="button" style={primary} data-testid="install-button" onClick={() => void runInstall(mode, env()).then(done)}>
            {t("install.button")}
          </button>
        );
      case "guide":
        return <Guide guide={mode.guide} />;
    }
  };

  return (
    <Modal onClose={onClose} className="cmd-palette-backdrop" onClick={onClose} aria-label={t("install.title")} data-testid="install-dialog">
      <div className="cmd-palette" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460, padding: 0 }}>
        <header style={{ padding: "12px 16px", borderBottom: "1px solid hsl(var(--border))", display: "flex", gap: 10, alignItems: "center" }}>
          <Download size={16} />
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, flex: 1 }}>{t("install.title")}</h2>
          <HelpButton topic="getting-started/install" />
          <button type="button" style={btn} onClick={onClose} aria-label={t("install.close")}>
            <X size={14} />
          </button>
        </header>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ margin: 0, fontSize: 13, color: "hsl(var(--fg-muted))" }}>{t("install.intro")}</p>
          {body()}
          {status === "dismissed" && <p data-testid="install-dismissed" style={{ margin: 0, fontSize: 12 }}>{t("install.dismissed")}</p>}
          {count > 0 && <p data-testid="install-count" style={{ margin: 0, fontSize: 12, color: "hsl(var(--fg-muted))" }}>{t("install.count", { n: count })}</p>}
        </div>
      </div>
    </Modal>
  );
}
