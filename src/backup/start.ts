/**
 * Backups in the running app (plan W1.6): the scheduler, fed with the saved
 * folder and the active vault, telling the user through toasts. Loaded only
 * when backups are set up (main.tsx checks a localStorage flag first).
 */

import { getVaultBackend } from "../storage/vault";
import { createFolderBackend, ensureFolderPermission } from "../storage/vault/location";
import { toast } from "../store/useToastStore";
import { t } from "../i18n";
import { backendTarget, BackupError, providerTarget, type BackupTarget } from "./backup";
import { loadBackupConfig, WEBDAV_BACKUP_PASSWORD, type BackupConfig } from "./config";
import { startBackupScheduler } from "./scheduler";
import "./strings";

/**
 * The archive store for a backup setting. `probe` (WebDAV, once when the user
 * sets the server up): create the lumen-backups/ folder and check that the
 * server takes writes, so a wrong password or address fails right away.
 */
export async function targetFor(c: BackupConfig, deps: { fetch?: typeof fetch; probe?: boolean } = {}): Promise<BackupTarget> {
  if (c.kind === "webdav") {
    // W10.C15: the sync's WebDAV provider (PROPFIND, PUT, GET, DELETE) as the target. It takes flat object names only
    // (checkObjectName: no "/"), so it is rooted at the lumen-backups/ folder (created on first write) with no prefix.
    const [{ webdavProvider }, { getSecret }] = await Promise.all([import("../sync/e2ee/providers/webdav"), import("../lib/secretStore")]);
    const password = getSecret(WEBDAV_BACKUP_PASSWORD);
    if (!password) throw new BackupError(t("backup.webdav.noPassword"));
    const root = `${c.url.replace(/\/+$/, "")}/lumen-backups/`;
    const provider = webdavProvider({ url: root, username: c.username, password }, deps.fetch ? { fetch: deps.fetch } : {});
    if (deps.probe) await provider.probe();
    return providerTarget(provider, c.label, "");
  }
  // Without a click the browser may not grant the folder again: that is a failure the user sees and fixes in the panel.
  if (!(await ensureFolderPermission(c.handle, false))) throw new BackupError(t("backup.reconnect"));
  return backendTarget(createFolderBackend(c.handle), c.label);
}

let scheduler: ReturnType<typeof startBackupScheduler> | null = null;

export function startBackups(): ReturnType<typeof startBackupScheduler> {
  scheduler ??= startBackupScheduler({
    config: async () => {
      const c = await loadBackupConfig();
      return c ? { target: await targetFor(c), mode: c.mode } : null;
    },
    vault: () => getVaultBackend(),
    notify: (kind, detail) => {
      if (kind === "failed") toast.error(t("backup.toast.failed"), detail);
      else if (kind === "stale") toast.warn(t("backup.toast.stale", { days: detail }));
    },
  });
  return scheduler;
}
