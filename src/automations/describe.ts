/**
 * How the automations manager (plan W5.24) says what a rule does and what a
 * run would change: one sentence per rule ("When a tag #x is added → add a
 * task"), and for each planned change a short line diff, so a dry run shows
 * the very lines that would be written before anything is. Pure; the strings
 * come from the caller's `t`.
 */
import { diffLines, type DiffOp } from "../lib/lineDiff";
import type { Action, Change, Rule, Trigger, VaultEvent } from "./engine";

type T = (key: string, vars?: Record<string, string | number>) => string;

/** The trigger in words, with its parameters (folder, tag, property…). */
export function describeTrigger(w: Trigger, t: T): string {
  const base = t(`automations.trigger.${w.kind}`);
  const bits: string[] = [];
  if (w.kind === "created" && w.folder) bits.push(w.folder);
  if (w.kind === "tagAdded") bits.push(`#${w.tag.replace(/^#/, "")}`);
  if (w.kind === "propertyChanged") bits.push(w.value === undefined ? w.key : `${w.key} = ${w.value}`);
  if (w.kind === "rowChanged") bits.push([w.base, w.view, w.property].filter(Boolean).join(" · "));
  if (w.kind === "typeCreated") bits.push(w.type);
  if (w.kind === "typeFieldChanged") bits.push([w.type, w.field, w.value].filter(Boolean).join(" · "));
  return bits.length ? `${base}: ${bits.join(" ")}` : base;
}

/** One action in words, with its target. */
export function describeAction(a: Action, t: T): string {
  const base = t(`automations.action.${a.kind}`);
  const arg = a.kind === "move" ? a.folder || "/" : a.kind === "tag" ? `#${a.tag.replace(/^#/, "")}` : a.kind === "template" ? a.template : a.kind === "appendDaily" ? a.text : a.kind === "createTask" ? a.text : a.agent;
  return `${base}: ${arg}`;
}

/** The rule as one sentence: "When … → then …; …". */
export function describeRule(r: Rule, t: T): { when: string; then: string[] } {
  return { when: describeTrigger(r.when, t), then: r.then.map((a) => describeAction(a, t)) };
}

const FM_BLOCK = /^﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * The event a dry run of `rule` on the open note simulates: a daily rule runs
 * on `today`; a property or field rule sees the note's properties appear (as
 * if they had just been set); every other rule sees the note as just created.
 */
export function dryRunEventFor(rule: Rule, doc: { path: string | null; text: string }, today: string): VaultEvent | null {
  if (rule.when.kind === "daily") return { kind: "daily", date: today };
  if (!doc.path) return null;
  if (rule.when.kind === "propertyChanged" || rule.when.kind === "typeFieldChanged") return { kind: "changed", path: doc.path, before: doc.text.replace(FM_BLOCK, ""), after: doc.text };
  return { kind: "created", path: doc.path, text: doc.text };
}

export interface PreviewLine {
  op: DiffOp["op"] | "gap";
  line: string;
}

export interface ChangePreview {
  kind: "write" | "move" | "agent";
  rule: string;
  /** The note it touches (for a move: where it goes). */
  path: string;
  from?: string;
  /** A new note (nothing there before). */
  created?: boolean;
  /** For a write: the changed lines with `context` lines around each, gaps elided. */
  lines: PreviewLine[];
  added: number;
  removed: number;
}

/** A write's changed lines, with `context` unchanged lines around them; long unchanged runs become one gap. */
export function previewLines(before: string | null, after: string, context = 2, maxLines = 40): { lines: PreviewLine[]; added: number; removed: number } {
  const a = before === null || before === "" ? [] : before.replace(/\n$/, "").split("\n");
  const b = after.replace(/\n$/, "").split("\n");
  const ops = diffLines(a, b) ?? [...a.map((line) => ({ op: "del" as const, line })), ...b.map((line) => ({ op: "add" as const, line }))];
  const keep = new Array<boolean>(ops.length).fill(false);
  ops.forEach((o, i) => {
    if (o.op === "eq") return;
    for (let j = Math.max(0, i - context); j <= Math.min(ops.length - 1, i + context); j++) keep[j] = true;
  });
  const lines: PreviewLine[] = [];
  let added = 0;
  let removed = 0;
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i];
    if (o.op === "add") added++;
    if (o.op === "del") removed++;
    if (keep[i]) lines.push({ op: o.op, line: o.line });
    else if (lines.length && lines[lines.length - 1].op !== "gap") lines.push({ op: "gap", line: "" });
  }
  while (lines.length && lines[lines.length - 1].op === "gap") lines.pop();
  if (lines.length > maxLines) lines.splice(maxLines, lines.length - maxLines, { op: "gap", line: "" });
  return { lines, added, removed };
}

/** Each planned change as the dry run shows it. */
export function previewChanges(changes: readonly Change[]): ChangePreview[] {
  return changes.map((c) => {
    if (c.kind === "write") {
      const d = previewLines(c.before, c.after);
      return { kind: "write", rule: c.rule, path: c.path, created: c.before === null, ...d };
    }
    if (c.kind === "move") return { kind: "move", rule: c.rule, path: c.to, from: c.from, lines: [], added: 0, removed: 0 };
    return { kind: "agent", rule: c.rule, path: c.path ?? "", lines: [], added: 0, removed: 0 };
  });
}
