/**
 * The note the file tree keeps for "Compare with…" (plan W13.R8): pick one
 * note, then "Compare with ‘…’" on another opens the compare view. Tiny and
 * dependency-free, since the file tree is in the startup bundle; the view
 * itself loads on use (./openCompare.tsx).
 */
let picked: { path: string; label: string } | null = null;

export function pickForCompare(path: string, label: string): void {
  picked = { path, label };
}

export function pickedForCompare(): { path: string; label: string } | null {
  return picked;
}

/** Open the compare view for the picked note (old, first) and `path` (new). False: nothing picked, or the same note. */
export async function compareWithPicked(path: string, label: string, read: (p: string) => Promise<string>): Promise<boolean> {
  const from = picked;
  if (!from || from.path === path) return false;
  const [a, b] = await Promise.all([read(from.path), read(path)]);
  const m = await import("./openCompare");
  await m.openCompare({ label: from.label, text: a }, { label, text: b });
  return true;
}
