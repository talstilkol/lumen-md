/**
 * Quick capture (plan 4.16): a line typed into the capture box, or text
 * shared to the installed app, is added to the end of `inbox.md` in the
 * vault as a timestamped list item that links to that day's daily note
 * (plan 4.12):
 *
 *   - [[2026-10-20]] 14:05 call the plumber
 *     a second line stays inside the same item
 *
 * The inbox is created (with a heading) when it is missing; what is already
 * in it is never rewritten — an entry only ever goes after the last byte.
 * When the inbox is open in a tab, its unsaved edits are kept: the entry is
 * added to the open text, not to the older copy on disk.
 *
 * Loaded on demand (the capture box, the share target and the desktop
 * shortcut import it), so none of this is in the startup bundle.
 */

import { t } from "../i18n";
import { flushPendingEdits, useAppStore } from "../store/useStore";
import { readWorkspaceFile, workspaceHasFile, writeWorkspaceFile } from "../storage/workspace";
import { notifyWorkspaceChanged } from "../storage/workspaceEvents";
import { dayOf, fileNameFor, type DailySettings } from "../daily/dailyNote";
import type { SharedItem } from "../pwa/launch";

/** The inbox note, at the root of the vault. */
export const INBOX_PATH = "inbox.md";

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * One capture as a Markdown list item: the day's daily note as a wiki link,
 * the local time, then the text. Further lines are indented so they stay in
 * the item. The text itself is kept as typed (Hebrew, emoji, bidi marks);
 * only blank lines around it and trailing spaces are dropped. Null when
 * there is nothing to capture.
 */
export function formatEntry(text: string, when: Date, daily: Pick<DailySettings, "pattern">): string | null {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trimEnd());
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (!lines.length) return null;
  const note = fileNameFor(dayOf(when), daily.pattern).replace(/\.(md|markdown)$/i, "");
  const [first, ...rest] = lines;
  const head = `- [[${note}]] ${pad2(when.getHours())}:${pad2(when.getMinutes())} ${first.trimStart()}`;
  return [head, ...rest.map((l) => (l.trim() ? `  ${l}` : ""))].join("\n");
}

/**
 * The inbox with `entry` added at the end. `existing` null = there is no
 * inbox yet: it starts with a heading. Existing text is kept byte for byte;
 * at most a newline is added after it, so the entry starts on its own line.
 */
export function appendEntry(existing: string | null, entry: string, heading: string = t("capture.inboxHeading")): string {
  if (existing === null) return `# ${heading}\n\n${entry}\n`;
  if (!existing) return `${entry}\n`;
  return `${existing}${existing.endsWith("\n") ? "" : "\n"}${entry}\n`;
}

/** The text of a shared item (share target): title and link, then the text. */
export function sharedText(item: SharedItem): string {
  const head = [item.title, item.link ? `<${item.link}>` : ""].filter(Boolean).join(" ");
  return [head, item.text].filter(Boolean).join("\n");
}

// Captures run one after another: two at once must not both read the old
// inbox and the second write drop the first entry.
let queue: Promise<unknown> = Promise.resolve();

/**
 * Add `text` to the end of the inbox (created if missing). Resolves to the
 * inbox path, or null when the text was empty.
 */
export function captureToInbox(text: string, when: Date = new Date()): Promise<string | null> {
  const job = queue.then(() => capture(text, when));
  queue = job.catch(() => undefined);
  return job;
}

async function capture(text: string, when: Date): Promise<string | null> {
  const entry = formatEntry(text, when, useAppStore.getState().dailyNotes);
  if (!entry) return null;
  // Edits the editor has not handed to the store yet belong to the base too.
  flushPendingEdits();
  const s = useAppStore.getState();
  const tab = s.openTabs.find((x) => x.workspaceName === INBOX_PATH);
  const exists = await workspaceHasFile(INBOX_PATH);
  const base = s.doc.workspaceName === INBOX_PATH ? s.doc.content : tab ? tab.content : exists ? await readWorkspaceFile(INBOX_PATH) : null;
  const next = appendEntry(base, entry);
  await writeWorkspaceFile(INBOX_PATH, next);
  // The open copy follows the file. Typed into while we wrote: keep that
  // text and add the entry to it; autosave writes it.
  useAppStore.setState((st) => {
    const active = st.doc.workspaceName === INBOX_PATH;
    const typed = active && st.doc.content !== (base ?? "") && st.doc.content !== next;
    const doc = !active ? st.doc : typed ? { ...st.doc, content: appendEntry(st.doc.content, entry), dirty: true } : { ...st.doc, content: next, dirty: false };
    const openTabs = st.openTabs.map((x) => (x.workspaceName !== INBOX_PATH ? x : active ? { ...x, content: doc.content, dirty: doc.dirty } : { ...x, content: next, dirty: false }));
    return { doc, openTabs };
  });
  notifyWorkspaceChanged(exists ? { kind: "content", paths: [INBOX_PATH] } : { kind: "structure", paths: [INBOX_PATH] });
  return INBOX_PATH;
}

/** Show the inbox: its open tab (with any unsaved edits), or a new tab from disk. */
export async function openInbox(): Promise<void> {
  const s = useAppStore.getState();
  if (s.doc.workspaceName === INBOX_PATH) return;
  const tab = s.openTabs.find((x) => x.workspaceName === INBOX_PATH);
  const content = tab ? tab.content : await readWorkspaceFile(INBOX_PATH);
  s.openTab({ name: INBOX_PATH, content, workspaceName: INBOX_PATH });
}

/**
 * Something shared to the installed app (Android share sheet, desktop
 * share): added to the inbox, then the inbox is shown. Resolves to the
 * inbox path, or null when nothing was shared.
 */
export async function captureShared(item: SharedItem): Promise<string | null> {
  const path = await captureToInbox(sharedText(item));
  if (path) await openInbox().catch(() => undefined);
  return path;
}
