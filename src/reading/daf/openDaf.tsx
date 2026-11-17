/**
 * "Page of the Talmud" from the palette (W13.R11): the open note as a daf.
 * A Sefaria source note takes its commentaries from the vault (by default
 * `Sources/Sefaria/Rashi on <ref>.md` and `Tosafot on <ref>.md`, or any
 * note the user picks); any other note uses its own ```commentary``` blocks.
 * My notes on the passage (W10.C24) are listed beside it. Everything is read
 * from the vault: no request is made. The note is never changed.
 */
import { createRoot, type Root } from "react-dom/client";
import { t } from "../../i18n";
import { useAppStore } from "../../store/useStore";
import { Modal } from "../../ui/Modal";
import { DafView, type DafChoice, type DafNoteRef } from "../../ui/DafView";
import { commentaryFromNote, dafFromNote, defaultCommentaryPaths, type DafText } from "./dafSources";
import { HelpButton } from "../../ui/HelpButton";

// The English of this view comes with ../../ui/DafView (its strings, registered when it loads).

let mounted: { root: Root; host: HTMLElement } | null = null;

export function closeDaf(): void {
  if (!mounted) return;
  mounted.root.unmount();
  mounted.host.remove();
  mounted = null;
}

const baseName = (p: string) => p.replace(/^.*\//, "").replace(/\.md$/i, "");

export async function openDaf(): Promise<void> {
  const { doc } = useAppStore.getState();
  const content = dafFromNote(doc.content, baseName(doc.workspaceName ?? doc.name ?? ""));
  let choices: DafChoice[] = [];
  let myNotes: DafNoteRef[] = [];
  let initialInner = "";
  let initialOuter = "";
  let load: ((path: string, title: string) => Promise<DafText | null>) | undefined;
  try {
    const ws = await import("../../storage/workspace");
    if (ws.isOPFSAvailable()) {
      const files = (await ws.listWorkspace()).filter((f) => f.path.endsWith(".md") && f.path !== doc.workspaceName);
      // Saved sources first, then the rest of the vault (a long vault: the first 300).
      const sorted = [...files.filter((f) => f.path.startsWith("Sources/")), ...files.filter((f) => !f.path.startsWith("Sources/"))].slice(0, 300);
      choices = sorted.map((f) => ({ value: f.path, label: f.path }));
      load = async (path, title) => commentaryFromNote(await ws.readWorkspaceFile(path), title);
      if (content.ref) {
        const d = defaultCommentaryPaths(content.ref);
        if (files.some((f) => f.path === d.inner)) initialInner = d.inner;
        if (files.some((f) => f.path === d.outer)) initialOuter = d.outer;
        const sefaria = await import("../../sources/sefaria/app");
        const ref = sefaria.parseSourceRef(content.ref);
        if (ref) myNotes = (await sefaria.notesOnVerse(ref)).map((p) => ({ path: p, title: baseName(p) }));
      }
    }
  } catch {
    // why: no vault (a single file) or it could not be listed: the page shows the note alone
  }

  closeDaf();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted = { root, host };
  root.render(
    <Modal aria-label={t("daf.title")} onClose={closeDaf} data-testid="daf-dialog" data-reading-mode="daf" style={{ inlineSize: "min(1180px, 96vw)", maxBlockSize: "94vh", overflow: "auto" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", paddingInline: 8, paddingBlockStart: 6 }}><HelpButton topic="editor/reading-views" /></div>
      <DafView
        content={content}
        myNotes={myNotes}
        choices={choices}
        loadCommentary={load}
        initialInner={initialInner}
        initialOuter={initialOuter}
        onOpenNote={(path) => {
          closeDaf();
          window.dispatchEvent(new CustomEvent("lumen-open-file", { detail: { path } }));
        }}
      />
      <div style={{ display: "flex", justifyContent: "flex-end", marginBlockStart: 8 }}>
        <button type="button" onClick={closeDaf}>
          {t("daf.close")}
        </button>
      </div>
    </Modal>,
  );
}
