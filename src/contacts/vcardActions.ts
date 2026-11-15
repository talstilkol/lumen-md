/**
 * The vCard commands (plan W12.F6), loaded on first use: import a .vcf into
 * person notes, and export every person note as one vCard 4.0 file. Both run
 * on this device only: the file is read from the picker and written to the
 * vault, or handed to the browser as a download. Nothing is sent anywhere.
 */
import "./strings";
import { t } from "../i18n";
import { useToastStore } from "../store/useToastStore";
import { explainError } from "../lib/userError";
import { prepareForExportSync } from "../lib/redaction";
import { parseVCards, toVCard } from "./vcard";
import { contactOfNote, findPerson, isPersonNote, mergeIntoPerson, newPersonNote } from "./personNotes";

const toast = (kind: "success" | "error" | "info", title: string) => useToastStore.getState().push({ kind, title });

function pickVcf(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".vcf,text/vcard,text/x-vcard";
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

async function vaultNotes(): Promise<{ path: string; text: string }[]> {
  const ws = await import("../storage/workspace");
  const out: { path: string; text: string }[] = [];
  for (const f of await ws.listWorkspace()) if (f.path.endsWith(".md")) out.push({ path: f.path, text: await ws.readWorkspaceFile(f.path).catch(() => "") });
  return out;
}

export async function importVcard(file?: File | null): Promise<void> {
  try {
    const picked = file ?? (await pickVcf());
    if (!picked) return;
    const contacts = parseVCards(await picked.text());
    if (!contacts.length) return void toast("info", t("contacts.none"));
    const ws = await import("../storage/workspace");
    const notes = await vaultNotes();
    let created = 0;
    let merged = 0;
    for (const c of contacts) {
      const at = findPerson(c, notes);
      if (at) {
        const cur = notes.find((n) => n.path === at)!;
        const next = mergeIntoPerson(cur.text, c);
        if (next !== cur.text) {
          await ws.writeWorkspaceFile(at, next);
          cur.text = next;
          merged++;
        }
      } else {
        const n = newPersonNote(c);
        const path = await ws.uniqueWorkspaceName(n.path);
        await ws.createWorkspaceFile(path, n.text);
        notes.push({ path, text: n.text });
        created++;
      }
    }
    toast("success", t("contacts.imported", { created, merged }));
  } catch (e) {
    toast("error", t("contacts.failed", { error: explainError(e) }));
  }
}

export async function exportVcard(): Promise<void> {
  try {
    const people = (await vaultNotes()).filter((n) => isPersonNote(n.text));
    if (!people.length) return void toast("info", t("contacts.noPeople"));
    // The export door (W5.11): <redact> passages and hidden comments never leave the device.
    const vcf = toVCard(people.map((n) => contactOfNote(n.path, prepareForExportSync(n.text))));
    const { downloadText } = await import("../storage/exportFormats");
    downloadText("people.vcf", vcf, "text/vcard");
    toast("success", t("contacts.exported", { n: people.length }));
  } catch (e) {
    toast("error", t("contacts.failed", { error: explainError(e) }));
  }
}
