/**
 * Privacy ledger (T37): every network request the AI features make is
 * recorded — where it went, how many bytes left and came back, why, and
 * under which AI policy — and a request that the policy forbids is blocked
 * before it leaves the machine.
 *
 * It wraps `window.fetch` once at startup, so it sees the requests of every
 * AI module (providers, embeddings, transcription, grammar, research, model
 * downloads) without each call site having to remember it. Only AI traffic
 * is logged; fonts, sync and the app's own files are not.
 *
 * What is stored: time, host, method, byte counts, category, reason,
 * policy, decision. Never the prompt, the response or any header.
 *
 * Not covered: requests made from inside Web Workers (web-llm and
 * transformers.js fetch model weights there — downloads, no user text),
 * unless the module that starts the worker reports them with
 * `recordWorkerRequest` (the OCR language models do).
 */
import { getAiPolicy, isLocalOrigin, type AiPolicy } from "./policy";
import { getBaseUrl } from "./ollamaProvider";
import { grammarEndpoint } from "./grammar";
import { researchEndpoint } from "../research/client";

export type LedgerCategory = "cloud-ai" | "cloud-text" | "local-ai" | "model-download" | "research";

export interface LedgerEntry {
  id: number;
  ts: number;
  host: string;
  method: string;
  bytesOut: number;
  bytesIn: number | null;
  category: LedgerCategory;
  reason: string;
  policy: AiPolicy;
  decision: "allowed" | "blocked";
  status?: number;
  /** Allowed under `local-only` because the user consented to this request (an agent network tool). */
  consent?: boolean;
}

/** Thrown (as the fetch rejection) when the policy forbids a request. */
export class PrivacyBlockedError extends Error {
  constructor(public readonly host: string, public readonly reason: string) {
    super(`Blocked by the local-only AI policy: ${reason} (${host})`);
    this.name = "PrivacyBlockedError";
  }
}

interface Rule {
  test: (host: string) => boolean;
  category: LedgerCategory;
  reason: string;
}

const RULES: Rule[] = [
  { test: (h) => h === "api.openai.com", category: "cloud-ai", reason: "OpenAI" },
  { test: (h) => h === "api.anthropic.com", category: "cloud-ai", reason: "Anthropic (Claude)" },
  { test: (h) => h === "generativelanguage.googleapis.com", category: "cloud-ai", reason: "Google Gemini" },
  { test: (h) => h === "api.mistral.ai", category: "cloud-ai", reason: "Mistral" },
  { test: (h) => h === "api.languagetool.org", category: "cloud-text", reason: "LanguageTool grammar check" },
  {
    test: (h) => h === "huggingface.co" || h.endsWith(".huggingface.co") || h.endsWith(".hf.co") || h === "hf.co",
    category: "model-download",
    reason: "Model download (Hugging Face)",
  },
  {
    test: (h) => h === "raw.githubusercontent.com",
    category: "model-download",
    reason: "Dictionary / OCR model download (GitHub)",
  },
];

const MAX_ENTRIES = 500;
const PERSIST_KEY = "lumen.privacy.ledger";
const PERSIST_LAST = 200;

let entries: LedgerEntry[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
let installed = false;
let onBlocked: ((entry: LedgerEntry) => void) | null = null;

function load(): void {
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      entries = parsed.filter((e): e is LedgerEntry => !!e && typeof e === "object" && typeof (e as LedgerEntry).host === "string");
      nextId = entries.reduce((m, e) => Math.max(m, e.id), 0) + 1;
    }
  } catch {
    entries = [];
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function save(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      localStorage.setItem(PERSIST_KEY, JSON.stringify(entries.slice(-PERSIST_LAST)));
    } catch {
      /* storage full / denied */
    }
  }, 500);
}

function emit(): void {
  for (const fn of [...listeners]) fn();
}

// `entries` is an immutable snapshot (useSyncExternalStore compares by
// reference): every change replaces the array and the changed entry.
function record(e: Omit<LedgerEntry, "id" | "ts">): number {
  const entry: LedgerEntry = { ...e, id: nextId++, ts: Date.now() };
  entries = [...entries, entry].slice(-MAX_ENTRIES);
  save();
  emit();
  return entry.id;
}

function patch(id: number, change: Partial<LedgerEntry>): void {
  entries = entries.map((x) => (x.id === id ? { ...x, ...change } : x));
  save();
  emit();
}

/** Is `u` one of the configured endpoint's request URLs (same origin, exact path)? */
function atEndpoint(u: URL, endpoint: string | null | undefined, suffixes: readonly string[] = [""]): boolean {
  if (!endpoint) return false;
  let e: URL;
  try {
    e = new URL(endpoint, typeof location !== "undefined" ? location.href : "http://localhost/");
  } catch {
    return false;
  }
  if (e.origin !== u.origin) return false;
  const base = e.pathname.replace(/\/+$/, "");
  return suffixes.some((sfx) => u.pathname === `${base}${sfx}` || (base === "" && sfx === "" && u.pathname === "/"));
}

/** How a URL is treated, or null for traffic the ledger doesn't track. */
export function classify(url: string): { host: string; category: LedgerCategory; reason: string } | null {
  let u: URL;
  try {
    u = new URL(url, typeof location !== "undefined" ? location.href : "http://localhost/");
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase();
  for (const r of RULES) if (r.test(host)) return { host, category: r.category, reason: r.reason };
  let ollamaHost = "";
  try {
    ollamaHost = new URL(getBaseUrl()).host.toLowerCase();
  } catch {
    /* no Ollama configured */
  }
  if (ollamaHost && u.host.toLowerCase() === ollamaHost) {
    return isLocalOrigin(u.href)
      ? { host, category: "local-ai", reason: "Ollama (this machine / LAN)" }
      : { host, category: "cloud-ai", reason: "Ollama on a remote server" };
  }
  // The configured endpoints, wherever they are hosted (a self-hosted
  // LanguageTool, a research worker on any domain).
  let grammar: string | null = null;
  try {
    grammar = grammarEndpoint();
  } catch {
    /* not configured */
  }
  if (atEndpoint(u, grammar)) {
    return isLocalOrigin(u.href)
      ? { host, category: "local-ai", reason: "LanguageTool (this machine / LAN)" }
      : { host, category: "cloud-text", reason: "LanguageTool grammar check" };
  }
  let research: string | null = null;
  try {
    research = researchEndpoint();
  } catch {
    /* not configured */
  }
  if (atEndpoint(u, research, ["/extract", "/search"])) {
    return isLocalOrigin(u.href)
      ? { host, category: "local-ai", reason: "Research (local service)" }
      : { host, category: "research", reason: "Research service" };
  }
  if (/\/(search|extract)(\?|$)/.test(u.pathname) && /research|searx/i.test(u.href)) {
    return isLocalOrigin(u.href)
      ? { host, category: "local-ai", reason: "Research (local SearXNG)" }
      : { host, category: "research", reason: "Research service" };
  }
  return null;
}

/** Would the policy block this category? Model downloads carry no user data. */
export function blockedByPolicy(category: LedgerCategory, policy: AiPolicy): boolean {
  if (policy !== "local-only") return false;
  return category === "cloud-ai" || category === "cloud-text" || category === "research";
}

function bodySize(body: BodyInit | null | undefined): number {
  if (body == null) return 0;
  if (typeof body === "string") return new TextEncoder().encode(body).length;
  if (body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  if (body instanceof URLSearchParams) return new TextEncoder().encode(body.toString()).length;
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    let n = 0;
    body.forEach((v) => {
      n += typeof v === "string" ? v.length : v.size;
    });
    return n;
  }
  return 0;
}

export interface LedgerOptions {
  /**
   * Record every request, also traffic `classify` doesn't track, with this
   * category and reason (an agent network tool: its requests always count).
   */
  force?: { category: LedgerCategory; reason: string };
  /** The user consented to these requests: `local-only` does not block them (they are still recorded). */
  consent?: boolean;
}

function hostOf(url: string): string {
  try {
    return new URL(url, typeof location !== "undefined" ? location.href : "http://localhost/").hostname.toLowerCase();
  } catch {
    return url;
  }
}

/** Wrap a fetch implementation with the ledger. Exported for tests. */
export function withLedger(inner: typeof fetch, opts: LedgerOptions = {}): typeof fetch {
  return async function ledgerFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const classified = classify(url);
    const hit = opts.force ? { host: classified?.host ?? hostOf(url), category: opts.force.category, reason: opts.force.reason } : classified;
    if (!hit) return inner(input, init);
    const policy = getAiPolicy();
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const bytesOut = bodySize(init?.body);
    if (!opts.consent && blockedByPolicy(hit.category, policy)) {
      const id = record({ ...hit, method, bytesOut: 0, bytesIn: null, policy, decision: "blocked" });
      const entry = entries.find((x) => x.id === id);
      if (entry) onBlocked?.(entry);
      throw new PrivacyBlockedError(hit.host, hit.reason);
    }
    const consented = !!opts.consent && blockedByPolicy(hit.category, policy);
    const id = record({ ...hit, method, bytesOut, bytesIn: null, policy, decision: "allowed", ...(consented ? { consent: true } : {}) });
    const res = await inner(input, init);
    const len = Number(res.headers.get("content-length"));
    patch(id, {
      bytesIn: Number.isFinite(len) && res.headers.has("content-length") ? len : null,
      status: res.status,
    });
    return res;
  };
}

/**
 * Record a request a Web Worker is about to make (the wrapped `window.fetch`
 * cannot see it). Only tracked traffic is recorded; model downloads are
 * never blocked, so this only logs. Returns the entry, or null.
 */
export function recordWorkerRequest(url: string, method = "GET"): LedgerEntry | null {
  const hit = classify(url);
  if (!hit) return null;
  const id = record({ ...hit, method, bytesOut: 0, bytesIn: null, policy: getAiPolicy(), decision: "allowed" });
  return entries.find((x) => x.id === id) ?? null;
}

/**
 * Record a request that was refused before it was made (an agent network
 * tool under `local-only` without consent) and return the error to throw.
 */
export function recordBlockedRequest(url: string, category: LedgerCategory, reason: string, method = "GET"): PrivacyBlockedError {
  const host = hostOf(url);
  const id = record({ host, category, reason, method, bytesOut: 0, bytesIn: null, policy: getAiPolicy(), decision: "blocked" });
  const entry = entries.find((x) => x.id === id);
  if (entry) onBlocked?.(entry);
  return new PrivacyBlockedError(host, reason);
}

/** The page's own fetch before the ledger wrapped it (so a ledger fetch built on it records each request once). */
let unwrappedFetch: typeof fetch | null = null;

/**
 * A fetch that records every request in the ledger under `opts` — for a
 * caller that already decided the request may go (the agent network-tool
 * gate). Built on the unwrapped fetch, so the global wrapper neither
 * records it twice nor blocks a request the user consented to.
 */
export function ledgerFetch(opts: LedgerOptions): typeof fetch {
  const base: typeof fetch = unwrappedFetch ?? ((input, init) => globalThis.fetch(input, init));
  return withLedger(base, opts);
}

/** Install once at startup. `blocked` is called for every blocked request. */
export function installPrivacyLedger(blocked?: (entry: LedgerEntry) => void): void {
  if (installed || typeof window === "undefined" || typeof window.fetch !== "function") return;
  installed = true;
  onBlocked = blocked ?? null;
  load();
  const original = window.fetch.bind(window);
  unwrappedFetch = original;
  window.fetch = withLedger(original);
}

export function ledgerEntries(): readonly LedgerEntry[] {
  return entries;
}

export function subscribeLedger(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function clearLedger(): void {
  entries = [];
  try {
    localStorage.removeItem(PERSIST_KEY);
  } catch {
    /* ignore */
  }
  emit();
}

/**
 * Did this request actually leave the device? Local traffic stays, and a
 * blocked attempt never reached the network.
 */
export function leftDevice(e: LedgerEntry): boolean {
  return e.decision === "allowed" && e.category !== "local-ai";
}

/** Totals for the panel header. */
export function ledgerSummary(list: readonly LedgerEntry[] = entries) {
  const cloud = list.filter((e) => e.decision === "allowed" && (e.category === "cloud-ai" || e.category === "cloud-text" || e.category === "research"));
  return {
    total: list.length,
    blocked: list.filter((e) => e.decision === "blocked").length,
    cloudRequests: cloud.length,
    cloudBytesOut: cloud.reduce((n, e) => n + e.bytesOut, 0),
    local: list.filter((e) => e.category === "local-ai").length,
    downloads: list.filter((e) => e.category === "model-download").length,
  };
}

/** Test hook. */
export function __resetLedger(): void {
  entries = [];
  nextId = 1;
  installed = false;
  onBlocked = null;
  unwrappedFetch = null;
  listeners.clear();
}
