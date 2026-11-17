/**
 * The vault screen (plan W13.M6), as Obsidian 1.15.1 Mobile has it: every
 * vault this device has opened, with where it is, how many notes, whether
 * it syncs and how many plugins it runs — read from a small cache, so no
 * vault is opened to show the list. Each card has Rename, Move, Move to
 * Recently deleted, and Open in safe mode (W13.T5). A vault whose last
 * opening never finished is marked, and offers safe mode first.
 *
 * The cache (IndexedDB, `lumen-vault-registry`) is written when a vault
 * opens and when its notes change; it holds no note text. "Recently deleted"
 * takes a vault off the list and keeps its notes untouched where they are;
 * Restore puts it back. After 30 days the entry is forgotten — the files
 * themselves are never deleted from here.
 */

export interface VaultCard {
  /** The vault identity (storage/vault/identity.ts). */
  id: string;
  /** The name shown (Rename changes only this). */
  name: string;
  /** Where it is, for people: "On this iPhone", a folder name. */
  where: string;
  /** The stored location (storage/vault/location.ts), to open it again; null for one that cannot be reopened from here. */
  location: unknown;
  files: number | null;
  bytes: number | null;
  sync: "off" | "on" | "error" | null;
  plugins: number | null;
  openedAt: number | null;
  /** The last opening of this vault never finished. */
  failedLastOpen: boolean;
  trashedAt?: number;
}

export interface Registry {
  v: 1;
  vaults: VaultCard[];
  trash: VaultCard[];
  /** The vault being opened right now (cleared when it opened). */
  opening: string | null;
}

export const REGISTRY_KEY = "lumen-vault-registry";
export const TRASH_DAYS = 30;
const DAY = 86_400_000;

export interface KV {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

export const emptyRegistry = (): Registry => ({ v: 1, vaults: [], trash: [], opening: null });

function valid(c: unknown): c is VaultCard {
  const x = c as Partial<VaultCard>;
  return !!x && typeof x.id === "string" && !!x.id && typeof x.name === "string";
}

export async function readRegistry(kv: KV): Promise<Registry> {
  try {
    const r = (await kv.get(REGISTRY_KEY)) as Partial<Registry> | undefined;
    if (!r || r.v !== 1) return emptyRegistry();
    return { v: 1, vaults: (r.vaults ?? []).filter(valid), trash: (r.trash ?? []).filter(valid), opening: typeof r.opening === "string" ? r.opening : null };
  } catch {
    // why: storage blocked or damaged: an empty list (the open vault adds itself again)
    return emptyRegistry();
  }
}

export async function writeRegistry(kv: KV, r: Registry): Promise<void> {
  await kv.set(REGISTRY_KEY, r);
}

/**
 * At start: a vault still marked "opening" never finished opening — mark it,
 * so the screen offers safe mode for it.
 */
export function afterStart(r: Registry): Registry {
  if (!r.opening) return r;
  const mark = (c: VaultCard) => (c.id === r.opening ? { ...c, failedLastOpen: true } : c);
  return { ...r, vaults: r.vaults.map(mark), opening: null };
}

/** About to open `id`. */
export function beginOpen(r: Registry, id: string): Registry {
  return { ...r, opening: id };
}

/** The vault is open and its stats are known: update (or add) its card, newest first. */
export function opened(r: Registry, card: Omit<VaultCard, "failedLastOpen" | "openedAt">, now: number): Registry {
  const prev = r.vaults.find((c) => c.id === card.id);
  const next: VaultCard = { ...prev, ...card, name: prev?.name ?? card.name, openedAt: now, failedLastOpen: false };
  return { ...r, opening: r.opening === card.id ? null : r.opening, vaults: [next, ...r.vaults.filter((c) => c.id !== card.id)], trash: r.trash.filter((c) => c.id !== card.id) };
}

/** Fresh stats for the open vault, without touching when it was opened. */
export function refreshStats(r: Registry, id: string, stats: Partial<Pick<VaultCard, "files" | "bytes" | "sync" | "plugins" | "where">>): Registry {
  return { ...r, vaults: r.vaults.map((c) => (c.id === id ? { ...c, ...stats } : c)) };
}

export class VaultPickerError extends Error {
  constructor(public code: "name-empty" | "name-long" | "name-taken" | "name-chars" | "not-found" | "is-open") {
    super(code);
    this.name = "VaultPickerError";
  }
}

/** A vault name: 1–80 characters, no slashes or control characters, unique on this device (case-insensitive). */
export function checkName(r: Registry, id: string, name: string): string {
  const n = name.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!n) throw new VaultPickerError("name-empty");
  if ([...n].length > 80) throw new VaultPickerError("name-long");
  if (/[/\\\u0000-\u001f\u007f]/.test(n)) throw new VaultPickerError("name-chars");
  if (r.vaults.some((c) => c.id !== id && c.name.toLocaleLowerCase() === n.toLocaleLowerCase())) throw new VaultPickerError("name-taken");
  return n;
}

export function rename(r: Registry, id: string, name: string): Registry {
  if (!r.vaults.some((c) => c.id === id)) throw new VaultPickerError("not-found");
  const n = checkName(r, id, name);
  return { ...r, vaults: r.vaults.map((c) => (c.id === id ? { ...c, name: n } : c)) };
}

/** Move to Recently deleted. The open vault cannot be: open another one first. */
export function trash(r: Registry, id: string, openId: string | null, now: number): Registry {
  const c = r.vaults.find((x) => x.id === id);
  if (!c) throw new VaultPickerError("not-found");
  if (id === openId) throw new VaultPickerError("is-open");
  return { ...r, vaults: r.vaults.filter((x) => x.id !== id), trash: [{ ...c, trashedAt: now }, ...r.trash] };
}

export function restore(r: Registry, id: string): Registry {
  const c = r.trash.find((x) => x.id === id);
  if (!c) throw new VaultPickerError("not-found");
  const { trashedAt: _t, ...back } = c;
  void _t;
  return { ...r, trash: r.trash.filter((x) => x.id !== id), vaults: [...r.vaults, back].sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0)) };
}

/** Forget entries deleted more than 30 days ago (their files are never touched). */
export function purgeExpired(r: Registry, now: number, days = TRASH_DAYS): Registry {
  return { ...r, trash: r.trash.filter((c) => now - (c.trashedAt ?? now) < days * DAY) };
}

/** Days left before a deleted entry is forgotten. */
export function daysLeft(c: VaultCard, now: number, days = TRASH_DAYS): number {
  return Math.max(0, Math.ceil((days * DAY - (now - (c.trashedAt ?? now))) / DAY));
}

/** "1.2 MB" — the size on the card. */
export function formatBytes(n: number | null, locale = "en"): string {
  if (n === null) return "";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: u ? 1 : 0 }).format(v)} ${units[u]}`;
}
