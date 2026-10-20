/**
 * What an error report may carry (plan 12.4). Loaded only with the Sentry
 * monitor, never on the startup path.
 *
 * Allowlist, not blocklist: the event is rebuilt from the few fields that
 * describe *the code* (error type, a scrubbed message, stack frames of the
 * app's own scripts) and everything else is dropped — request URL, user,
 * breadcrumbs, tags, extra, contexts, transaction names. Inside the kept
 * text, anything that could be the user's — quoted strings, file paths and
 * names, non-ASCII words (a Hebrew title), e-mail addresses, long numbers —
 * is replaced by a placeholder.
 */
import type { ErrorEvent, Exception, StackFrame } from "@sentry/browser";

const MAX_TEXT = 300;
const MAX_FRAMES = 50;

/** File names of notes and attachments the editor deals with. */
const FILE_EXT = /\.(md|markdown|mdx|txt|csv|tsv|json|ya?ml|html?|pdf|png|jpe?g|gif|webp|svg|docx?|xlsx?|pptx?|zip|canvas|excalidraw|ipynb)$/i;

/** Replace user-looking parts of a free-text string (an error message). */
export function scrubText(input: string): string {
  let s = input.slice(0, MAX_TEXT * 4);
  // Quoted segments: titles, note text, values the code interpolated.
  s = s.replace(/"[^"\n]*"|`[^`\n]*`|“[^”\n]*”|«[^»\n]*»/g, "[redacted]");
  s = s.replace(/(^|[\s(:=[])'[^'\n]*'(?=$|[\s),.:;!?\]])/g, "$1[redacted]");
  // An opening quote left unmatched (the cut above, or a multi-line value): drop the rest.
  s = s.replace(/["`“«][^]*$/, "[redacted]");
  s = s.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]");
  const out = s
    .split(/(\s+)/)
    .map((tok) => {
      if (/^\s*$/.test(tok)) return tok;
      // why: anything non-ASCII is a word the user wrote (titles, Hebrew text); the app's own messages are English
      if (/[^\x00-\x7f]/.test(tok)) return "[text]";
      const bare = tok.replace(/[),.:;!?\]]+$/, "");
      const tail = tok.slice(bare.length);
      if (/[/\\]/.test(bare)) return `[path]${tail}`;
      if (FILE_EXT.test(bare)) return `[file]${tail}`;
      if (/\d{6,}/.test(bare)) return `[number]${tail}`;
      return tok;
    })
    .join("");
  return out.length > MAX_TEXT ? `${out.slice(0, MAX_TEXT)}...` : out;
}

/** A script URL reduced to its file name (no origin, path, query or hash). */
export function scrubFilename(name: string | undefined): string | undefined {
  if (!name) return name;
  const noQuery = name.split(/[?#]/)[0];
  const base = noQuery.split(/[/\\]/).pop() ?? "";
  return /^[\w.@-]{1,120}$/.test(base) ? base : "[file]";
}

function scrubFrame(f: StackFrame): StackFrame {
  const out: StackFrame = {};
  const filename = scrubFilename(f.filename);
  if (filename !== undefined) out.filename = filename;
  if (f.function && /^[\w$.<>@ -]{1,120}$/.test(f.function)) out.function = f.function;
  if (typeof f.lineno === "number") out.lineno = f.lineno;
  if (typeof f.colno === "number") out.colno = f.colno;
  if (typeof f.in_app === "boolean") out.in_app = f.in_app;
  return out;
}

function scrubException(e: Exception): Exception {
  const out: Exception = {};
  if (e.type) out.type = scrubText(e.type);
  if (e.value) out.value = scrubText(e.value);
  if (e.mechanism) out.mechanism = { type: e.mechanism.type, handled: e.mechanism.handled };
  const frames = e.stacktrace?.frames;
  // why: Sentry lists frames oldest-first; the newest ones (the end) are where the error happened
  if (frames?.length) out.stacktrace = { frames: frames.slice(-MAX_FRAMES).map(scrubFrame) };
  return out;
}

/**
 * The event as it may leave the device. Returns a new object; fields that
 * aren't listed here are not sent.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const out: ErrorEvent = { type: undefined };
  if (event.event_id) out.event_id = event.event_id;
  if (event.timestamp !== undefined) out.timestamp = event.timestamp;
  if (event.level) out.level = event.level;
  if (event.platform) out.platform = event.platform;
  if (event.release) out.release = event.release;
  if (event.environment) out.environment = event.environment;
  // why: SDK metadata only; its settings carry infer_ip "never" (no IP address stored)
  if (event.sdk) out.sdk = event.sdk;
  if (typeof event.message === "string") out.message = scrubText(event.message);
  else if (event.logentry?.message) out.message = scrubText(event.logentry.message);
  const values = event.exception?.values;
  if (values?.length) out.exception = { values: values.map(scrubException) };
  return out;
}
