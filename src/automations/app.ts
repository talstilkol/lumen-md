/**
 * The app side of automations (plan W5.24): rules in `.lumen/automations.json`,
 * every run in `.lumen/automations-log.json` (newest first, 50 kept), and a
 * listener on vault changes that runs the rules locally. Loaded lazily; it
 * does nothing until the rules file exists.
 */
import "./automationStrings";
import { dailyPath as dailyPathOf, dayOf, parseIso } from "../daily/dailyNote";
import { cityById } from "../daily/shabbatTimes";
import { useAppStore } from "../store/useStore";
import { onWorkspaceChanged } from "../storage/workspaceEvents";
import { updateLinksAfterMove } from "../storage/linkRewrite";
import { deleteWorkspaceFile, isOPFSAvailable, listWorkspace, readWorkspaceFile, renameWorkspaceFile, workspaceHasFile, writeWorkspaceFile } from "../storage/workspace";
import { applyPlan, parseRules, plan, undoRun, type Change, type Fs, type Plan, type Rule, type RunLogEntry, type VaultEvent } from "./engine";
import { t } from "../i18n";

export const RULES_PATH = ".lumen/automations.json";
export const LOG_PATH = ".lumen/automations-log.json";
const STATE_PATH = ".lumen/automations-state.json";

const readOrNull = async (p: string) => ((await workspaceHasFile(p).catch(() => false)) ? await readWorkspaceFile(p).catch(() => null) : null);
const isoToday = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const fs: Fs = {
  read: readOrNull,
  write: (p, t) => writeWorkspaceFile(p, t),
  // Links to a moved note follow it (and follow it back on undo).
  move: async (a, b) => {
    await renameWorkspaceFile(a, b);
    await updateLinksAfterMove(a, b).catch(() => []);
  },
  remove: (p) => deleteWorkspaceFile(p),
  runAgent: async (c) => void (await runAgentForRule(c)),
};

/**
 * "Run an agent" (W10.E15): the agent runs on the note through the runtime,
 * whose write tools stage their changes; an answer that changed nothing is
 * staged as an addition to the note. Either way the change waits in the
 * review panel (`agents/staging.ts`) and is written only when approved.
 */
export async function runAgentForRule(c: Extract<Change, { kind: "agent" }>): Promise<{ staged: string[] }> {
  const [{ getAgent }, { runAgent }, { stageChange }] = await Promise.all([import("../agents/registry"), import("../agents/runtime"), import("../agents/staging")]);
  const def = getAgent(c.agent);
  if (!def) throw new Error(t("automations.agent.unknown", { agent: c.agent }));
  const text = c.path ? await readOrNull(c.path) : null;
  const run = await runAgent(def, { text: text ?? "", path: c.path, extra: c.prompt ? { instruction: c.prompt } : {} }, { path: c.path, document: text ?? undefined, grants: ["write"] });
  const staged = [...(run.staged ?? [])];
  if (run.status === "ok" && !staged.length && c.path && text !== null && typeof run.output === "string" && run.output.trim()) {
    const summary = t("automations.agent.summary", { agent: def.id, rule: c.rule });
    staged.push(stageChange({ kind: "file", path: c.path, before: text, after: `${text.replace(/\s*$/, "")}\n\n${run.output.trim()}\n`, summary }, { tool: "automation", runId: run.id, agentId: def.id }).id);
  }
  return { staged };
}

export async function loadRules(): Promise<Rule[]> {
  return parseRules((await readOrNull(RULES_PATH)) ?? "[]");
}

export async function saveRules(rules: Rule[]): Promise<void> {
  await writeWorkspaceFile(RULES_PATH, JSON.stringify({ rules }, null, 2) + "\n");
}

export async function readLog(): Promise<RunLogEntry[]> {
  try {
    return JSON.parse((await readOrNull(LOG_PATH)) ?? "[]") as RunLogEntry[];
  } catch {
    return [];
  }
}

const dailyPath = (date: string) => dailyPathOf(parseIso(date) ?? dayOf(new Date()), useAppStore.getState().dailyNotes);

/** Notes as last seen, to tell what an edit changed (a tag added, a property changed). */
const seen = new Map<string, string>();
/** Text this module just wrote: the change event it causes is ours, not the user's. */
const ours = new Map<string, string>();

/** A rule's event that waited over Shabbat or a yom tov (W12.U2), replayed on `until`. */
export interface Postponed {
  rule: string;
  until: string;
  event: VaultEvent;
}

interface State {
  lastDaily?: Record<string, string>;
  postponed?: Postponed[];
}

async function readState(): Promise<State> {
  try {
    return JSON.parse((await readOrNull(STATE_PATH)) ?? "{}") as State;
  } catch {
    return {};
  }
}

const writeState = (st: State) => writeWorkspaceFile(STATE_PATH, JSON.stringify(st) + "\n");

/** Holidays as in Israel unless the daily-notes setting says diaspora. */
const israel = () => (useAppStore.getState().dailyNotes as { israel?: boolean } | undefined)?.israel ?? true;
/** Z7-M6: the moment and place of a run, for Shabbat and yom tov from candle lighting on the eve. */
const restContext = () => {
  const d = useAppStore.getState().dailyNotes as { city?: string; candleMinutes?: number } | undefined;
  return { now: Date.now(), city: cityById(d?.city), ...(d?.candleMinutes !== undefined ? { candles: d.candleMinutes } : {}) };
};

async function contextFor() {
  const lastDaily: Record<string, string> = (await readState()).lastDaily ?? {};
  const files = new Map<string, string | null>();
  for (const f of await listWorkspace()) files.set(f.path, null);
  const vault = {
    read: (p: string) => (files.get(p) ?? seen.get(p) ?? null),
    exists: (p: string) => files.has(p) || seen.has(p),
  };
  return { vault, files, lastDaily };
}

/** The plan for `event` — the dry run. Nothing is written. */
export async function dryRun(event: VaultEvent, only?: Rule[]): Promise<Plan> {
  const rules = await loadRules();
  const { vault, files, lastDaily } = await contextFor();
  // Templates and the daily note are read on demand.
  const read = (p: string) => vault.read(p);
  const pending = new Set<string>();
  const view = { read: (p: string) => read(p) ?? (pending.add(p), null), exists: vault.exists };
  let p = plan(only ?? rules, event, { vault: view, dailyPath, today: isoToday(), lastDaily, israel: israel(), ...restContext() });
  if (pending.size) {
    for (const path of pending) files.set(path, await readOrNull(path));
    p = plan(only ?? rules, event, { vault: { read: (x) => files.get(x) ?? seen.get(x) ?? null, exists: vault.exists }, dailyPath, today: isoToday(), lastDaily, israel: israel(), ...restContext() });
  }
  return p;
}

/** Run the rules for `event` and log the run. Returns null when no rule fired. */
export async function runFor(event: VaultEvent, only?: Rule[]): Promise<RunLogEntry | null> {
  const p = await dryRun(event, only);
  // W12.U2: an event a rule may not handle on Shabbat or a yom tov waits for the next weekday.
  const waiting = p.postponed.filter((x) => x.event);
  if (waiting.length) {
    const st = await readState();
    const list = st.postponed ?? [];
    for (const w of waiting) if (!list.some((x) => x.rule === w.rule && JSON.stringify(x.event) === JSON.stringify(w.event))) list.push({ rule: w.rule, until: w.until, event: w.event! });
    await writeState({ ...st, postponed: list });
  }
  if (!p.changes.length && !Object.keys(p.dailyRan).length) return null;
  for (const c of p.changes) if (c.kind === "write") ours.set(c.path, c.after);
  const entry = await applyPlan(p, fs, `${Date.now().toString(36)}`, event.kind === "daily" ? `daily ${event.date}` : `${event.kind} ${event.path}`, new Date());
  for (const c of p.changes) if (c.kind === "write") seen.set(c.path, c.after);
  const log = [entry, ...(await readLog())].slice(0, 50);
  await writeWorkspaceFile(LOG_PATH, JSON.stringify(log, null, 1) + "\n");
  if (Object.keys(p.dailyRan).length) {
    const st = await readState();
    await writeState({ ...st, lastDaily: { ...st.lastDaily, ...p.dailyRan } });
  }
  return entry;
}

/** W12.U2: run the events that waited over Shabbat or a yom tov, once their day has come. */
export async function replayPostponed(): Promise<number> {
  const st = await readState();
  const today = isoToday();
  const due = (st.postponed ?? []).filter((x) => x.until <= today);
  if (!due.length) return 0;
  await writeState({ ...st, postponed: (st.postponed ?? []).filter((x) => x.until > today) });
  const rules = await loadRules();
  let ran = 0;
  for (const x of due) {
    const rule = rules.find((r) => r.id === x.rule);
    if (rule && (await runFor(x.event, [rule]).catch(() => null))) ran++;
  }
  return ran;
}

/** Undo the newest run that is not undone yet. */
export async function undoLast(): Promise<{ ok: true; entry: RunLogEntry } | { ok: false; reason: "none" } | { ok: false; reason: "changed"; path: string }> {
  const log = await readLog();
  const entry = log.find((e) => !e.undone);
  if (!entry) return { ok: false, reason: "none" };
  for (const c of entry.changes) if (c.kind === "write") ours.set(c.path, c.before ?? "");
  const r = await undoRun(entry, fs);
  if (!r.ok) return { ok: false, reason: "changed", path: r.path };
  entry.undone = true;
  await writeWorkspaceFile(LOG_PATH, JSON.stringify(log, null, 1) + "\n");
  return { ok: true, entry };
}

let started = false;

/** Listen for vault changes and run the rules (once; only when a rules file exists). */
export async function startAutomationsIfConfigured(): Promise<boolean> {
  if (started || !isOPFSAvailable() || !(await workspaceHasFile(RULES_PATH).catch(() => false))) return false;
  started = true;
  for (const f of await listWorkspace()) if (f.path.endsWith(".md")) seen.set(f.path, await readWorkspaceFile(f.path).catch(() => ""));
  let queue = Promise.resolve();
  onWorkspaceChanged(
    (change) => {
      queue = queue.then(async () => {
        const paths = change.paths ?? (await listWorkspace()).map((f) => f.path).filter((p) => p.endsWith(".md") && !seen.has(p));
        for (const path of paths) {
          if (!path.endsWith(".md") || path.startsWith(".lumen/")) continue;
          const after = await readOrNull(path);
          if (after === null) {
            seen.delete(path);
            continue;
          }
          if (ours.get(path) === after) {
            ours.delete(path);
            seen.set(path, after);
            continue;
          }
          const before = seen.get(path);
          seen.set(path, after);
          if (before === after) continue;
          await runFor(before === undefined ? { kind: "created", path, text: after } : { kind: "changed", path, before, after }).catch(() => null);
        }
      });
    },
    { debounceMs: 800 },
  );
  const daily = () =>
    void (queue = queue.then(() =>
      replayPostponed()
        .then(() => runFor({ kind: "daily", date: isoToday() }))
        .then(() => undefined, () => undefined),
    ));
  daily();
  window.setInterval(daily, 30 * 60 * 1000);
  return true;
}
