/**
 * The import wizard's shared shapes (plan W1.26).
 *
 * Every source converter turns the files of an export (archive path →
 * bytes) into a converted vault: notes (Markdown text), attachments
 * (bytes), and what it left out and why. The wizard then writes that vault
 * into a new folder, counts the links, and keeps what it needs to undo.
 */

export type ImportSourceId = "obsidian" | "notion" | "evernote" | "bear" | "appleNotes" | "keep" | "logseq" | "onenote" | "roam" | "craft" | "textbundle" | "dayOne" | "appleJournal" | "samsungNotes" | "airtable" | "tomboy" | "pandoc" | "lumen";

/** Why a file of the export did not become a note or an attachment. */
export type SkipReason =
  | "appFolder" // the tool's own settings (.obsidian, logseq/, …)
  | "trashed" // in the tool's trash
  | "duplicate" // another copy of a file already imported (Keep's .html next to its .json)
  | "unsupported" // a format this source cannot convert (with a hint in `detail`)
  | "empty" // nothing to import (an empty note)
  | "unreadable" // the file is broken (bad JSON, bad XML)
  | "encrypted"; // content the tool encrypted (Evernote en-crypt)

/** A note that came through with something missing. */
export type WarningReason =
  | "missingAttachment" // the note points at an attachment the export does not have
  | "encryptedPart" // part of the note was encrypted and is left out
  | "noDates" // the export carries no creation / modification dates
  | "notionComputed" // a Notion formula or rollup column: its values came across, not the formula (plan W8.2)
  | "notionUnparsed" // a Notion value that did not fit its column's type; kept as text (plan W8.2)
  | "notionColumnConverted" // W12.T7: a column became a type field of another kind (the detail says how)
  | "notionColumnLost" // W12.T7: a column did not become a type field (the detail says why)
  | "typeExists" // W12.T7: a type file of that id is already in the vault; it was left as it is
  | "remoteAttachment" // W13.F1: a file the app keeps on its servers (Roam's firebasestorage): the link is kept, nothing downloaded
  | "craftLink" // W13.F1: a link into Craft (craftdocs://) to something the export does not hold: its text is kept
  | "pdfOnly"; // W13.F2: a note exported as PDF (Samsung Notes): the PDF is shown in a note, its text not converted

export interface ImportIssue<R extends string> {
  path: string;
  reason: R;
  detail?: string;
}

export interface ConvertedVault {
  /** Path inside the import folder → Markdown (notes, and .base files). */
  notes: Map<string, string>;
  /** Path inside the import folder → bytes. */
  attachments: Map<string, Uint8Array>;
  skipped: ImportIssue<SkipReason>[];
  warnings: ImportIssue<WarningReason>[];
  /** Attachments the export held (the denominator of "0 lost"). */
  sourceAttachments: number;
  /** W12.T7: types to add to the vault (`.lumen/types/<id>.yaml`): id → YAML. */
  types?: Map<string, string>;
  /** W12.T7: the per-column report, Markdown lines. */
  typeReport?: string[];
}

export function emptyVault(): ConvertedVault {
  return { notes: new Map(), attachments: new Map(), skipped: [], warnings: [], sourceAttachments: 0 };
}

export interface LinkStats {
  /** Internal links and embeds in the imported notes. */
  total: number;
  /** …that point at a note or an attachment of the import. */
  resolved: number;
  /** The rest: note path → link target, at most 200 kept. */
  unresolved: { path: string; target: string }[];
}

export interface ImportReport {
  source: ImportSourceId;
  /** The folder of the vault the import went into. */
  folder: string;
  notes: number;
  attachments: number;
  /** `.base` files made from databases (Notion). */
  bases: number;
  skipped: ImportIssue<SkipReason>[];
  warnings: ImportIssue<WarningReason>[];
  links: LinkStats;
  /** Attachments of the export that are not in the vault after the import. */
  attachmentsLost: number;
  /** W12.T7: what became of each Notion column in its type (Markdown lines). */
  typeReport?: string[];
  /** When the import finished (ms). */
  at: number;
}
