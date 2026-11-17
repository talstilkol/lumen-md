/**
 * The boot sentinel (plans W13.T1, W13.T5): did the last start of this
 * version finish?
 *
 * Every start writes "boot in progress" for the running version; the app
 * clears it once it is up and has stayed up for a moment (markBootOk). A
 * start that finds the marker still set knows the one before it never got
 * there: a crash, a hang the user killed, or a page that died on a plugin,
 * a theme or a snippet. From that:
 *
 *   - one failed start of this version  → the app opens in safe mode (T5):
 *     no plugins, no vault snippets, no agents; a banner says why and offers
 *     diagnostics and a way out that does not restart everything;
 *   - two failed starts of a version that is not the last one that worked
 *     → a rollback is due (T1). The desktop shell does the real one before
 *     the WebView loads (src-tauri/src/boot_sentinel.rs, from the copy it
 *     kept when it installed the update; never from the manifest, so the
 *     anti-downgrade rule of W11.S2 still holds); here it only names the
 *     version to go back to, for the notice.
 *
 * Everything lives in one small localStorage record. Storage that throws
 * (private mode, blocked) means no sentinel: the app starts normally, never
 * in a loop of its own making. This module is on the startup path, so it
 * stays small and imports nothing.
 */

export const SENTINEL_KEY = "lumen-boot-sentinel";
/** Safe mode chosen for this session (the banner's "stay", or ?safe-mode). */
export const SAFE_SESSION_KEY = "lumen-safe-mode";
/** A start that ends within this long of the previous one's begin is the same start (StrictMode, a double import). */
const SAME_BOOT_MS = 1500;
/** How long the app must stay up before a start counts as good. */
export const BOOT_OK_AFTER_MS = 5000;

export interface SentinelState {
  v: 1;
  /** The version the last start ran. */
  version: string;
  /** Set while a start is in progress; cleared by markBootOk. */
  pending: boolean;
  /** Failed starts of `version` in a row. */
  failures: number;
  /** The last version that started cleanly. */
  good: string | null;
  /** When the last start began (ms). */
  at: number;
  /** Safe mode after a crash loop that the person has not left yet: the next start keeps it. */
  held?: boolean;
}

export type SafeReason = "crash-loop" | "manual" | null;

export interface BootDecision {
  version: string;
  /** Failed starts of this version in a row, this one not counted. */
  failures: number;
  safeMode: boolean;
  reason: SafeReason;
  /** T1: the last good version, when two starts of this one failed. */
  rollbackTo: string | null;
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function read(storage: Store | null): SentinelState | null {
  try {
    const raw = storage?.getItem(SENTINEL_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<SentinelState>;
    if (s.v !== 1 || typeof s.version !== "string") return null;
    return {
      v: 1,
      version: s.version,
      pending: s.pending === true,
      failures: Number.isInteger(s.failures) && (s.failures as number) >= 0 ? Math.min(s.failures as number, 99) : 0,
      good: typeof s.good === "string" ? s.good : null,
      at: typeof s.at === "number" ? s.at : 0,
      held: s.held === true,
    };
  } catch {
    // why: blocked storage or a damaged record: no sentinel, a normal start
    return null;
  }
}

function write(storage: Store | null, s: SentinelState): boolean {
  try {
    storage?.setItem(SENTINEL_KEY, JSON.stringify(s));
    return !!storage;
  } catch {
    // why: storage is full or blocked: this start goes unwatched, which only means no safe-mode offer next time
    return false;
  }
}

/** What the last state says about this start, without writing anything. */
export function decide(prev: SentinelState | null, version: string, now: number, manual = false): { next: SentinelState; decision: BootDecision } {
  let failures = 0;
  let good = prev?.good ?? null;
  if (prev && prev.version === version) {
    // The same start seen twice (a reload in the first second, StrictMode) is not a failure.
    const failed = prev.pending && now - prev.at > SAME_BOOT_MS;
    failures = failed ? prev.failures + 1 : prev.pending ? prev.failures : 0;
  } else if (prev && !prev.pending) {
    // A new version after a clean start of the old one.
    good = prev.version;
  }
  // A crash loop's safe mode lasts until the person leaves it, not just one start.
  const crashLoop = failures >= 1 || (prev?.held === true && prev.version === version);
  const rollbackTo = failures >= 2 && good && good !== version ? good : null;
  const reason: SafeReason = manual ? "manual" : crashLoop ? "crash-loop" : null;
  return {
    next: { v: 1, version, pending: true, failures, good, at: now, held: crashLoop && !manual ? true : prev?.held === true && prev.version === version },
    decision: { version, failures, safeMode: reason !== null, reason, rollbackTo },
  };
}

/** Call once, as early as possible in a start. */
export function beginBoot(version: string, deps: { storage?: Store | null; session?: Store | null; now?: number; search?: string } = {}): BootDecision {
  const storage = deps.storage === undefined ? localStore() : deps.storage;
  const session = deps.session === undefined ? sessionStore() : deps.session;
  const search = deps.search ?? (typeof location === "undefined" ? "" : location.search);
  let manual = /[?&]safe-mode(?:=1|=true)?(?:&|$)/.test(search);
  try {
    manual ||= session?.getItem(SAFE_SESSION_KEY) === "1";
  } catch {
    // why: session storage blocked: only the URL can ask for safe mode
  }
  const { next, decision } = decide(read(storage), version, deps.now ?? Date.now(), manual);
  write(storage, next);
  current = decision;
  safe = decision.safeMode;
  return decision;
}

/** The start finished: clear the marker and remember this version as good. */
export function markBootOk(deps: { storage?: Store | null; version?: string } = {}): void {
  const storage = deps.storage === undefined ? localStore() : deps.storage;
  const prev = read(storage);
  const version = deps.version ?? prev?.version ?? current?.version;
  if (!version) return;
  write(storage, { v: 1, version, pending: false, failures: 0, good: version, at: prev?.at ?? 0, held: safe && current?.reason === "crash-loop" });
}

/**
 * Clear the marker once the app has stayed up for BOOT_OK_AFTER_MS and the
 * root error screen has not been shown (noteBootCrash). Returns a cancel.
 */
export function armBootOk(deps: { storage?: Store | null; delayMs?: number; setTimer?: (f: () => void, ms: number) => unknown } = {}): () => void {
  let cancelled = false;
  const timer = deps.setTimer ?? ((f: () => void, ms: number) => setTimeout(f, ms));
  timer(() => {
    if (!cancelled && !crashed) markBootOk({ storage: deps.storage });
  }, deps.delayMs ?? BOOT_OK_AFTER_MS);
  return () => {
    cancelled = true;
  };
}

let crashed = false;
let current: BootDecision | null = null;
let safe = false;
/** Left safe mode with "AI agents" unticked: agents stay off for this session. */
let agentsOff = false;
const listeners = new Set<(on: boolean) => void>();

/** The root error screen was shown: this start did not succeed. */
export function noteBootCrash(): void {
  crashed = true;
}

export function bootDecision(): BootDecision | null {
  return current;
}

/** Plugins, vault snippets and agents check this before they start. */
export function isSafeMode(): boolean {
  return safe;
}

export class SafeModeError extends Error {
  constructor(public what: "plugin" | "agent" | "snippets") {
    super(`safe mode: ${what} not started`);
    this.name = "SafeModeError";
  }
}

/** Whether safe mode keeps `what` off (agents also stay off after leaving with them unticked). */
export function safeModeBlocks(what: SafeModeError["what"]): boolean {
  return safe || (what === "agent" && agentsOff);
}

/** Throws SafeModeError when safe mode keeps `what` off. */
export function assertNotSafeMode(what: SafeModeError["what"]): void {
  if (safeModeBlocks(what)) throw new SafeModeError(what);
}

/** Enter safe mode by choice (Settings, the palette): for this session, from the next start. */
export function requestSafeModeNextStart(session: Store | null = sessionStore()): void {
  try {
    session?.setItem(SAFE_SESSION_KEY, "1");
  } catch {
    // why: session storage blocked: the ?safe-mode link still works
  }
}

/**
 * Leave safe mode without a restart (as Obsidian 1.13 does): the flag goes
 * off, listeners (snippets, the banner) react, and nothing that was off is
 * started for the user; each comes back only as they choose.
 */
export function exitSafeMode(opts: { agents?: boolean } = {}, session: Store | null = sessionStore(), storage: Store | null = localStore()): void {
  try {
    session?.removeItem(SAFE_SESSION_KEY);
  } catch {
    // why: session storage blocked: nothing was kept there
  }
  const prev = read(storage);
  if (prev?.held) write(storage, { ...prev, held: false });
  if (!safe) return;
  safe = false;
  agentsOff = opts.agents === false;
  for (const f of [...listeners]) f(false);
}

export function onSafeModeChange(f: (on: boolean) => void): () => void {
  listeners.add(f);
  return () => void listeners.delete(f);
}

/** For tests: forget this start. */
export function resetBootForTests(): void {
  crashed = false;
  current = null;
  safe = false;
  agentsOff = false;
  listeners.clear();
}

function localStore(): Store | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function sessionStore(): Store | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}
