/**
 * The blob URLs of workspace images the preview shows (`LumenImg` in
 * components.tsx), cached for the page's lifetime. Codex P2 on #235 (audit r3,
 * W10.G10): the cache was keyed by path and version only, so after a vault
 * switch `notes/a.png` showed the other vault's image. Every entry is now
 * filed under the open vault (its identity and its backend generation), and
 * the first use after a switch revokes and drops every URL of the old vault.
 * A read that started in the old vault is not stored for the new one.
 */
import { activeVaultId } from "../storage/vault/identity";
import { vaultGeneration } from "../storage/vault";

const cache = new Map<string, { url: string; version: string }>();
let scope: string | null = null;

/** The open vault, as the cache scopes it. */
export function blobUrlScope(): string {
  return `${activeVaultId() ?? "?"}#${vaultGeneration()}`;
}

function revoke(url: string): void {
  try {
    URL.revokeObjectURL(url);
  } catch {
    /* why: nothing to revoke in a test DOM */
  }
}

/** The scope now; a switch since the last call empties the cache. */
function current(): string {
  const s = blobUrlScope();
  if (s !== scope) {
    for (const c of cache.values()) revoke(c.url);
    cache.clear();
    scope = s;
  }
  return s;
}

/** The cached URL for `key` in the open vault, if it was made from this version of the file. */
export function cachedBlobUrl(key: string, version: string): string | undefined {
  const c = cache.get(`${current()}\u0000${key}`);
  return c && c.version === version ? c.url : undefined;
}

/**
 * Keep `url` for `key` in the vault `forScope` it was read from. False (and
 * the URL revoked) when the vault was switched while it was being read.
 */
export function storeBlobUrl(key: string, version: string, url: string, forScope: string): boolean {
  if (current() !== forScope) {
    revoke(url);
    return false;
  }
  cache.set(`${forScope}\u0000${key}`, { url, version });
  return true;
}

/** @internal tests */
export function __blobUrlCacheSize(): number {
  return cache.size;
}
