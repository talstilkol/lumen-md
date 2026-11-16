/**
 * The app side of calendars (plan W7.20, W10.C4–C6): what Settings →
 * Calendar, the palette and the daily note call. The engine (caldav.ts,
 * taskSync.ts, ical.ts, dailyEvents.ts) is pure; this file brings the vault,
 * the secret store (config.ts) and the privacy ledger's calendar fetch.
 *
 *   • testConnection: one REPORT on the calendar, answered as a message key
 *     the settings screen shows in Hebrew or English.
 *   • syncTasksNow: the vault's dated tasks ↔ the chosen CalDAV calendar.
 *     A conflict goes to the conflict dialog (C5); a dismissed one stays
 *     unresolved and is reported, never decided silently.
 *   • calendarBlockFor: today's events from the ICS subscriptions, as the
 *     daily note's calendar block ({{calendar}} in the template, C6).
 */
import { CalDavError, createCalDavClient, discoverCalendars, type DiscoveredCalendar } from "./caldav";
import { authorizationFor, CALDAV_STATE, calendarFetch, httpUrl, readAccount, readSubscriptions, type CalDavAccount } from "./config";
import { BLOCK_END, BLOCK_START, eventLines, feedEventsOn } from "./dailyEvents";
import { emptyState, runSync, type Choice, type Conflict, type SyncReport, type SyncState, type VaultIO } from "./taskSync";
import "./calendarStrings";

export type ConnectionResult = { ok: true; tasks: number } | { ok: false; reason: "auth" | "cors" | "not-found" | "server" | "url" | "no-account" };

const reasonOf = (e: unknown): Exclude<ConnectionResult, { ok: true }>["reason"] => (e instanceof CalDavError ? (e.kind === "conflict" ? "server" : e.kind) : "server");

function validUrl(u: string): boolean {
  try {
    const x = new URL(u);
    return x.protocol === "https:" || (x.protocol === "http:" && /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(x.hostname));
  } catch {
    return false;
  }
}

/** Can Lumen read this calendar with these credentials? (One REPORT, through the privacy ledger.) */
export async function testConnection(account: CalDavAccount, authorization: string | undefined, f: typeof fetch = calendarFetch("caldav")): Promise<ConnectionResult> {
  if (!validUrl(account.url)) return { ok: false, reason: "url" };
  try {
    const list = await createCalDavClient({ collection: account.url, fetch: f, authorization }).list();
    return { ok: true, tasks: list.length };
  } catch (e) {
    return { ok: false, reason: reasonOf(e) };
  }
}

/** The calendars under a calendar home URL. */
export async function findCalendars(home: string, authorization: string | undefined, f: typeof fetch = calendarFetch("caldav")): Promise<DiscoveredCalendar[] | Exclude<ConnectionResult, { ok: true }>> {
  if (!validUrl(home)) return { ok: false, reason: "url" };
  try {
    return await discoverCalendars(home, { fetch: f, authorization });
  } catch (e) {
    return { ok: false, reason: reasonOf(e) };
  }
}

type KV = Pick<Storage, "getItem" | "setItem">;

function readState(store: KV | null): SyncState {
  try {
    const v = JSON.parse(store?.getItem(CALDAV_STATE) ?? "null") as SyncState | null;
    return v && v.v === 1 && v.entries ? v : emptyState();
  } catch {
    return emptyState();
  }
}

export interface SyncNowDeps {
  vault?: VaultIO;
  fetch?: typeof fetch;
  account?: CalDavAccount | null;
  authorization?: string;
  /** Asks about one conflict (default: the conflict dialog). null leaves it unresolved. */
  decide?: (c: Conflict) => Promise<Choice | null>;
  store?: KV | null;
  newUid?: () => string;
  now?: () => Date;
}

async function workspaceVault(): Promise<VaultIO> {
  const ws = await import("../storage/workspace");
  return {
    list: async () => (await ws.listWorkspace()).map((f) => f.path),
    read: async (p) => ((await ws.workspaceHasFile(p)) ? ws.readWorkspaceFile(p) : null),
    write: (p, c) => ws.writeWorkspaceFile(p, c),
  };
}

/** One task sync with the configured calendar. null when no account is set up. */
export async function syncTasksNow(d: SyncNowDeps = {}): Promise<SyncReport | null> {
  const account = d.account === undefined ? readAccount() : d.account;
  if (!account) return null;
  const store = d.store === undefined ? (typeof localStorage === "undefined" ? null : localStorage) : d.store;
  const decide = d.decide ?? (await import("../ui/CalendarConflictDialog")).askCalendarConflict;
  const report = await runSync({
    vault: d.vault ?? (await workspaceVault()),
    client: createCalDavClient({ collection: account.url, fetch: d.fetch ?? calendarFetch("caldav"), authorization: d.authorization ?? authorizationFor(account) }),
    state: readState(store),
    inbox: account.inbox,
    newUid: d.newUid ?? (() => crypto.randomUUID()),
    now: d.now ?? (() => new Date()),
    decide,
  });
  try {
    store?.setItem(CALDAV_STATE, JSON.stringify(report.state));
  } catch {
    /* why: storage full or blocked: the next sync starts from the server and the note ids, and re-agrees */
  }
  return report;
}

export interface CalendarBlockDeps {
  feeds?: Array<{ name: string; url: string }>;
  fetch?: typeof fetch;
  timeZone?: string;
  labels: { heading: string; allDay: string; none: string; failed: (name: string) => string };
}

/**
 * The daily note's calendar block for `day` (YYYY-MM-DD): each ICS
 * subscription's events, read only. Empty when there is no subscription, so
 * a template with {{calendar}} costs nothing (and sends nothing) until the
 * user adds one. A feed that fails is named, the others still show.
 */
export async function calendarBlockFor(day: string, d: CalendarBlockDeps): Promise<string> {
  const feeds = d.feeds ?? readSubscriptions().map((s) => ({ name: s.name, url: s.url }));
  if (!feeds.length) return "";
  const f = d.fetch ?? calendarFetch("ics");
  const got: Array<{ name: string; ics: string }> = [];
  const failed: string[] = [];
  for (const feed of feeds) {
    try {
      const res = await f(httpUrl(feed.url));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      got.push({ name: feed.name, ics: await res.text() });
    } catch {
      failed.push(feed.name);
    }
  }
  const lines = [...eventLines(feedEventsOn(got, day, d.timeZone), { allDay: d.labels.allDay, none: d.labels.none }), ...failed.map((n) => `- ${d.labels.failed(n)}`)];
  return [BLOCK_START, `## ${d.labels.heading}`, ...lines, BLOCK_END].join("\n");
}
