/**
 * "Side-by-side translation" from the palette (plan W12.H6): opens the
 * current note and its translation in two columns (ui/SideBySideTranslation)
 * in a dialog. A Hebrew note is translated to English, any other to Hebrew.
 * The sidecar `<note>.<lang>.md` is read from the vault when it exists and
 * written there on "Translate". Translation runs on the existing local
 * layers (Chrome's Translator API, then Opus-MT, then M2M100); a model
 * download asks first, as everywhere else.
 */
import { createRoot, type Root } from "react-dom/client";
import { getLocale, t } from "../../i18n";
import "./strings";
import { useAppStore } from "../../store/useStore";
import { useToastStore } from "../../store/useToastStore";
import { Modal } from "../../ui/Modal";
import { chromeTranslatorApi } from "./chromeTranslator";
import { sidecarPath, viaLocalLayers, type TranslateTexts } from "./sideBySide";

/** The pair for a note: Hebrew → English, anything else → Hebrew (by the share of Hebrew letters). */
export function pairFor(md: string): { source: string; target: string } {
  const letters = md.match(/\p{L}/gu)?.length ?? 0;
  const hebrew = md.match(/[֐-׿]/g)?.length ?? 0;
  return letters && hebrew / letters >= 0.3 ? { source: "he", target: "en" } : { source: "en", target: "he" };
}

let mounted: { root: Root; host: HTMLElement } | null = null;

export function closeSideBySide(): void {
  if (!mounted) return;
  mounted.root.unmount();
  mounted.host.remove();
  mounted = null;
}

export async function openSideBySide(deps: { translate?: TranslateTexts } = {}): Promise<void> {
  const { doc } = useAppStore.getState();
  const path = doc.workspaceName;
  if (!path) {
    useToastStore.getState().push({ kind: "info", title: t("mt.sideBySide.needVault") });
    return;
  }
  const [ws, { SideBySideTranslation }, { uiConfirm }] = await Promise.all([import("../../storage/workspace"), import("../../ui/SideBySideTranslation"), import("../../ui/PromptDialog")]);
  const pair = pairFor(doc.content);
  const sidecarFile = sidecarPath(path, pair.target);
  const translate = deps.translate ?? viaLocalLayers(pair, { confirm: uiConfirm, t, locale: getLocale() });
  let sidecar = await ws.readWorkspaceFile(sidecarFile).catch(() => null);

  closeSideBySide();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted = { root, host };
  const render = () =>
    root.render(
      <Modal aria-label={t("mt.sideBySide.title")} onClose={closeSideBySide} data-testid="side-by-side-dialog" style={{ maxInlineSize: 1100, inlineSize: "100%", maxBlockSize: "90vh", overflow: "auto" }}>
        <SideBySideTranslation
          sourcePath={path}
          sourceMd={doc.content}
          sidecarMd={sidecar}
          lang={pair.target}
          translate={translate}
          chromeAvailable={chromeTranslatorApi() !== null}
          onSave={async (md) => {
            await ws.writeWorkspaceFile(sidecarFile, md);
            sidecar = md;
            window.dispatchEvent(new CustomEvent("lumen-workspace-changed"));
            render();
          }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBlockStart: 8, gap: 8 }}>
          <span style={{ color: "hsl(var(--fg-muted, 0 0% 40%))", fontSize: 12 }}>{t("mt.sideBySide.sidecar", { path: sidecarFile })}</span>
          <button type="button" onClick={closeSideBySide}>
            {t("mt.sideBySide.close")}
          </button>
        </div>
      </Modal>,
    );
  render();
}
