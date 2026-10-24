/**
 * Toggle a task in its note (plan 4.13): the line is rewritten only if it is
 * still the task that was shown (same line number and text); otherwise the
 * note changed meanwhile and nothing is written.
 */
import { parseTaskLine, serializeTask, toggleTask, type Task } from "./taskParser";

const todayIso = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The note with the task's line toggled, or null when the line no longer matches. */
export function toggledContent(content: string, task: Task, today = todayIso()): string | null {
  const lines = content.split("\n");
  const raw = lines[task.line];
  if (raw === undefined) return null;
  const cr = raw.endsWith("\r") ? "\r" : "";
  const line = cr ? raw.slice(0, -1) : raw;
  const now = parseTaskLine(line, task.path, task.line, task.heading);
  if (!now || now.description !== task.description || now.status !== task.status) return null;
  const marker = /^[\s\t>]*([-*+]|[0-9]+[.)])/.exec(line)?.[1] ?? "-";
  const prefix = /^[\s\t>]*/.exec(line)![0];
  const next = serializeTask({ ...toggleTask(now, today), indent: 0 }, marker);
  lines[task.line] = prefix + next + cr;
  return lines.join("\n");
}

/** Read, toggle and write back through the vault. Returns false when the note changed. */
export async function toggleTaskInVault(task: Task): Promise<boolean> {
  const { readWorkspaceFile, writeWorkspaceFile } = await import("../storage/workspace");
  const content = await readWorkspaceFile(task.path);
  const next = toggledContent(content, task);
  if (next === null) return false;
  await writeWorkspaceFile(task.path, next);
  window.dispatchEvent(new CustomEvent("lumen-workspace-changed", { detail: { paths: [task.path] } }));
  return true;
}

export { todayIso };
