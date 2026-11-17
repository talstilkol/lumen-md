/**
 * The bodies of the automations commands (plan W5.24), loaded on first use
 * so the palette's startup list carries only their names (./automations.ts).
 */
import { t } from "../../i18n";
import "../../automations/automationStrings";
import { uiAlert, uiPrompt, uiSelect } from "../../ui/PromptDialog";
import { useToastStore } from "../../store/useToastStore";
import type { Action, Change, Rule, Trigger } from "../../automations/engine";
import { isRTL } from "../../i18n";
import { FSI, PDI } from "../../graph/labels";
import { explainError } from "../../lib/userError";

const load = () => import("../../automations/app");
const ask = async (key: string, defaultValue = "") => (await uiPrompt({ message: t(key), defaultValue }))?.trim() ?? null;
const fail = (e: unknown) => useToastStore.getState().push({ kind: "error", title: t("automations.failed", { error: explainError(e) }) });

/** "from → to" in the reading direction: ← in a right-to-left UI, where the line reads from the right. */
export const flowArrow = (dir: "ltr" | "rtl"): string => (dir === "rtl" ? "←" : "→");
/** A path or a name inside a line of the other direction keeps its own order (Projects/חתונה.md, not md.חתונה/Projects). */
const iso = (s: string): string => `${FSI}${s}${PDI}`;

/** The default name of a new rule: "<trigger> → <action>", its arrow in the UI's direction. */
export function defaultRuleName(trigger: string, action: string, dir: "ltr" | "rtl"): string {
  return `${trigger} ${flowArrow(dir)} ${action}`;
}

/** One dry-run line per change: the rule, then what it would do; paths isolated, the arrow in the UI's direction. */
export function dryRunLine(c: Change, dir: "ltr" | "rtl"): string {
  if (c.kind === "move") return `• ${iso(c.rule)}: ${iso(c.from)} ${flowArrow(dir)} ${iso(c.to)}`;
  if (c.kind === "agent") return `• ${iso(c.rule)}: ${t("automations.dryRun.agent", { agent: iso(c.agent), path: iso(c.path ?? "") })}`;
  return `• ${iso(c.rule)}: ${iso(c.path)}`;
}

/** The actions the picker offers (W10.E15: six, with "run an agent" and "add a task"). */
export const ACTIONS = ["move", "tag", "template", "appendDaily", "createTask", "runAgent"] as const;

async function buildAction(a: string): Promise<Action | null> {
  if (a === "runAgent") {
    const { listAgents } = await import("../../agents/registry");
    const agent = await uiSelect({ message: t("automations.ask.agent"), choices: listAgents().map((d) => ({ value: d.id, label: d.id })) });
    if (!agent) return null;
    const prompt = await ask("automations.ask.prompt");
    if (prompt === null) return null;
    return { kind: "runAgent", agent, ...(prompt ? { prompt } : {}) };
  }
  if (a === "createTask") {
    const text = await ask("automations.ask.task", "{{link}}");
    if (!text) return null;
    const file = await ask("automations.ask.tasksFile", "Tasks.md");
    if (file === null) return null;
    return { kind: "createTask", text, ...(file ? { file } : {}) };
  }
  const value = await ask(a === "move" ? "automations.ask.folder" : a === "tag" ? "automations.ask.tag" : a === "template" ? "automations.ask.template" : "automations.ask.text", a === "appendDaily" ? "- {{link}}" : "");
  if (value === null || (a !== "move" && !value)) return null;
  return a === "move" ? { kind: "move", folder: value } : a === "tag" ? { kind: "tag", tag: value } : a === "template" ? { kind: "template", template: value } : { kind: "appendDaily", text: value };
}

async function buildRule(): Promise<Rule | null> {
  const w = await uiSelect({ message: t("automations.pick.trigger"), choices: ["created", "tagAdded", "propertyChanged", "rowChanged", "typeCreated", "typeFieldChanged", "daily"].map((v) => ({ value: v, label: t(`automations.trigger.${v}`) })) });
  if (!w) return null;
  let when: Trigger;
  if (w === "created") when = { kind: "created", folder: (await ask("automations.ask.folder")) || undefined };
  else if (w === "tagAdded") {
    const tag = await ask("automations.ask.tag");
    if (!tag) return null;
    when = { kind: "tagAdded", tag };
  } else if (w === "propertyChanged") {
    const key = await ask("automations.ask.key");
    if (!key) return null;
    when = { kind: "propertyChanged", key, value: (await ask("automations.ask.value")) || undefined };
  } else if (w === "rowChanged") {
    // W6.46: when a row of a base view changes.
    const base = await ask("automations.ask.base");
    if (!base) return null;
    when = { kind: "rowChanged", base: /\.base$/i.test(base) ? base : `${base}.base`, view: (await ask("automations.ask.view")) || undefined, property: (await ask("automations.ask.rowProperty")) || undefined };
  } else if (w === "typeCreated" || w === "typeFieldChanged") {
    // W12.U2: an object of a type (W12.T1) is created, or one of its fields changes.
    const type = await ask("automations.ask.type");
    if (!type) return null;
    when =
      w === "typeCreated"
        ? { kind: "typeCreated", type }
        : { kind: "typeFieldChanged", type, field: (await ask("automations.ask.typeField")) || undefined, value: (await ask("automations.ask.value")) || undefined };
  } else when = { kind: "daily" };
  const a = await uiSelect({ message: t("automations.pick.action"), choices: ACTIONS.map((v) => ({ value: v, label: t(`automations.action.${v}`) })) });
  if (!a) return null;
  const action = await buildAction(a);
  if (!action) return null;
  const name = (await ask("automations.ask.name", defaultRuleName(t(`automations.trigger.${w}`), t(`automations.action.${a}`), isRTL() ? "rtl" : "ltr"))) || w;
  // W12.U2: not on Shabbat or a yom tov.
  const rest = await uiSelect({ message: t("automations.pick.restDays"), choices: ["any", "notOnRestDays"].map((v) => ({ value: v, label: t(`automations.restDays.${v}`) })) });
  if (!rest) return null;
  return { id: `r${Date.now().toString(36)}`, name, enabled: true, when, then: [action], ...(rest === "notOnRestDays" ? { notOnRestDays: true } : {}) };
}

export async function newAutomation(): Promise<void> {
  try {
    const rule = await buildRule();
    if (!rule) return;
    const m = await load();
    await m.saveRules([...(await m.loadRules()), rule]);
    await m.startAutomationsIfConfigured();
    useToastStore.getState().push({ kind: "success", title: t("automations.created", { name: rule.name }) });
  } catch (e) {
    fail(e);
  }
}

/** A dry run on the open note: what the rules would change, nothing written. */
export async function dryRunAutomations(doc: { workspaceName?: string | null; content: string }): Promise<void> {
  if (!doc.workspaceName) return;
  try {
    const p = await (await load()).dryRun({ kind: "created", path: doc.workspaceName, text: doc.content });
    if (!p.changes.length && !p.postponed.length) {
      await uiAlert({ message: t("automations.dryRun.none") });
      return;
    }
    const dir = isRTL() ? "rtl" : "ltr";
    const lines = p.changes.map((c) => dryRunLine(c, dir));
    // W12.U2: rules that wait for the end of Shabbat or a yom tov.
    const waits = p.postponed.map((x) => t(x.why.reason === "shabbat" ? "automations.dryRun.postponedShabbat" : "automations.dryRun.postponedYomTov", { rule: x.rule, until: x.until }));
    await uiAlert({ message: [t("automations.dryRun.title"), ...lines, ...waits, ...(p.stopped.length ? [t("automations.dryRun.stopped", { count: p.stopped.length })] : [])].join("\n") });
  } catch (e) {
    fail(e);
  }
}

export async function undoLastAutomation(): Promise<void> {
  try {
    const r = await (await load()).undoLast();
    if (r.ok) useToastStore.getState().push({ kind: "success", title: t("automations.undone", { event: r.entry.event }) });
    else await uiAlert({ message: r.reason === "none" ? t("automations.undo.none") : t("automations.undo.changed", { path: r.path }) });
  } catch (e) {
    fail(e);
  }
}
