/**
 * Confirmation for `lumen://` links and unknown file types (plan W13.X5).
 *
 * Any web page or app can open a `lumen://` link. Obsidian 1.13 added a
 * confirmation and an allow-list for its URI scheme, and 1.15.1 a
 * confirmation before opening an unknown file type and per-device URI
 * callbacks. The rules here:
 *
 *   - a link that writes (a new note with content, a capture into the
 *     inbox, a web clip) or opens a file asks first, saying what it will
 *     do; "always allow from this source" is remembered on this device only
 *     (localStorage, outside the settings schema: never exported, imported
 *     or synced);
 *   - a link that only moves around (search, today's note, the empty
 *     capture box, an empty new note) does not ask;
 *   - a file of a type Lumen does not render as a note (an executable, a
 *     script, local HTML, anything unknown) asks every time, with a warning,
 *     and never offers "always"; local HTML that loads from the network
 *     says so;
 *   - every decision is listed in the privacy ledger.
 *
 * The source of a link: the operating system does not say which page or
 * app opened it, so the source is the action itself (`link:new`,
 * `link:capture`); a web clip names its page, so its source is that page's
 * origin (`clip:https://example.com`).
 */

export type LinkAction =
  | { kind: "nav"; what: "search" | "daily" | "capture-box" | "new-empty" }
  | { kind: "new-note"; title: string | null; text: string | null; folder: string | null }
  | { kind: "capture"; text: string }
  | { kind: "clip"; pageUrl: string; title: string }
  | { kind: "open-file"; path: string; html?: string | null };

export type FileRisk = "note" | "known" | "html" | "html-network" | "script" | "executable" | "unknown";

export interface LinkDecision {
  ask: boolean;
  /** What the confirmation says (an i18n key and its values). */
  describe: { key: string; values: Record<string, string> } | null;
  warning: { key: string; values: Record<string, string> } | null;
  /** The source "always allow" is remembered for; null when it may not be remembered. */
  source: string | null;
  risk: FileRisk | "write" | "none";
}

const NOTE_EXT = new Set(["md", "markdown", "mdx", "txt", "canvas", "base"]);
/** Types Lumen shows itself (readers and viewers), not as code. */
const KNOWN_EXT = new Set(["pdf", "epub", "png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "mp3", "m4a", "ogg", "wav", "mp4", "webm", "csv", "tsv", "json", "bib", "ris", "docx", "xlsx", "pptx", "odt", "ipynb", "excalidraw"]);
const SCRIPT_EXT = new Set(["sh", "bash", "zsh", "fish", "ps1", "psm1", "bat", "cmd", "vbs", "vbe", "js", "mjs", "cjs", "jse", "wsf", "wsh", "py", "pyw", "rb", "pl", "php", "applescript", "scpt", "command", "tool", "reg", "lnk", "url", "desktop", "jar", "hta"]);
const EXEC_EXT = new Set(["exe", "msi", "msix", "com", "scr", "pif", "cpl", "dll", "app", "pkg", "dmg", "deb", "rpm", "appimage", "apk", "ipa", "bin", "run", "elf", "so", "dylib"]);

export const extensionOf = (path: string): string => {
  const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};

/** Does local HTML load anything from the network (scripts, frames, images, styles, forms, fetch)? */
export function htmlLoadsNetwork(html: string): boolean {
  return /<(?:script|iframe|frame|img|link|object|embed|video|audio|source|form)\b[^>]*\b(?:src|href|action|data)\s*=\s*["']?\s*(?:https?:)?\/\//i.test(html) || /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|navigator\.sendBeacon)\s*\(/.test(html) || /url\(\s*["']?(?:https?:)?\/\//i.test(html) || /<meta[^>]+http-equiv\s*=\s*["']?refresh/i.test(html);
}

export function fileRisk(path: string, html?: string | null): FileRisk {
  const ext = extensionOf(path);
  if (NOTE_EXT.has(ext)) return "note";
  if (ext === "html" || ext === "htm" || ext === "xhtml" || ext === "mhtml" || ext === "svgz") return html && htmlLoadsNetwork(html) ? "html-network" : "html";
  if (EXEC_EXT.has(ext)) return "executable";
  if (SCRIPT_EXT.has(ext)) return "script";
  if (KNOWN_EXT.has(ext)) return "known";
  return "unknown";
}

const short = (s: string | null | undefined, n = 120) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

const originOf = (url: string): string | null => {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
};

/** What a link would do, and whether to ask. */
export function decideLink(a: LinkAction): LinkDecision {
  switch (a.kind) {
    case "nav":
      return { ask: false, describe: null, warning: null, source: null, risk: "none" };
    case "new-note":
      if (!a.title && !a.text && !a.folder) return { ask: false, describe: null, warning: null, source: null, risk: "none" };
      return { ask: true, describe: { key: "link.confirm.new", values: { title: short(a.title) || "—", folder: a.folder ?? "—", text: short(a.text) || "—" } }, warning: null, source: "link:new", risk: "write" };
    case "capture":
      return { ask: true, describe: { key: "link.confirm.capture", values: { text: short(a.text) } }, warning: null, source: "link:capture", risk: "write" };
    case "clip": {
      const origin = originOf(a.pageUrl);
      return { ask: true, describe: { key: "link.confirm.clip", values: { title: short(a.title) || "—", page: origin ?? short(a.pageUrl, 60) } }, warning: null, source: origin ? `clip:${origin}` : null, risk: "write" };
    }
    case "open-file": {
      const risk = fileRisk(a.path, a.html);
      const values = { path: short(a.path, 160), ext: extensionOf(a.path) || "?" };
      if (risk === "note" || risk === "known") return { ask: true, describe: { key: "link.confirm.open", values }, warning: null, source: "link:open", risk };
      const warning = { key: risk === "html-network" ? "link.warn.htmlNetwork" : risk === "html" ? "link.warn.html" : risk === "executable" ? "link.warn.executable" : risk === "script" ? "link.warn.script" : "link.warn.unknown", values };
      // An unknown or dangerous type is asked about every time: no "always".
      return { ask: true, describe: { key: "link.confirm.openUnknown", values }, warning, source: null, risk };
    }
  }
}

/* ─── "Always allow from this source": this device only ─── */

/** localStorage key. Not in the settings schema (src/settings/schema.ts), so settings export/import and sync never carry it. */
export const ALLOW_KEY = "lumen.links.allow.v1";

type Store = Pick<Storage, "getItem" | "setItem">;
const defaultStore = (): Store | null => {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
};

export function allowedSources(store: Store | null = defaultStore()): Record<string, number> {
  try {
    const v = JSON.parse(store?.getItem(ALLOW_KEY) ?? "{}") as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k, t]) => /^(link:[a-z]+|clip:https?:\/\/[^\s/]+)$/.test(k) && typeof t === "number")) as Record<string, number>;
  } catch {
    return {};
  }
}

export function allowSource(source: string, store: Store | null = defaultStore(), now = Date.now()): void {
  if (!/^(link:[a-z]+|clip:https?:\/\/[^\s/]+)$/.test(source)) return;
  store?.setItem(ALLOW_KEY, JSON.stringify({ ...allowedSources(store), [source]: now }));
}

export function forgetSource(source: string, store: Store | null = defaultStore()): void {
  const all = allowedSources(store);
  delete all[source];
  store?.setItem(ALLOW_KEY, JSON.stringify(all));
}

export interface ConfirmDeps {
  /** Shows the confirmation; resolves with the user's answer. */
  ask: (d: LinkDecision, a: LinkAction) => Promise<{ ok: boolean; always: boolean }>;
  /** The privacy ledger entry for this decision. */
  record?: (a: LinkAction, decision: "allowed" | "blocked", how: "asked" | "remembered" | "no-ask") => void;
  store?: Store | null;
}

/** Decide, ask when needed, remember "always" when offered, record. True when the action may run. */
export async function confirmLink(a: LinkAction, deps: ConfirmDeps): Promise<boolean> {
  const d = decideLink(a);
  const store = deps.store === undefined ? defaultStore() : deps.store;
  if (!d.ask) {
    deps.record?.(a, "allowed", "no-ask");
    return true;
  }
  if (d.source && allowedSources(store)[d.source]) {
    deps.record?.(a, "allowed", "remembered");
    return true;
  }
  let answer = { ok: false, always: false };
  try {
    answer = await deps.ask(d, a);
  } catch {
    answer = { ok: false, always: false }; // why: no dialog could be shown: nothing runs
  }
  if (answer.ok && answer.always && d.source) allowSource(d.source, store);
  deps.record?.(a, answer.ok ? "allowed" : "blocked", "asked");
  return answer.ok;
}

/** The ledger's reasons for a link decision (PRIVACY.md and PRIVACY.he.md list each one by this text). */
export const LINK_REASONS = {
  remembered: "A lumen:// link, allowed by your “always allow” on this device",
  allowed: "A lumen:// link; you allowed it",
  refused: "A lumen:// link; you did not allow it",
  noAsk: "A lumen:// link that only moves around in Lumen",
} as const;

/**
 * The privacy-ledger entry for a link decision (nothing goes over the network; the line names the action, never
 * the note's text): an allowed link as a share the user made, a refused one as a blocked request.
 */
export async function recordLinkDecision(a: LinkAction, decision: "allowed" | "blocked", how: "asked" | "remembered" | "no-ask"): Promise<void> {
  const { recordUserShare, recordBlockedRequest } = await import("../ai/privacyLedger");
  const reason = how === "remembered" ? LINK_REASONS.remembered : how === "asked" ? (decision === "allowed" ? LINK_REASONS.allowed : LINK_REASONS.refused) : LINK_REASONS.noAsk;
  if (decision === "allowed") recordUserShare(ledgerLine(a), 0, reason);
  else recordBlockedRequest(ledgerLine(a), "third-party", reason, "LINK");
}

/** The ledger line for a link decision: the action, never the note text. */
export function ledgerLine(a: LinkAction): string {
  switch (a.kind) {
    case "nav":
      return `lumen:// ${a.what}`;
    case "new-note":
      return "lumen://new";
    case "capture":
      return "lumen://capture";
    case "clip":
      return `lumen://clip (${originOf(a.pageUrl) ?? "unknown page"})`;
    case "open-file":
      return `lumen://open (.${extensionOf(a.path) || "?"})`;
  }
}
