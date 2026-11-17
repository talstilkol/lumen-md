/**
 * What e2e/perf-vault.spec.ts drives in the page (plan 8.4): the index's
 * public calls plus a vault write, reached through
 * `window.__lumen.vaultIndex()` so the spec works against the production
 * build, where /src modules cannot be imported. A lazy chunk: nothing here
 * is on the startup path.
 */
export { ensureIndex, findBacklinks, indexStats, searchWorkspace } from "./workspaceIndex";
// W6.36 (e2e/encrypted-reopen.spec.ts): write the sealed snapshot now, as the idle timer would, and
// how the last open filled the index (from the snapshot, or read).
export { __saveSnapshotNow as saveSnapshotNow, snapshotCounters } from "./workspaceIndex";
export { writeWorkspaceFile } from "./workspace";
export { notifyWorkspaceChanged } from "./workspaceEvents";
