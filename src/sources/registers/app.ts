/**
 * The app side of the Israeli registers (plan R12.19): a record becomes a
 * source note in the vault (Sources/<register>/…), and the note that asked
 * for it gets a link. Loaded with the open-sources dialog, on use.
 *
 * The lookup itself runs inside the dialog's gated fetch, in sources/open/app:
 * the user confirms, and the request is consented traffic in the privacy
 * ledger under REGISTERS_REASON (./ckanRegister).
 */
import { workspaceHasFile, writeWorkspaceFile } from "../../storage/workspace";
import { sourceNote, type RegisterRecord } from "./ckanRegister";

const today = () => new Date().toISOString().slice(0, 10);

export interface SavedSource {
  path: string;
  /** The wiki link to put in the note. */
  link: string;
  /** True when the note was written now (false: a note for that record and day already existed). */
  written: boolean;
}

/** Write the record's source note (once per record and day) and return the link to it. */
export async function saveSourceNote(rec: RegisterRecord, deps: { retrieved?: string; has?: (p: string) => Promise<boolean>; write?: (p: string, c: string) => Promise<void> } = {}): Promise<SavedSource> {
  const note = sourceNote(rec, deps.retrieved ?? today());
  const path = note.path.replace(/\.md$/, ` ${deps.retrieved ?? today()}.md`);
  const has = deps.has ?? workspaceHasFile;
  const write = deps.write ?? writeWorkspaceFile;
  const exists = await has(path).catch(() => false);
  if (!exists) await write(path, note.content);
  if (!exists) window.dispatchEvent(new Event("lumen-workspace-changed"));
  return { path, link: `[[${path.replace(/\.md$/, "")}|${rec.name || rec.number}]]`, written: !exists };
}
