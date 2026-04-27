/**
 * Cloud sync barrel — single import point for the rest of the app.
 *
 * Today: Dropbox. Roadmap: Google Drive, iCloud Drive (web bridge).
 */

export type { CloudFile, CloudProvider, CloudConflictResolution, SyncReport } from "./types";
export { dropboxProvider, finishDropboxOAuth } from "./dropbox";
export { gdriveProvider, finishGDriveOAuth } from "./gdrive";
export { syncWithCloud } from "./sync";
