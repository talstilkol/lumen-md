/**
 * The only module the startup code imports for the encrypted sync (plan 3.5),
 * and only on use. It keeps the startup chunk small: a dynamic import of the
 * panel itself would put the panel's whole chunk-dependency list (Vite's
 * preload map) into the eager bundle; this hop puts one entry there instead.
 */
export function openSync(): Promise<void> {
  return import("./open").then((m) => m.openSyncPanel());
}

export function finishOAuth(kind: "dropbox" | "gdrive", code: string): Promise<void> {
  return import("./open").then((m) => m.finishOAuthReturn(kind, code));
}
