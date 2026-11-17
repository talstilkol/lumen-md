import { swallowed } from "../../lib/logger";

/**
 * Both versions of an automatically merged note go into its history (plan
 * W1.9), so a merge can always be undone from the version list.
 */
export async function keepBothVersions(path: string, ours: string, theirs: string): Promise<void> {
  const { recordSnapshot } = await import("../../storage/history");
  await recordSnapshot(path, theirs, "merge").catch((e: unknown) => (swallowed("sync/merge/keepVersions: the other side's version could not be kept in the note's history", e), false));
  await recordSnapshot(path, ours, "merge").catch((e: unknown) => (swallowed("sync/merge/keepVersions: this device's version could not be kept in the note's history", e), false));
}
