/**
 * The app side of the Open Book of Laws (plan W11.H16): the vault as
 * storage, the import of a file the user chose, and the Markdown a chosen
 * law or section becomes. Loaded with the open-sources dialog, never at
 * start-up. Nothing here touches the network.
 */
import { isOPFSAvailable, readWorkspaceFile, workspaceHasFile, writeWorkspaceFile } from "../../storage/workspace";
import { RIGHTS_URL } from "../open/rights";
import { OPEN_LAW_CREDIT } from "./book";
import { hitFor, importOpenLaw, loadOpenLawIndex, matchOpenLaw, type ImportProgress, type OpenLawIndex, type OpenLawStorage } from "./store";

export const vaultStorage: OpenLawStorage = {
  async read(path) {
    if (!isOPFSAvailable()) return null;
    try {
      return (await workspaceHasFile(path)) ? await readWorkspaceFile(path) : null;
    } catch {
      return null;
    }
  },
  write: (path, content) => writeWorkspaceFile(path, content),
};

let cached: Promise<OpenLawIndex | null> | null = null;

/** The imported index (read once per session; an import replaces it). */
export function openLawIndex(storage: OpenLawStorage = vaultStorage): Promise<OpenLawIndex | null> {
  // The word index is built once here, so the dialog's first keystroke does not pay for it.
  cached ??= loadOpenLawIndex(storage).then(
    (idx) => (matchOpenLaw("חוק", idx), idx),
    () => null,
  );
  return cached;
}

/** Import the file the user chose. The text never leaves the device. */
export async function importOpenLawFile(
  file: Blob & { name?: string },
  o: {
    signal?: AbortSignal;
    onProgress?: (p: ImportProgress) => void;
    storage?: OpenLawStorage;
  } = {},
): Promise<OpenLawIndex> {
  if (!isOPFSAvailable() && !o.storage) throw new Error("no vault is open");
  const text = await file.text();
  const index = await importOpenLaw(text, o.storage ?? vaultStorage, {
    fileName: file.name ?? "",
    signal: o.signal,
    onProgress: o.onProgress,
  });
  cached = Promise.resolve(index);
  return index;
}

const MAX_SECTION = 4000;

/**
 * A section becomes a quote with its citation, the licence and the credit; a
 * whole law becomes a citation link with the same credit (a law runs to
 * hundreds of sections: the note gets the reference, not a copy).
 * Throws when the section is not in the imported copy.
 */
export async function openLawInsertion(ref: { id: number; name: string; section: string | null }, storage: OpenLawStorage = vaultStorage): Promise<string> {
  const entry = (await openLawIndex(storage))?.laws.find((l) => l.id === ref.id);
  const hit = entry ? await hitFor(entry, ref.section, storage) : null;
  if (!hit) throw new Error(ref.section ? `section ${ref.section} is not in the imported copy of ${ref.name}` : `${ref.name} is not in the imported Open Book of Laws`);
  const licence = `[CC BY-SA 4.0](${RIGHTS_URL["cc-by-sa"]})`;
  const credit = `מקור: [ספר החוקים הפתוח, ויקיטקסט](${hit.url}) · ${licence} · לא מקור רשמי`;
  if (!hit.section) return `[${hit.law.name}](${hit.url}) — ${credit}`;
  const body = hit.section.text.length > MAX_SECTION ? `${hit.section.text.slice(0, MAX_SECTION)}…` : hit.section.text;
  const cite = `סעיף ${hit.section.number} ל${hit.law.name}`;
  return [`> **${hit.section.number}.** ${body}`, ">", `> — ${cite}`, "", credit].join("\n");
}

export { OPEN_LAW_CREDIT };
