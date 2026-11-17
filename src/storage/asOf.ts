/**
 * W12.S1 — "what I knew then": the vault as it was at a past moment.
 *
 * The history store (plan 3.2, `history.ts`) already keeps every save of
 * every note, as deltas with a full text every FULL_EVERY versions. The
 * vault as of a date is, per note, the newest snapshot taken at or before
 * that date. Nothing is written: this reads the store and returns texts.
 *
 * Limits, stated in the UI (`historyFrom`):
 *   - what was never saved into history does not exist here — a note
 *     created and deleted between two saves is gone;
 *   - history begins at the first snapshot (`historyFrom`); an earlier date
 *     returns an empty vault, unless a git log covers it (`gitFrom`);
 *   - history does not record deletions: a note deleted later still
 *     appears as of a date when it existed, which is the point. A note
 *     deleted "for good" (`clearHistory`) has no history left, so it is
 *     absent at every date.
 */
import { listDocuments, listSnapshots, type Snapshot } from "./history";

export interface AsOfNote {
  /** History key: the workspace path, else the display name. */
  name: string;
  content: string;
  /** When this version was saved (epoch ms). */
  timestamp: number;
  source: "history" | "git";
}

export interface AsOfVault {
  /** The requested moment (epoch ms). */
  asOf: number;
  /** Note name → its text as of `asOf`. */
  notes: Map<string, AsOfNote>;
  /** The oldest snapshot in the history store (null: no history at all). */
  historyFrom: number | null;
  /** The oldest commit the git source reached (null: no git source). */
  gitFrom: number | null;
}

/** One file version from a git log (see `sync/gitAsOf.ts`). */
export interface GitVersion {
  /** The note's name as the history store keys it (`<repoFolder>/<path>`). */
  name: string;
  content: string;
  /** Commit time (epoch ms). */
  timestamp: number;
}

/** Files as of `date` from a git repository, plus the time of its oldest commit. */
export type GitAsOfSource = (date: number) => Promise<{ files: GitVersion[]; from: number | null }>;

/**
 * The newest snapshot at or before `date` (ties: the higher id, which was
 * written last). Pure; `snapshots` may be in any order.
 */
export function pickAsOf<T extends Pick<Snapshot, "id" | "timestamp">>(snapshots: readonly T[], date: number): T | null {
  let best: T | null = null;
  for (const s of snapshots) {
    if (s.timestamp > date) continue;
    if (!best || s.timestamp > best.timestamp || (s.timestamp === best.timestamp && s.id > best.id)) best = s;
  }
  return best;
}

/**
 * The vault of the active history vault as of `date`. With `git`, files a
 * repository had at that date fill in notes whose history starts later
 * (history from before the app was installed); where both have a version,
 * the newer one at or before `date` wins, and history wins a tie (it saw
 * the unsaved-to-git edits).
 */
export async function vaultAsOf(date: number, opts: { git?: GitAsOfSource; signal?: AbortSignal } = {}): Promise<AsOfVault> {
  const notes = new Map<string, AsOfNote>();
  let historyFrom: number | null = null;
  for (const doc of await listDocuments()) {
    if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const snaps = await listSnapshots(doc.name);
    for (const s of snaps) historyFrom = historyFrom === null ? s.timestamp : Math.min(historyFrom, s.timestamp);
    const hit = pickAsOf(snaps, date);
    if (hit) notes.set(doc.name, { name: doc.name, content: hit.content, timestamp: hit.timestamp, source: "history" });
  }
  let gitFrom: number | null = null;
  if (opts.git) {
    const { files, from } = await opts.git(date);
    gitFrom = from;
    for (const f of files) {
      if (f.timestamp > date) continue;
      const have = notes.get(f.name);
      if (!have || f.timestamp > have.timestamp) notes.set(f.name, { name: f.name, content: f.content, timestamp: f.timestamp, source: "git" });
    }
  }
  return { asOf: date, notes, historyFrom, gitFrom };
}

/** The earliest moment the vault can be shown as of (null: no history and no git). */
export function coverageFrom(v: Pick<AsOfVault, "historyFrom" | "gitFrom">): number | null {
  const xs = [v.historyFrom, v.gitFrom].filter((x): x is number => x !== null);
  return xs.length ? Math.min(...xs) : null;
}
