/** Moved out of ./location.ts unchanged (max-lines), which passes it to the folder and phone watchers. */

/**
 * The one-time notice for a sub-folder the watcher skips because it keeps
 * failing to list (review t5, L1): changes in it are not noticed until it can
 * be read again. The toast store and i18n load here, off the startup path.
 */
export function warnUnreadable(dir: string): void {
  void Promise.all([import("../../store/useToastStore"), import("../../i18n")])
    .then(([{ toast }, { t }]) => toast.warn(t("vault.watch.unreadable.title"), t("vault.watch.unreadable.body", { folder: dir })))
    .catch(() => undefined);
}
