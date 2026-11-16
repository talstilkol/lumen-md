/**
 * Every Markdown note under a vault folder, as { path, text } with
 * vault-relative "/" paths, in a stable order (plan 6.12, scripts/lora/export.mjs).
 * Hidden folders and files (.obsidian, .trash, .git) are skipped.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export function readNotes(root) {
  const notes = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith(".")) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.md$/i.test(name)) notes.push({ path: relative(root, p).split(sep).join("/"), text: readFileSync(p, "utf8") });
    }
  };
  walk(root);
  return notes;
}
