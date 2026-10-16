/**
 * The service worker caches each self-hosted language runtime (webR,
 * ruby.wasm, Pyodide) in a cache named per version, `lumen-runtime-<dir>-<version>-<staging revision>`.
 * Workbox's cleanup only covers its precache, so after an upgrade the old
 * runtime (tens of MB) would stay until quota eviction. Delete every
 * `lumen-runtime-*` cache that isn't one of the current names.
 */
export async function deleteStaleRuntimeCaches(
  current: readonly string[] = typeof __LUMEN_RUNTIME_CACHES__ === "undefined" ? [] : __LUMEN_RUNTIME_CACHES__,
  storage: Pick<CacheStorage, "keys" | "delete"> | undefined = globalThis.caches,
): Promise<string[]> {
  if (!storage || current.length === 0) return [];
  const keep = new Set(current);
  const stale = (await storage.keys()).filter((k) => k.startsWith("lumen-runtime-") && !keep.has(k));
  await Promise.all(stale.map((k) => storage.delete(k)));
  return stale;
}
