/**
 * Daily digest (T33): what changed in the vault since the last digest — a
 * short note with links to the changed notes, their headings, and the open
 * tasks in them. Deterministic (no model needed), so it works offline and
 * under every AI policy.
 */
import type { WorkspaceEntry } from "../../storage/workspace";

export interface DigestInput {
  since: number;
  now: number;
  /** Changed notes with their content. */
  notes: Array<{ entry: WorkspaceEntry; content: string }>;
  lang: string;
  formatDate: (ms: number) => string;
}

const L = {
  en: { title: "Digest", since: "Changes since", changed: "Changed notes", tasks: "Open tasks", none: "Nothing changed since the last digest.", more: "more" },
  he: { title: "סיכום", since: "שינויים מאז", changed: "פתקים שהשתנו", tasks: "משימות פתוחות", none: "שום דבר לא השתנה מאז הסיכום הקודם.", more: "נוספים" },
};

const stem = (p: string) => p.replace(/^.*\//, "").replace(/\.md$/i, "");

export function openTasks(md: string): string[] {
  return [...md.matchAll(/^\s*[-*] \[ \] (.+)$/gm)].map((m) => m[1].trim());
}

export function firstHeading(md: string): string | null {
  return /^#{1,3} (.+)$/m.exec(md)?.[1].trim() ?? null;
}

export function buildDigest(input: DigestInput): string {
  const t = input.lang === "he" ? L.he : L.en;
  const notes = [...input.notes].sort((a, b) => b.entry.modified - a.entry.modified);
  const out: string[] = [`# ${t.title} — ${input.formatDate(input.now)}`, "", `${t.since} ${input.formatDate(input.since)}.`, ""];
  if (!notes.length) {
    out.push(t.none);
    return out.join("\n") + "\n";
  }
  out.push(`## ${t.changed} (${notes.length})`, "");
  for (const n of notes.slice(0, 50)) {
    const h = firstHeading(n.content);
    out.push(`- [[${stem(n.entry.path)}]]${h && h !== stem(n.entry.path) ? ` — ${h}` : ""}`);
  }
  if (notes.length > 50) out.push(`- … +${notes.length - 50} ${t.more}`);
  const tasks = notes.flatMap((n) => openTasks(n.content).map((task) => ({ task, note: stem(n.entry.path) })));
  if (tasks.length) {
    out.push("", `## ${t.tasks} (${tasks.length})`, "");
    for (const x of tasks.slice(0, 40)) out.push(`- [ ] ${x.task} ← [[${x.note}]]`);
    if (tasks.length > 40) out.push(`- … +${tasks.length - 40} ${t.more}`);
  }
  return out.join("\n") + "\n";
}
