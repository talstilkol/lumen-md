/**
 * Directional icons (plan W13.H3). The classification of every icon is in
 * ./direction.json; scripts/lib/iconDirection.mjs keeps the code in step.
 *
 * A directional icon in JSX takes `className="icon-dir"`, which mirrors it
 * under RTL (src/index.css). One that travels as a value — a command's icon
 * that the palette renders later — is marked with `dirIcon(Icon)`, and the
 * renderer asks `iconDirClass(Icon)` for the class.
 */
export const ICON_DIR = "icon-dir";

const marked = new WeakSet<object>();

/** Mark an icon component as directional; returns it unchanged. */
export function dirIcon<T extends object>(icon: T): T {
  marked.add(icon);
  return icon;
}

/** `"icon-dir"` for a component marked with dirIcon, otherwise undefined. */
export function iconDirClass(icon: unknown): string | undefined {
  return icon !== null && (typeof icon === "object" || typeof icon === "function") && marked.has(icon as object) ? ICON_DIR : undefined;
}
