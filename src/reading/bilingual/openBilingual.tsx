/**
 * "Bilingual reader" from the palette (W13.R12): the open note with its
 * translation — a Sefaria source note's official versions, or a note's
 * translation sidecar (W12.H6). Without either it offers the side-by-side
 * translation, which makes a sidecar. Reads the vault only; no request.
 */
import { createRoot, type Root } from "react-dom/client";
import { t } from "../../i18n";
import { useAppStore } from "../../store/useStore";
import { Modal } from "../../ui/Modal";
import { BilingualView } from "../../ui/BilingualView";
// The machine translation layers' names (mt.layer.name.*), which the view shows: the mt strings load with this opener.
import "../../ai/mt/strings";
import { fromSidecar, fromSourceNote, type Bilingual } from "./bilingual";

// The English of this view comes with ../../ui/BilingualView (its strings, registered when it loads).

let mounted: { root: Root; host: HTMLElement } | null = null;

export function closeBilingual(): void {
  if (!mounted) return;
  mounted.root.unmount();
  mounted.host.remove();
  mounted = null;
}

/** What the reader shows for a note: its official versions, else its sidecar, else null. */
export async function bilingualFor(md: string, path: string | null, readFile: (p: string) => Promise<string | null>): Promise<Bilingual | null> {
  const official = fromSourceNote(md);
  if (official) return official;
  if (!path) return null;
  const [{ pairFor }, { sidecarPath }] = await Promise.all([import("../../ai/mt/openSideBySide"), import("../../ai/mt/sideBySide")]);
  const pair = pairFor(md);
  const sidecar = await readFile(sidecarPath(path, pair.target)).catch(() => null);
  if (!sidecar) return null;
  const title = path.replace(/^.*\//, "").replace(/\.md$/i, "");
  return fromSidecar(md, sidecar, pair.source, title);
}

export async function openBilingual(): Promise<void> {
  const { doc } = useAppStore.getState();
  const path = doc.workspaceName ?? null;
  const ws = await import("../../storage/workspace");
  const data = await bilingualFor(doc.content, path, async (p) => ((await ws.workspaceHasFile(p)) ? ws.readWorkspaceFile(p) : null)).catch(() => null);
  closeBilingual();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted = { root, host };
  root.render(
    <Modal aria-label={t("bilingual.title")} onClose={closeBilingual} data-testid="bilingual-dialog" data-reading-mode="bilingual" style={{ inlineSize: "min(1100px, 96vw)", maxBlockSize: "92vh", overflow: "auto" }}>
      {data ? (
        <BilingualView data={data} />
      ) : (
        <div data-testid="bilingual-empty" style={{ display: "grid", gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{t("bilingual.title")}</h2>
          <p style={{ margin: 0 }}>{t("bilingual.none")}</p>
          <div>
            <button
              type="button"
              onClick={() => {
                closeBilingual();
                void import("../../ai/mt/openSideBySide").then((m) => m.openSideBySide());
              }}
            >
              {t("bilingual.makeOne")}
            </button>
          </div>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBlockStart: 10 }}>
        <button type="button" onClick={closeBilingual}>
          {t("bilingual.close")}
        </button>
      </div>
    </Modal>,
  );
}
