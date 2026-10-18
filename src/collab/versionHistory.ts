/**
 * Collaborative version history (plan 3.2): while a collab session runs,
 * the shared text is recorded every five minutes — and once more when the
 * session ends — into the one history store (src/storage/history.ts), under
 * the open note's history key, with reason "collab" and the local user as
 * author. The Version History panel shows them next to the note's other
 * versions. (It used to write a separate `LumenVersionHistory` database
 * that nothing read.)
 */

import { log } from "../lib/logger";
import { historyKey, recordSnapshot } from "../storage/history";
import { useAppStore } from "../store/useStore";

/** The history key collab snapshots of the open note are filed under. */
export function collabHistoryKey(roomId: string): string {
  const doc = useAppStore.getState().doc;
  return doc.name || doc.workspaceName ? historyKey(doc) : `collab:${roomId}`;
}

/** Record the shared text now (skipped when unchanged). */
export async function recordCollabSnapshot(roomId: string, text: string, author: string, now = Date.now()): Promise<boolean> {
  if (!text) return false;
  try {
    return await recordSnapshot(collabHistoryKey(roomId), text, "collab", now, author);
  } catch (e) {
    log.warn("[collab] snapshot failed", e);
    return false;
  }
}

/**
 * Background snapshots for a collab session; call once when it starts.
 * Returns a stop function, which also records the final text.
 */
export function startSnapshotInterval(
  roomId: string,
  getText: () => string,
  getAuthor: () => { name: string; clientId: number },
  intervalMs = 300_000, // 5 minutes
): () => void {
  const tick = () => void recordCollabSnapshot(roomId, getText(), getAuthor().name);
  const timer = setInterval(tick, intervalMs);
  return () => {
    clearInterval(timer);
    tick();
  };
}
