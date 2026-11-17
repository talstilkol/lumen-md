/**
 * Version-history retention (plan W13.S1): how long a vault keeps the old
 * versions of its notes and of its attachments, Obsidian Sync style.
 *
 *   - notes: 30 days, a year or forever (the default: history as it was
 *     before this setting existed, bounded only by MAX_PER_DOC);
 *   - attachments (anything that is not a note: images, PDFs, CSV, JSON…):
 *     two weeks by default, 1–3650 days or forever.
 *
 * Kept per vault (`lumen.history.retention.v1.<vault id>`), so a family
 * vault can keep a year while a scratch vault keeps a month.
 *
 * The one rule pruning never breaks: the newest version of every document
 * stays, whatever its age. `planRetention` is pure (the property test drives
 * it with thousands of random histories); `history.pruneHistory` applies it
 * to the store and keeps every remaining delta chain readable.
 */

import { swallowed } from "../lib/logger";

export type NoteRetention = "30d" | "1y" | "forever";

export interface RetentionSettings {
  notes: NoteRetention;
  /** Days an attachment's old versions are kept; 0 = forever. */
  attachmentDays: number;
}

export const DEFAULT_RETENTION: RetentionSettings = { notes: "forever", attachmentDays: 14 };
export const NOTE_RETENTION_OPTIONS: readonly NoteRetention[] = ["30d", "1y", "forever"];
export const ATTACHMENT_DAY_OPTIONS: readonly number[] = [7, 14, 30, 90, 365, 0];
const DAY = 86_400_000;

/**
 * Note extensions — the same list as sync/e2ee/rules.ts NOTE_EXT (that
 * folder loads only on demand, so it is not imported here). Everything else
 * is an attachment.
 */
const NOTE_EXT = new Set(["md", "markdown", "mdx", "txt", "canvas", "base"]);
export function isAttachmentPath(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return !NOTE_EXT.has(dot > 0 ? name.slice(dot + 1).toLowerCase() : "");
}
const NOTE_MS: Record<NoteRetention, number> = { "30d": 30 * DAY, "1y": 365 * DAY, forever: Infinity };

const KEY = "lumen.history.retention.v1.";
const keyOf = (vault: string) => KEY + (vault || "default");

function valid(s: unknown): s is RetentionSettings {
  const r = s as RetentionSettings;
  return (
    !!r &&
    NOTE_RETENTION_OPTIONS.includes(r.notes) &&
    Number.isInteger(r.attachmentDays) &&
    r.attachmentDays >= 0 &&
    r.attachmentDays <= 3650
  );
}

/** The retention of vault `vault` ("" is the first vault); the default when none was set or the stored value is damaged. */
export function getRetention(vault: string): RetentionSettings {
  try {
    const raw = localStorage.getItem(keyOf(vault));
    if (!raw) return { ...DEFAULT_RETENTION };
    const parsed = JSON.parse(raw) as unknown;
    return valid(parsed) ? { notes: parsed.notes, attachmentDays: parsed.attachmentDays } : { ...DEFAULT_RETENTION };
  } catch {
    return { ...DEFAULT_RETENTION };
  }
}

export function setRetention(vault: string, next: RetentionSettings): void {
  if (!valid(next)) throw new RangeError("invalid retention settings");
  try {
    if (next.notes === DEFAULT_RETENTION.notes && next.attachmentDays === DEFAULT_RETENTION.attachmentDays) localStorage.removeItem(keyOf(vault));
    else localStorage.setItem(keyOf(vault), JSON.stringify(next));
  } catch (err) {
    swallowed("storage/historyRetention: storage is blocked; the retention stays as it was for this session", err);
  }
}

/** How long a version of `name` is kept, in ms (Infinity: forever). */
export function keepMsFor(name: string, s: RetentionSettings): number {
  if (isAttachmentPath(name)) return s.attachmentDays === 0 ? Infinity : s.attachmentDays * DAY;
  return NOTE_MS[s.notes];
}

export interface VersionRef {
  id: number;
  /** Document identity (the path), without any vault prefix. */
  name: string;
  timestamp: number;
  /** Stored bytes, for the space-saved estimate. */
  bytes?: number;
}

export interface RetentionPlan {
  /** Ids of the versions to delete. */
  victims: Set<number>;
  /** How many documents lose at least one version. */
  documents: number;
  bytes: number;
}

/**
 * Which versions the policy removes at `now`: every version older than its
 * document's keep time — except each document's newest version, which is
 * never removed (ties on time: the highest id is the newest, as the store
 * orders them).
 */
export function planRetention(rows: readonly VersionRef[], s: RetentionSettings, now: number): RetentionPlan {
  const newest = new Map<string, VersionRef>();
  for (const r of rows) {
    const n = newest.get(r.name);
    if (!n || r.timestamp > n.timestamp || (r.timestamp === n.timestamp && r.id > n.id)) newest.set(r.name, r);
  }
  const victims = new Set<number>();
  const docs = new Set<string>();
  let bytes = 0;
  for (const r of rows) {
    if (newest.get(r.name) === r) continue;
    const keep = keepMsFor(r.name, s);
    if (keep === Infinity || now - r.timestamp <= keep) continue;
    victims.add(r.id);
    docs.add(r.name);
    bytes += r.bytes ?? 0;
  }
  return { victims, documents: docs.size, bytes };
}

/** Apply the active vault's retention to its history (once per start, and from the settings). Null while no vault is open. */
export async function runRetention(now = Date.now(), opts: { dryRun?: boolean; settings?: RetentionSettings } = {}): Promise<{ versions: number; documents: number; bytes: number } | null> {
  const h = await import("./history");
  const v = h.getHistoryVault();
  if (v === null) return null;
  return h.pruneHistory(opts.settings ?? getRetention(v), now, { dryRun: opts.dryRun });
}
