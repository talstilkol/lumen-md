/**
 * Plan W5.23: the Zotero file commands — import an export from Zotero, and
 * write the vault's sources as a file Zotero imports. Started by the user,
 * read from and written to this device only (./zoteroFile.ts).
 */
import "./strings";
import { t } from "../i18n";
import { explainError } from "../lib/userError";
import { ZOTERO_FILE, invalidateLibrary, loadLibrary, type LibraryItem } from "./library";
import type { CslItem } from "./csl";
import { ZoteroFileError, mergeZoteroImport, parseZoteroExport, recordToCsl, toRis, type MergeReport } from "./zoteroFile";

export const ZOTERO_ACCEPT = ".json,.bib,.biblatex,.ris,.txt,application/json,application/x-research-info-systems";

export interface ZoteroFileDeps {
  pick: () => Promise<{ name: string; text: string } | null>;
  read: (path: string) => Promise<string | null>;
  write: (path: string, text: string) => Promise<void>;
  confirm: (title: string, message: string) => Promise<boolean>;
  toast: (message: string, kind: "success" | "error" | "info") => void;
  download: (name: string, text: string, type: string) => void;
  library: () => Promise<LibraryItem[]>;
}

async function browserDeps(): Promise<ZoteroFileDeps> {
  const [ws, { uiConfirm }, { showAiToast }] = await Promise.all([import("../storage/workspace"), import("../ui/PromptDialog"), import("../ui/AiToast")]);
  return {
    pick: () =>
      new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ZOTERO_ACCEPT;
        input.onchange = () => {
          const f = input.files?.[0];
          if (!f) return resolve(null);
          void f.text().then((text) => resolve({ name: f.name, text }), () => resolve(null));
        };
        input.addEventListener("cancel", () => resolve(null));
        input.click();
      }),
    read: (p) => ws.readWorkspaceFile(p).catch(() => null),
    write: async (p, text) => {
      await ws.createWorkspaceFolder(".lumen").catch(() => undefined);
      await ws.writeWorkspaceFile(p, text);
    },
    confirm: (title, message) => uiConfirm({ title, message }),
    toast: (m, k) => showAiToast(m, k),
    download: (name, text, type) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([text], { type }));
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    library: loadLibrary,
  };
}

const ERR: Record<ZoteroFileError["reason"], string> = { format: "cite.file.format", empty: "cite.file.empty", json: "cite.file.json" };

/** Import a Zotero export into the vault's Zotero copy. Resolves with what changed, or null when nothing was imported. */
export async function importZoteroFile(deps?: ZoteroFileDeps): Promise<MergeReport | null> {
  const d = deps ?? (await browserDeps());
  const picked = await d.pick();
  if (!picked) return null;
  try {
    const { format, items } = parseZoteroExport(picked.name, picked.text);
    let prev: CslItem[] = [];
    const old = await d.read(ZOTERO_FILE);
    if (old) {
      try {
        const data = JSON.parse(old) as unknown;
        if (Array.isArray(data)) prev = data as CslItem[];
      } catch {
        /* why: a damaged copy is replaced by the import */
      }
    }
    let r = mergeZoteroImport(prev, items);
    if (r.missing > 0 && (await d.confirm(t("cite.file.missingTitle"), t("cite.file.missingBody", { n: r.missing })))) r = mergeZoteroImport(prev, items, { removeMissing: true });
    if (!r.added && !r.updated && !r.removed) {
      d.toast(t("cite.file.nothing", { n: r.unchanged }), "info");
      return r;
    }
    await d.write(ZOTERO_FILE, JSON.stringify(r.items, null, 1));
    invalidateLibrary();
    d.toast(t("cite.file.imported", { added: r.added, updated: r.updated, removed: r.removed, unchanged: r.unchanged, format: FORMAT_NAMES[format] }), "success");
    return r;
  } catch (e) {
    d.toast(e instanceof ZoteroFileError ? t(ERR[e.reason]) : t("cite.file.failed", { error: explainError(e) }), "error");
    return null;
  }
}

const FORMAT_NAMES = { "csl-json": "CSL JSON", bibtex: "BibTeX", ris: "RIS" } as const;

/** The vault's sources (every library file, Zotero copy included) as CSL items for export. */
export function libraryCsl(items: readonly LibraryItem[]): CslItem[] {
  return items.map((it) => recordToCsl(it.key, it.record));
}

/** Write the vault's sources as a file Zotero (File → Import) reads. Resolves with the number written. */
export async function exportForZotero(format: "csl-json" | "ris" = "csl-json", deps?: ZoteroFileDeps): Promise<number> {
  const d = deps ?? (await browserDeps());
  const items = libraryCsl(await d.library());
  if (!items.length) {
    d.toast(t("cite.file.noSources"), "info");
    return 0;
  }
  const name = format === "ris" ? "lumen-sources.ris" : "lumen-sources.json";
  d.download(name, format === "ris" ? toRis(items) : JSON.stringify(items, null, 1), format === "ris" ? "application/x-research-info-systems" : "application/json");
  d.toast(t("cite.file.exported", { n: items.length, name }), "success");
  return items.length;
}
