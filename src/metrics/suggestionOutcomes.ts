/**
 * What happens to each agent's suggestions (plan W13.A4): accepted,
 * rejected, edited before accepting, cancelled — and how long the user
 * took to decide. Counted on this device only, next to the W4.26 counters.
 *
 * An eval measures quality in the lab; this measures whether the user
 * actually wants what an agent suggests. An agent whose suggestions are
 * accepted less than 30% of the time (after at least 10 decisions) is
 * marked for review in the eval (`flaggedForEval`).
 *
 * - Fed by the review queue (agents/staging.ts, plan 5.11): a change seen
 *   pending is "proposed"; applied is "accepted", or "edited" when the user
 *   changed its text first; rejected is "rejected"; withdrawn because its
 *   run was cancelled is "cancelled"; a conflict (approved, but the file
 *   had changed) is counted apart.
 * - Kept in localStorage (`lumen.agentOutcomes.v1`): per agent id, the
 *   counts and the last 100 decision times in ms. No text, no note name,
 *   no time of day.
 * - Turning counting off (W4.26) stops it and clears it.
 * - This module makes no request. The counts leave the device only in the
 *   weekly report, and only when the user ticked "include agent outcomes"
 *   (`shareableOutcomes` returns null otherwise); the report itself is
 *   sent by the user's click and listed in the privacy ledger (W4.26).
 */
import { countingEnabled } from "./usage";

export const OUTCOMES_KEY = "lumen.agentOutcomes.v1";
export const SHARE_OUTCOMES_KEY = "lumen.agentOutcomes.share";
export const FLAG_BELOW = 0.3;
export const FLAG_MIN_DECISIONS = 10;
const KEEP_DURATIONS = 100;
const AGENT_ID = /^[a-z][\w:.-]{0,63}$/i;

export type Outcome = "accepted" | "rejected" | "edited" | "cancelled" | "conflict";

export interface AgentOutcomes {
  proposed: number;
  accepted: number;
  rejected: number;
  edited: number;
  cancelled: number;
  conflict: number;
  /** Time from proposal to decision, ms, the last 100. */
  ms: number[];
}

export interface OutcomesStore {
  v: 1;
  agents: Record<string, AgentOutcomes>;
}

const empty = (): AgentOutcomes => ({ proposed: 0, accepted: 0, rejected: 0, edited: 0, cancelled: 0, conflict: 0, ms: [] });

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0);

export function loadOutcomes(s: Pick<Storage, "getItem"> | null = storage()): OutcomesStore {
  try {
    const v = JSON.parse(s?.getItem(OUTCOMES_KEY) ?? "null") as OutcomesStore | null;
    if (!v || v.v !== 1 || !v.agents || typeof v.agents !== "object") return { v: 1, agents: Object.create(null) };
    const agents: Record<string, AgentOutcomes> = Object.create(null);
    for (const [id, a] of Object.entries(v.agents)) {
      if (!AGENT_ID.test(id) || !a || typeof a !== "object") continue;
      agents[id] = { proposed: n(a.proposed), accepted: n(a.accepted), rejected: n(a.rejected), edited: n(a.edited), cancelled: n(a.cancelled), conflict: n(a.conflict), ms: Array.isArray(a.ms) ? a.ms.map(n).slice(-KEEP_DURATIONS) : [] };
    }
    return { v: 1, agents };
  } catch {
    return { v: 1, agents: Object.create(null) };
  }
}

function save(store: OutcomesStore, s: Storage | null = storage()): void {
  try {
    s?.setItem(OUTCOMES_KEY, JSON.stringify(store));
  } catch {
    // why: storage full or refused — the counts stay for this session
  }
}

/** Count one event for an agent (nothing when counting is off). */
export function countOutcome(agentId: string, event: "proposed" | Outcome, ms?: number, s: Storage | null = storage()): void {
  if (!countingEnabled(s) || !AGENT_ID.test(agentId)) return;
  const store = loadOutcomes(s);
  const a = (store.agents[agentId] ??= empty());
  a[event]++;
  if (event !== "proposed" && typeof ms === "number" && Number.isFinite(ms) && ms >= 0) a.ms = [...a.ms, Math.round(ms)].slice(-KEEP_DURATIONS);
  save(store, s);
}

export function clearOutcomes(s: Storage | null = storage()): void {
  try {
    s?.removeItem(OUTCOMES_KEY);
  } catch {
    /* why: nothing to clear without storage */
  }
}

export interface AgentReportRow {
  agent: string;
  proposed: number;
  decided: number;
  /** Accepted as proposed, of the decided (null: nothing decided yet). */
  acceptRate: number | null;
  /** Accepted after an edit, of the decided. */
  editRate: number | null;
  rejectRate: number | null;
  cancelRate: number | null;
  /** Median time to decide, ms. */
  medianMs: number | null;
  /** Below 30% accepted (as proposed or edited) after ≥ 10 decisions: the eval should look at it. */
  flagged: boolean;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/** One row per agent: every agent in `agents` (also those never used), then any other counted id. */
export function outcomesReport(store: OutcomesStore, agents: readonly string[]): AgentReportRow[] {
  const ids = [...new Set([...agents, ...Object.keys(store.agents).sort()])];
  return ids.map((agent) => {
    const a = store.agents[agent] ?? empty();
    const decided = a.accepted + a.rejected + a.edited + a.cancelled;
    const rate = (x: number) => (decided ? x / decided : null);
    const taken = rate(a.accepted + a.edited);
    return {
      agent,
      proposed: a.proposed,
      decided,
      acceptRate: rate(a.accepted),
      editRate: rate(a.edited),
      rejectRate: rate(a.rejected),
      cancelRate: rate(a.cancelled),
      medianMs: median(a.ms),
      flagged: decided >= FLAG_MIN_DECISIONS && (taken ?? 1) < FLAG_BELOW,
    };
  });
}

/** The agents the eval should look at again. */
export function flaggedForEval(store: OutcomesStore, agents: readonly string[] = []): string[] {
  return outcomesReport(store, agents).filter((r) => r.flagged).map((r) => r.agent);
}

/** Did the user tick "include agent outcomes" in the weekly report? Off by default. */
export function shareOutcomesEnabled(s: Pick<Storage, "getItem"> | null = storage()): boolean {
  try {
    return s?.getItem(SHARE_OUTCOMES_KEY) === "1";
  } catch {
    return false;
  }
}

export function setShareOutcomes(on: boolean, s: Storage | null = storage()): void {
  try {
    if (on) s?.setItem(SHARE_OUTCOMES_KEY, "1");
    else s?.removeItem(SHARE_OUTCOMES_KEY);
  } catch {
    /* why: storage refused: it stays off */
  }
}

/** The part of the weekly report about agents: counts and rates only, or null without the user's consent. */
export function shareableOutcomes(store: OutcomesStore, agents: readonly string[], s: Pick<Storage, "getItem"> | null = storage()): Array<Omit<AgentReportRow, "medianMs"> & { medianSeconds: number | null }> | null {
  if (!shareOutcomesEnabled(s)) return null;
  return outcomesReport(store, agents)
    .filter((r) => r.proposed || r.decided)
    .map(({ medianMs, ...r }) => ({ ...r, medianSeconds: medianMs === null ? null : Math.round(medianMs / 1000) }));
}

interface Seen {
  agent: string;
  createdAt: number;
  status: string;
}

/**
 * Follow the review queue and count each change once: proposed when first
 * seen pending, then its outcome when it leaves pending. Returns a stop function.
 */
export function trackOutcomes(
  subscribe: (fn: (list: readonly import("../agents/types").StagedChange[]) => void) => () => void,
  opts: { now?: () => number; storage?: Storage | null } = {},
): () => void {
  const now = opts.now ?? (() => Date.now());
  const s = opts.storage === undefined ? storage() : opts.storage;
  const seen = new Map<string, Seen>();
  return subscribe((list) => {
    for (const c of list) {
      const agent = c.agentId ?? (c.tool?.startsWith("mcp:") ? c.tool : null);
      if (!agent) continue;
      const prev = seen.get(c.id);
      if (!prev) {
        seen.set(c.id, { agent, createdAt: c.createdAt, status: c.status });
        if (c.status === "pending") countOutcome(agent, "proposed", undefined, s);
        else continue; // already decided before we looked: not ours to count
      }
      const was = seen.get(c.id)!;
      if (was.status !== "pending" || c.status === "pending") continue;
      was.status = c.status;
      const ms = now() - was.createdAt;
      const outcome: Outcome = c.status === "applied" ? (c.edited ? "edited" : "accepted") : c.status === "conflict" ? "conflict" : c.withdrawn ? "cancelled" : "rejected";
      countOutcome(agent, outcome, ms, s);
    }
  });
}
