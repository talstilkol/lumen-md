/**
 * Contacts as person notes (plan W12.F6): where a contact goes, and how it
 * merges into a person that is already in the vault, such as an entity the
 * entity graph made (W12.E1) or a note typed `person` (W12.T1). Pure.
 *
 * Merge rule: the vault's values win. A property the note already has is
 * never overwritten; a missing one is added; a phone, email or address not
 * yet in a list is appended. The body is kept byte for byte, and the
 * contact's NOTE is appended only if the body does not contain it yet.
 */
import { readProperties, setProperty, type PropertyValue } from "../properties/frontmatter";
import { contactFromNote, contactProperties, personFileName, type Contact } from "./vcard";

/** The folder new contacts go to: the entity graph's folder for people (W12.E1). */
export const PEOPLE_FOLDER = "ישויות/אנשים";

const FM = /^﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1).replace(/\.md$/i, "");
const norm = (s: string) => s.normalize("NFC").trim().toLowerCase();

/** Is this note a person (`type: person`, or `entity-type: person`)? */
export function isPersonNote(text: string): boolean {
  return readProperties(text).some((p) => (p.key === "type" || p.key === "entity-type") && (Array.isArray(p.value) ? p.value.map(String).map(norm).includes("person") : norm(String(p.value ?? "")) === "person"));
}

/** The person note this contact is, by name or alias, or null. */
export function findPerson(contact: Contact, notes: ReadonlyArray<{ path: string; text: string }>): string | null {
  const want = norm(contact.fn);
  for (const n of notes) {
    if (!n.path.endsWith(".md") || !isPersonNote(n.text)) continue;
    if (norm(baseName(n.path)) === want) return n.path;
    const aliases = readProperties(n.text).find((p) => p.key === "aliases")?.value;
    const list = Array.isArray(aliases) ? aliases.map(String) : typeof aliases === "string" ? [aliases] : [];
    if (list.some((a) => norm(a) === want)) return n.path;
  }
  return null;
}

/** A new person note for the contact. */
export function newPersonNote(contact: Contact): { path: string; text: string } {
  let text = `# ${contact.fn}\n`;
  for (const [k, v] of Object.entries(contactProperties(contact))) text = setProperty(text, k, v as PropertyValue);
  if (contact.note) text += `\n${contact.note}\n`;
  return { path: `${PEOPLE_FOLDER}/${personFileName(contact)}`, text };
}

/** The existing person note with what the contact adds. */
export function mergeIntoPerson(text: string, contact: Contact): string {
  const have = new Map(readProperties(text).map((p) => [p.key, p.value]));
  let out = text;
  for (const [k, v] of Object.entries(contactProperties(contact))) {
    if (k === "entity-type" && have.has("entity-type")) continue;
    if (k === "type" && have.has("type")) continue;
    const cur = have.get(k);
    if (cur === undefined || cur === null || cur === "") out = setProperty(out, k, v as PropertyValue);
    else if (Array.isArray(v)) {
      const list = Array.isArray(cur) ? cur.map(String) : [String(cur)];
      const add = (v as string[]).filter((x) => !list.includes(x));
      if (add.length) out = setProperty(out, k, [...list, ...add]);
    }
  }
  if (contact.note && !out.includes(contact.note)) out = out.replace(/\s*$/, "") + `\n\n${contact.note}\n`;
  return out;
}

/** The contact a person note holds (for export). */
export function contactOfNote(path: string, text: string): Contact {
  const props = Object.fromEntries(readProperties(text).map((p) => [p.key, p.value]));
  const body = text.replace(FM, "");
  return contactFromNote(baseName(path), props, body);
}
