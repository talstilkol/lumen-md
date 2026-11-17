/** The sources commands' bodies, loaded on first use (split out of sources.ts for the startup budget, W4.9). */
import { t } from "../../i18n";
import { uiAlert, uiConfirm, uiPrompt } from "../../ui/PromptDialog";
import { useToastStore } from "../../store/useToastStore";
import { useAppStore } from "../../store/useStore";
import type { CommandContext } from "./context";
import { explainError } from "../../lib/userError";
import "./commandBodiesStrings";

type Sefaria = typeof import("../../sources/sefaria/app");
const sefaria = (): Promise<Sefaria> => import("../../sources/sefaria/app");

/** The selected text in the source editor, or the current line when nothing is selected. */
function selectionOrLine(ctx: CommandContext): { text: string; from: number; to: number } | null {
  const view = ctx.getEditorView?.();
  if (!view) return null;
  const { from, to } = view.state.selection.main;
  if (from !== to) return { text: view.state.sliceDoc(from, to), from, to };
  const line = view.state.doc.lineAt(from);
  return { text: line.text, from: line.from, to: line.to };
}

export async function insertSefaria(ctx: CommandContext): Promise<void> {
  const s = await sefaria();
  const here = selectionOrLine(ctx);
  const fromSelection = here && s.parseSourceRef(here.text.trim()) ? here : null;
  const typed = fromSelection ? fromSelection.text.trim() : await uiPrompt({ message: t("sources.prompt"), defaultValue: "" });
  if (!typed) return;
  const ref = s.parseSourceRef(typed);
  if (!ref) {
    await uiAlert({ message: t("sources.notARef", { text: typed }) });
    return;
  }
  let result;
  try {
    result = await s.lookup(ref, () => uiConfirm({ message: t("sources.confirmFetch", { ref: ref.tref }) }));
  } catch (e) {
    useToastStore.getState().push({ kind: "error", title: t("sources.failed", { error: explainError(e) }) });
    return;
  }
  if (!result) return;
  const block = s.quoteBlock(result.passage);
  const view = ctx.getEditorView?.();
  if (view && fromSelection) {
    view.dispatch({ changes: { from: fromSelection.from, to: fromSelection.to, insert: block }, userEvent: "input" });
    view.focus();
  } else ctx.insertSnippet(`\n${block}\n`);
  const linkOnly = result.passage.versions.filter((v) => !v.free).length;
  useToastStore.getState().push({
    kind: "success",
    title: t("sources.inserted", { ref: result.passage.heRef ?? ref.he }),
    ...(linkOnly ? { body: t("sources.linkOnly", { count: linkOnly }) } : {}),
    ...(result.from === "network" && result.passage.versions.some((v) => v.free)
      ? { ttlMs: 12_000, action: { label: t("sources.saveOffline"), run: () => void s.saveForOffline(result.passage) } }
      : {}),
  });
}

export async function saveOffline(ctx: CommandContext): Promise<void> {
  const s = await sefaria();
  const here = selectionOrLine(ctx);
  const refs = here ? s.sourceRefsIn(here.text).concat(s.parseSourceRef(here.text.trim()) ?? []) : [];
  const ref = refs[0] ?? s.parseSourceRef((await uiPrompt({ message: t("sources.prompt"), defaultValue: "" })) ?? "");
  if (!ref) return;
  try {
    const r = await s.lookup(ref, () => uiConfirm({ message: t("sources.confirmFetch", { ref: ref.tref }) }));
    if (!r) return;
    const path = await s.saveForOffline(r.passage);
    if (path) useToastStore.getState().push({ kind: "success", title: t("sources.saved", { path }) });
  } catch (e) {
    useToastStore.getState().push({ kind: "error", title: t("sources.failed", { error: explainError(e) }) });
  }
}

export async function notesOnVerse(ctx: CommandContext): Promise<void> {
  const s = await sefaria();
  const here = selectionOrLine(ctx);
  const doc = ctx.liveDoc();
  const ref = (here && (s.sourceRefsIn(here.text)[0] ?? s.parseSourceRef(here.text.trim()))) || s.refOfSourceNote(doc.content);
  if (!ref) {
    await uiAlert({ message: t("sources.noVerseHere") });
    return;
  }
  // W10.C24: a side panel that stays open and follows the verse under the cursor (read locally, nothing is sent).
  const { openVersePanel } = await import("../../sources/sefaria/VersePanel");
  openVersePanel({
    initial: ref,
    notesFor: (r) => s.notesOnVerse(r),
    onOpen: async (pick) => {
      const { readWorkspaceFile } = await import("../../storage/workspace");
      useAppStore.getState().openTab({ name: pick.split("/").pop()!, content: await readWorkspaceFile(pick), workspaceName: pick });
    },
  });
}

/** W12.H2: a shared, encrypted study room on the reference here (havruta). */
export async function studyHavruta(ctx: CommandContext): Promise<void> {
  const s = await sefaria();
  const here = selectionOrLine(ctx);
  const ref = (here && (s.sourceRefsIn(here.text)[0] ?? s.parseSourceRef(here.text.trim()))) || s.refOfSourceNote(ctx.liveDoc().content) || s.parseSourceRef((await uiPrompt({ message: t("sources.prompt"), defaultValue: "" })) ?? "");
  if (!ref) return;
  try {
    const { openStudyScreen } = await import("../../havruta/open");
    await openStudyScreen({ ref });
  } catch (e) {
    useToastStore.getState().push({ kind: "error", title: t("sources.failed", { error: explainError(e) }) });
  }
}
