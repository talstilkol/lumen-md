/**
 * The native capture queue, drained into the inbox (plans W11.P8, W11.P9,
 * W11.P10).
 *
 * Captures made outside the WebView wait in a native queue:
 * - iOS: one JSON file per capture in the App Group
 *   (ios/App/Shared/CaptureQueue.swift), written atomically;
 * - Android: the share intent (ShareActivity) and the Quick Settings tile's
 *   capture box (CaptureActivity), one JSON file per capture in the app's
 *   files folder (android/…/CaptureQueue.java), moved into place atomically.
 *
 * The WebView lists the queue and adds each capture to inbox.md. It writes
 * the capture's id to a journal (localStorage) and only then asks the native
 * side to remove it. So whatever the step at which the app is killed, a
 * capture is never lost:
 *
 * | killed …                              | next start                         |
 * |---------------------------------------|------------------------------------|
 * | while the native side writes          | the rename never happened: nothing was captured yet, and nothing half-written is listed |
 * | before the inbox write finishes       | not journaled, still queued: added |
 * | after the inbox write, before the journal | still queued: added again (a repeat, never a loss) |
 * | after the journal, before the removal | journaled: not added again, removed |
 */
import { MAX_TEXT, type PendingCapture } from "./nativeActions";
import { wordSlug } from "../lib/slug";

export type CaptureKind = "text" | "url" | "image" | "pdf";
export const CAPTURE_SOURCES = ["siri", "shortcut", "control", "lockscreen", "widget", "tile", "share", "legacy"] as const;
export type CaptureSource = (typeof CAPTURE_SOURCES)[number];

export interface QueuedCapture extends PendingCapture {
  kind: CaptureKind;
  source: CaptureSource;
  /** The shared link (kind url). */
  url?: string;
  /** The queued file's stored name (image / pdf), read with `captureFile`. */
  file?: string;
  mime?: string;
  /** The file's original name. */
  name?: string;
  /** The sharing app's package (Android's referrer), when the system said. */
  app?: string;
}

const KINDS: readonly CaptureKind[] = ["text", "url", "image", "pdf"];
const clean = (s: string) => [...s].filter((c) => c === "\n" || c === "\t" || c.charCodeAt(0) >= 0x20).join("");
const isWebUrl = (s: string) => {
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
};
/** A stored file name: no folders, nothing hidden. */
const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * Well-formed captures, oldest first, once each. Entries from before W11.P8
 * (id, text, at only) are text captures from Siri.
 */
export function validQueue(items: unknown): QueuedCapture[] {
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  const out: QueuedCapture[] = [];
  for (const x of items) {
    const p = (x ?? {}) as Partial<Record<keyof QueuedCapture, unknown>>;
    if (typeof p.id !== "string" || !p.id || typeof p.at !== "string" || !Number.isFinite(Date.parse(p.at)) || seen.has(p.id)) continue;
    const kind = (typeof p.kind === "string" ? p.kind : "text") as CaptureKind;
    if (!KINDS.includes(kind)) continue;
    const source = (CAPTURE_SOURCES as readonly string[]).includes(p.source as string) ? (p.source as CaptureSource) : p.source === undefined ? "siri" : null;
    if (!source) continue;
    const text = typeof p.text === "string" ? clean(p.text).trim() : "";
    if (text.length > MAX_TEXT) continue;
    const c: QueuedCapture = { id: p.id, kind, source, text, at: p.at };
    if (kind === "text" && !text) continue;
    if (kind === "url") {
      if (typeof p.url !== "string" || !isWebUrl(p.url)) continue;
      c.url = p.url;
    }
    if (kind === "image" || kind === "pdf") {
      if (typeof p.file !== "string" || !SAFE_FILE.test(p.file)) continue;
      c.file = p.file;
      if (typeof p.mime === "string") c.mime = p.mime;
      if (typeof p.name === "string") c.name = clean(p.name).trim().slice(0, 200);
    }
    if (typeof p.app === "string" && /^[A-Za-z0-9_.]{1,200}$/.test(p.app)) c.app = p.app;
    seen.add(p.id);
    out.push(c);
  }
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** Ids already added to the inbox, kept until the native side has removed them. */
export interface CaptureJournal {
  has(id: string): boolean;
  add(id: string): void;
  /** Forget ids the native queue no longer has. */
  keepOnly(ids: Set<string>): void;
}

export const JOURNAL_KEY = "lumen.capturesAdded";

export function storageJournal(storage: Pick<Storage, "getItem" | "setItem"> | null = safeLocalStorage()): CaptureJournal {
  const read = (): string[] => {
    try {
      const v = JSON.parse(storage?.getItem(JOURNAL_KEY) ?? "[]") as unknown;
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  };
  const write = (ids: string[]) => storage?.setItem(JOURNAL_KEY, JSON.stringify(ids.slice(-2000)));
  return {
    has: (id) => read().includes(id),
    add: (id) => {
      const ids = read();
      if (!ids.includes(id)) write([...ids, id]);
    },
    keepOnly: (keep) => write(read().filter((id) => keep.has(id))),
  };
}

function safeLocalStorage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

/**
 * The inbox text of a text or link capture. Shared text that is a chat
 * message (WhatsApp, Telegram) keeps its app, author and time (chatShareText,
 * plan W5.7; W11.P10 closes the gap for Android's share sheet).
 */
export async function captureText(c: QueuedCapture): Promise<string> {
  if (c.kind === "url") return [c.text, `<${c.url}>`].filter(Boolean).join(" ");
  if (c.source === "share") {
    const { chatShareText } = await import("../capture/chats/share");
    return chatShareText(c.text) ?? c.text;
  }
  return c.text;
}

export interface DrainTarget {
  /** Add text to the inbox, with the capture's time. */
  text(text: string, when: Date, c: QueuedCapture): Promise<unknown>;
  /** Save a file and add it to the inbox; absent → files wait in the queue. */
  file?(c: QueuedCapture, bytes: Uint8Array, when: Date): Promise<unknown>;
}

export interface DrainSource {
  list(): Promise<unknown>;
  read?(file: string): Promise<Uint8Array>;
  remove(ids: string[]): Promise<void>;
}

/**
 * Add every queued capture to the inbox, in order, then remove what was
 * added. A failure stops at that capture and keeps it and the rest for next
 * time. Returns the ids removed.
 */
export async function drainQueue(src: DrainSource, to: DrainTarget, journal: CaptureJournal = storageJournal()): Promise<string[]> {
  const items = validQueue(await src.list());
  const done: string[] = [];
  for (const c of items) {
    if (!journal.has(c.id)) {
      try {
        if (c.kind === "image" || c.kind === "pdf") {
          if (!to.file || !src.read) break;
          await to.file(c, await src.read(c.file!), new Date(c.at));
        } else {
          await to.text(await captureText(c), new Date(c.at), c);
        }
      } catch {
        break; // keep this one and the rest, in order
      }
      journal.add(c.id);
    }
    done.push(c.id);
  }
  if (done.length) await src.remove(done);
  // What is still queued keeps its journal entry (a removal that failed is retried, not re-added).
  journal.keepOnly(new Set(items.map((c) => c.id).filter((id) => !done.includes(id))));
  return done;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** `attachments/capture-2026-11-15-0905-<name>.pdf`: the time, then the original name made safe. */
export function captureFilePath(c: QueuedCapture, when: Date): string {
  const ext = (c.file!.match(/\.([A-Za-z0-9]{1,8})$/)?.[1] ?? (c.kind === "pdf" ? "pdf" : "jpg")).toLowerCase();
  const base = wordSlug((c.name ?? "").replace(/\.[A-Za-z0-9]{1,8}$/, ""), { nfc: true, max: 40 });
  const stamp = `${when.getFullYear()}-${pad2(when.getMonth() + 1)}-${pad2(when.getDate())}-${pad2(when.getHours())}${pad2(when.getMinutes())}`;
  return `attachments/capture-${stamp}${base ? `-${base}` : ""}-${c.id.slice(0, 8).toLowerCase()}.${ext}`;
}

/** The inbox line of a file capture: the caption, then the image embedded or the PDF linked. */
export function fileEntryText(c: QueuedCapture, path: string): string {
  const link = c.kind === "image" ? `![${c.name ?? ""}](<${path}>)` : `[${c.name || path.split("/").pop()}](<${path}>)`;
  return [c.text, link].filter(Boolean).join("\n");
}

/** Save a queued image or PDF under attachments/ and add its line to the inbox. Resolves to the inbox path. */
export async function captureFileToInbox(c: QueuedCapture, bytes: Uint8Array, when: Date): Promise<string | null> {
  const [{ writeWorkspaceBlob }, { notifyWorkspaceChanged }, { captureToInbox }] = await Promise.all([import("../storage/workspace"), import("../storage/workspaceEvents"), import("../capture/quickCapture")]);
  const path = captureFilePath(c, when);
  await writeWorkspaceBlob(path, bytes);
  notifyWorkspaceChanged({ kind: "structure", paths: [path] });
  return captureToInbox(fileEntryText(c, path), when);
}

export const fromBase64 = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
