/**
 * The vault screen's side effects (plan W13.M6): the registry in IndexedDB,
 * the open vault's stats, opening another vault, and the screen itself
 * (mounted on demand, in its own chunk). The rules are in ./vaultPicker.ts.
 */
import { get as idbGet, set as idbSet } from "idb-keyval";
import { afterStart, beginOpen, opened, readRegistry, refreshStats, writeRegistry, type KV, type VaultCard } from "./vaultRegistry";

export const kv: KV = { get: (k) => idbGet(k), set: (k, v) => idbSet(k, v) };
/** The stored location's key (storage/vault/location.ts). */
const LOCATION_KEY = "lumen-vault-location";
/** How long the app must stay up with a vault before its opening counts (as the boot sentinel, W13.T5). */
export const OPEN_OK_AFTER_MS = 5000;

type StoredLike = { kind?: string; name?: string; store?: string; root?: string; handle?: { name?: string } };

/** "On this iPhone", "Files › Lumen", a folder's name: where a vault is, for people. */
export function whereOf(loc: StoredLike | null | undefined, t: (k: string, v?: Record<string, string | number>) => string, platform: string): string {
  if (!loc || loc.kind === "opfs") return t("vaults.where.browser");
  if (loc.kind === "mobile") return loc.store === "documents" ? t("vaults.where.files", { name: loc.name ?? "Lumen" }) : loc.store === "app" ? t("vaults.where.device", { device: platform }) : t("vaults.where.folder", { name: loc.name ?? "" });
  if (loc.kind === "desktop") return loc.root ?? loc.name ?? "";
  return t("vaults.where.folder", { name: loc.name ?? loc.handle?.name ?? "" });
}

/** The open vault's card: identity, where, notes, size, sync and plugins — no note text. */
export async function currentCard(t: (k: string, v?: Record<string, string | number>) => string): Promise<Omit<VaultCard, "failedLastOpen" | "openedAt"> | null> {
  const [{ activeVaultId }, { listWorkspace }, { getSyncStatus }, { installedPlugins }, { getVaultStatus }] = await Promise.all([import("../storage/vault/identity"), import("../storage/workspace"), import("../sync/syncStatus"), import("../plugins/install"), import("../storage/vault/location")]);
  const id = activeVaultId();
  if (!id) return null;
  const loc = ((await kv.get(LOCATION_KEY).catch(() => null)) ?? { kind: "opfs" }) as StoredLike;
  let files: number | null = null;
  let bytes: number | null = null;
  try {
    const list = await listWorkspace();
    files = list.filter((e) => /\.md$/i.test(e.path)).length;
    bytes = list.reduce((n, e) => n + (e.size || 0), 0);
  } catch {
    // why: the vault is not readable right now: the card shows no counts rather than wrong ones
  }
  const s = getSyncStatus();
  const plugins = Object.keys(await installedPlugins().catch(() => ({}))).length;
  const status = getVaultStatus();
  const platform = /iPad/.test(navigator.userAgent) ? "iPad" : /iPhone/.test(navigator.userAgent) ? "iPhone" : /Android/.test(navigator.userAgent) ? "Android" : "";
  return {
    id,
    name: loc.name ?? ("name" in status ? status.name : "") ?? "Lumen",
    where: whereOf(loc, t, platform || t("vaults.where.thisDevice")),
    location: loc,
    files,
    bytes,
    sync: s.provider === null ? "off" : s.status === "error" ? "error" : "on",
    plugins,
  };
}

let tracking = false;

/**
 * At start (once): a vault whose last opening never finished is marked; this
 * one is "opening" until the app has stayed up OPEN_OK_AFTER_MS, then its
 * card is written with fresh stats, and kept fresh as its notes change.
 */
export async function trackVaultOpen(deps: { now?: () => number; delay?: (f: () => void, ms: number) => void } = {}): Promise<void> {
  if (tracking) return;
  tracking = true;
  const now = deps.now ?? Date.now;
  const delay = deps.delay ?? ((f, ms) => void setTimeout(f, ms));
  const [{ t }, { activeVaultId }] = await Promise.all([import("../i18n"), import("../storage/vault/identity")]);
  let reg = afterStart(await readRegistry(kv));
  const id = activeVaultId();
  if (id) reg = beginOpen(reg, id);
  await writeRegistry(kv, reg).catch(() => undefined);
  if (!id) return;
  delay(() => {
    void (async () => {
      const card = await currentCard(t);
      if (!card) return;
      await writeRegistry(kv, opened(await readRegistry(kv), card, now())).catch(() => undefined);
      const ev = await import("../storage/workspaceEvents");
      ev.onWorkspaceChanged(
        () =>
          void currentCard(t).then(async (c) => {
            if (c) await writeRegistry(kv, refreshStats(await readRegistry(kv), c.id, c)).catch(() => undefined);
          }),
        { debounceMs: 15_000 },
      );
    })();
  }, OPEN_OK_AFTER_MS);
}

/** Open another vault from its card: mark it "opening", switch, and reload the page into it (safe mode when asked). */
export async function openVault(card: VaultCard, opts: { safeMode?: boolean } = {}): Promise<boolean> {
  const loc = card.location as StoredLike | null;
  if (!loc?.kind) return false;
  await writeRegistry(kv, beginOpen(await readRegistry(kv), card.id));
  const m = await import("../storage/vault/location");
  if (loc.kind === "opfs") await m.switchToBrowserStorage();
  else if (loc.kind === "desktop" && loc.root) await m.switchDesktopVault(loc.root);
  else if (loc.kind === "mobile") await m.openMobileFolderAsVault(loc as never);
  else if (loc.kind === "folder" && loc.handle) {
    if (!(await m.openFolderAsVault(loc.handle as FileSystemDirectoryHandle))) return false;
  } else return false;
  // W13.T5's safe mode reads ?safe-mode at the next start; a reload opens the vault with a clean page.
  const url = new URL(location.href);
  url.search = opts.safeMode ? "?safe-mode" : "";
  location.assign(url.toString());
  return true;
}

let mounted: { close: () => void } | null = null;

/** Show the vault screen (the palette, ?action=vaults). Returns a close function. */
export async function openVaultPicker(): Promise<() => void> {
  if (mounted) return mounted.close;
  const [{ createRoot }, { createElement }, { VaultPicker }] = await Promise.all([import("react-dom/client"), import("react"), import("./VaultPicker")]);
  const host = document.createElement("div");
  host.dataset.vaultPicker = "";
  document.body.append(host);
  const root = createRoot(host);
  const close = () => {
    root.unmount();
    host.remove();
    mounted = null;
  };
  mounted = { close };
  root.render(createElement(VaultPicker, { onClose: close }));
  return close;
}
