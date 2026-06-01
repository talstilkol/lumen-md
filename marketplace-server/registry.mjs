/**
 * Plugin / template / theme marketplace registry — pure logic.
 *
 * Kept dependency-free and side-effect-free so it can be unit-tested directly
 * (see src/__tests__/marketplaceRegistry.test.ts) and wrapped by a thin HTTP
 * server (./server.mjs). This is the real backend that replaces the old
 * static registry.json + localStorage-counter facade.
 */

const VALID_TYPES = new Set(["template", "plugin", "theme"]);

export function createStore(initial = []) {
  const items = new Map();
  for (const it of initial) {
    try {
      publishItem({ items }, it, { keepStats: true });
    } catch {
      /* skip malformed seed entries */
    }
  }
  return { items };
}

function ratingOf(item) {
  return item.ratingCount ? item.ratingSum / item.ratingCount : 0;
}

/** Public, JSON-safe view of a stored item (rating computed from sum/count). */
export function serialize(item) {
  return {
    id: item.id,
    type: item.type,
    name: item.name,
    description: item.description,
    author: item.author,
    version: item.version,
    url: item.url,
    tags: item.tags,
    downloads: item.downloads,
    rating: Math.round(ratingOf(item) * 100) / 100,
    ratingCount: item.ratingCount,
    publishedAt: item.publishedAt,
    updatedAt: item.updatedAt,
  };
}

/** List items, optionally filtered by type + free-text query, ranked by downloads. */
export function listItems(store, { type, query } = {}) {
  let items = [...store.items.values()];
  if (type) items = items.filter((i) => i.type === type);
  if (query) {
    const q = String(query).toLowerCase();
    items = items.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        i.description.toLowerCase().includes(q) ||
        i.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }
  items.sort((a, b) => b.downloads - a.downloads || a.name.localeCompare(b.name));
  return items.map(serialize);
}

/** Publish (or update) an item. Validates required fields; preserves stats. */
export function publishItem(store, item, { keepStats = true } = {}) {
  if (!item || typeof item.id !== "string" || !item.id.trim())
    throw new Error("publish: a non-empty string id is required");
  if (typeof item.name !== "string" || !item.name.trim())
    throw new Error("publish: a non-empty name is required");
  if (!VALID_TYPES.has(item.type))
    throw new Error("publish: type must be one of template|plugin|theme");

  const id = item.id.trim();
  const prev = store.items.get(id);
  const now = new Date().toISOString();
  const record = {
    id,
    type: item.type,
    name: item.name.trim(),
    description: String(item.description ?? ""),
    author: String(item.author ?? "anonymous"),
    version: String(item.version ?? "1.0.0"),
    url: String(item.url ?? ""),
    tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
    downloads: keepStats && prev ? prev.downloads : Number(item.downloads) || 0,
    ratingSum: keepStats && prev ? prev.ratingSum : 0,
    ratingCount: keepStats && prev ? prev.ratingCount : 0,
    publishedAt: prev ? prev.publishedAt : now,
    updatedAt: now,
  };
  store.items.set(id, record);
  return serialize(record);
}

/** Record a real install — increments the download counter. */
export function recordInstall(store, id) {
  const item = store.items.get(id);
  if (!item) throw new Error("install: unknown id: " + id);
  item.downloads += 1;
  return item.downloads;
}

/** Add a 1–5 rating; returns the new average. */
export function rateItem(store, id, rating) {
  const item = store.items.get(id);
  if (!item) throw new Error("rate: unknown id: " + id);
  const r = Number(rating);
  if (!Number.isInteger(r) || r < 1 || r > 5)
    throw new Error("rate: an integer rating 1–5 is required");
  item.ratingSum += r;
  item.ratingCount += 1;
  return ratingOf(item);
}

/** Serialize the whole store for file persistence. */
export function dumpStore(store) {
  return [...store.items.values()].map((i) => ({
    ...serialize(i),
    ratingSum: i.ratingSum,
  }));
}
