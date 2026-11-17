/** The reading-list commands' bodies (./reading.ts), loaded on first use. */
import { getLocale, t } from "../../i18n";
import { uiAlert, uiPrompt, uiSelect } from "../../ui/PromptDialog";
import { useAppStore } from "../../store/useStore";
import { showAiToast } from "../../ui/AiToast";
import type { NewSourceResult } from "../../reading/newSource";
import type { NewSource } from "../../reading/sourceFrom";
import { openTemplateDoc } from "../openDoc";
import type { CommandContext } from "./context";
import "../../reading/readingListStrings";

const PICK_LIMIT = 50;

/** No vault open (no OPFS): nothing is written; the note opens unsaved, so closing it warns. */
async function vaultOpen(): Promise<boolean> {
  return (await import("../../storage/workspace")).isOPFSAvailable();
}

async function openUnsaved(made: NewSource | null): Promise<void> {
  if (!made) await uiAlert({ message: t("readingList.refused") });
  else openTemplateDoc(made.name.replace(/\.md$/i, ""), made.text);
}

async function finish(result: NewSourceResult): Promise<void> {
  if (!result.ok) {
    if (result.reason === "refused") await uiAlert({ message: t("readingList.refused") });
    else {
      showAiToast(t("readingList.exists", { path: result.path }), "info");
      const { readWorkspaceFile } = await import("../../storage/workspace");
      useAppStore.getState().openTab({ name: result.path.split("/").pop()!, content: await readWorkspaceFile(result.path), workspaceName: result.path });
    }
    return;
  }
  window.dispatchEvent(new Event("lumen-workspace-changed"));
  useAppStore.getState().openTab({ name: result.path.split("/").pop()!, content: result.text, workspaceName: result.path });
  showAiToast(t("readingList.created", { path: result.path }), "success");
}

/** "New source from the citation library…": search, pick an item, save its source note. */
export async function newSourceFromLibrary(): Promise<void> {
  const [lib, { loadVaultTypes }, ns, { plainTitle }] = await Promise.all([
    import("../../citations/library"),
    import("../../types/vaultTypes"),
    import("../../reading/newSource"),
    import("../../data/citationStyles"),
  ]);
  const items = await lib.loadLibrary();
  if (!items.length) {
    await uiAlert({ message: t("readingList.noLibrary") });
    return;
  }
  const query = await uiPrompt({ message: t("readingList.search"), defaultValue: "" });
  if (query === null) return;
  const found = query.trim() ? lib.searchLibrary(items, query) : items;
  if (!found.length) {
    await uiAlert({ message: t("readingList.noMatch", { query }) });
    return;
  }
  const shown = found.slice(0, PICK_LIMIT);
  const authors = (it: (typeof shown)[number]) => it.record.authors.map((a) => a.family).filter(Boolean).slice(0, 2).join(", ");
  const key = await uiSelect({
    message: t("readingList.pick", { count: String(found.length) }),
    choices: shown.map((it) => ({ value: it.key, label: [it.key, authors(it), it.record.year, plainTitle(it.record.title)].filter(Boolean).join(" · ") })),
  });
  const item = shown.find((it) => it.key === key);
  if (!item) return;
  const reg = await loadVaultTypes();
  if (!(await vaultOpen())) return openUnsaved((await import("../../reading/sourceFrom")).sourceNoteFromCitation(reg, item.key, item.record));
  await finish(await ns.saveSourceFromLibrary(reg, item, ns.sourcesDir(getLocale()), await ns.workspaceIO()));
}

/**
 * "New source from a captured page…": the clip open now (the web clipper's
 * note, with `source:` its link), or else a link the user types.
 */
export async function newSourceFromCapture(ctx: CommandContext): Promise<void> {
  const [{ loadVaultTypes }, ns, sf] = await Promise.all([import("../../types/vaultTypes"), import("../../reading/newSource"), import("../../reading/sourceFrom")]);
  const doc = ctx.liveDoc();
  let page = sf.captureFromNote(doc.content, doc.workspaceName ?? undefined);
  if (!page) {
    const typed = await uiPrompt({ message: t("readingList.captureUrl"), defaultValue: "" });
    if (!typed?.trim()) return;
    const url = sf.webUrl(typed);
    if (!url) {
      await uiAlert({ message: t("readingList.notAUrl", { text: typed.trim() }) });
      return;
    }
    page = { url };
  }
  const reg = await loadVaultTypes();
  if (!(await vaultOpen())) return openUnsaved(sf.sourceNoteFromCapture(reg, page));
  await finish(await ns.saveSourceFromCapture(reg, page, ns.sourcesDir(getLocale()), await ns.workspaceIO()));
}
