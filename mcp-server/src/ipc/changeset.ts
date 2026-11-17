/**
 * A change the `lumen` commands want to make (plan W13.K1), as one unit:
 * writes, moves and deletes that are approved — or refused — together.
 *
 * Writing is a proposal by default: the change set waits in
 * `<vault>/.lumen/cli/pending/<id>.json` for the user (the app's review
 * screen when the app is running, plan 5.11; else `lumen changes`), and is
 * applied only when every file still has the text it was computed from.
 * `--yes` applies at once, and only when the user turned that on in the
 * app's settings (`allowYes` in the per-user CLI settings, ./endpoint.ts).
 *
 * Applying checks every precondition first, on a simulated vault, so a
 * conflict anywhere writes nothing. A failure halfway (a full disk) puts
 * back what was already written.
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { lumenDir, writeFileAtomic } from "../vault/config.js";
import { appendLedger } from "../vault/ledger.js";
import { newProposalId, readNote } from "../vault/pending.js";
import { realVaultPath, safeRel } from "../vault/paths.js";

export type Op =
  | { op: "write"; path: string; before: string | null; after: string }
  | { op: "move"; from: string; to: string; before: string }
  | { op: "delete"; path: string; before: string };

export interface ChangeSet {
  v: 1;
  id: string;
  client: string;
  command: string;
  /** One line for the review list, in English (the app translates by `command`). */
  summary: string;
  createdAt: string;
  ops: Op[];
}

export const CLI_PENDING_REL = ".lumen/cli/pending";
const ID_RE = /^[a-z0-9]{6,40}$/;
/** At most this many change sets wait at once (the same bound as the MCP queue). */
export const MAX_CHANGESETS = 1000;

const dirOf = (vault: string) => path.join(lumenDir(vault), "cli", "pending");
function fileOf(vault: string, id: string): string {
  if (!ID_RE.test(id)) throw new Error(`Bad change id '${id}'.`);
  return path.join(dirOf(vault), `${id}.json`);
}

export function isChangeSet(v: unknown): v is ChangeSet {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  if (c.v !== 1 || typeof c.id !== "string" || !ID_RE.test(c.id) || typeof c.command !== "string" || !Array.isArray(c.ops) || !c.ops.length) return false;
  return c.ops.every((o: Record<string, unknown>) => {
    try {
      if (o.op === "write") return safeRel(o.path as string) === o.path && (o.before === null || typeof o.before === "string") && typeof o.after === "string";
      if (o.op === "move") return safeRel(o.from as string) === o.from && safeRel(o.to as string) === o.to && typeof o.before === "string";
      if (o.op === "delete") return safeRel(o.path as string) === o.path && typeof o.before === "string";
    } catch {
      return false;
    }
    return false;
  });
}

/** The paths a change set touches, in order, without repeats. */
export function touched(cs: Pick<ChangeSet, "ops">): string[] {
  const out = new Set<string>();
  for (const o of cs.ops) for (const p of o.op === "move" ? [o.from, o.to] : [o.path]) out.add(p);
  return [...out];
}

export async function listChangeSets(vault: string): Promise<ChangeSet[]> {
  let names: string[];
  try {
    names = await fs.readdir(dirOf(vault));
  } catch {
    return [];
  }
  const out: ChangeSet[] = [];
  for (const n of names) {
    if (!n.endsWith(".json")) continue;
    try {
      const v = JSON.parse(await fs.readFile(path.join(dirOf(vault), n), "utf8")) as unknown;
      if (isChangeSet(v) && n === `${v.id}.json`) out.push(v);
    } catch {
      /* half written */
    }
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export async function getChangeSet(vault: string, id: string): Promise<ChangeSet | null> {
  try {
    const v = JSON.parse(await fs.readFile(fileOf(vault, id), "utf8")) as unknown;
    return isChangeSet(v) ? v : null;
  } catch {
    return null;
  }
}

export async function proposeChangeSet(vault: string, cs: Omit<ChangeSet, "v" | "id" | "createdAt">, now = new Date()): Promise<ChangeSet> {
  if ((await listChangeSets(vault)).length >= MAX_CHANGESETS) throw new Error(`${MAX_CHANGESETS} changes are already waiting for review. Nothing was queued.`);
  const full: ChangeSet = { v: 1, id: newProposalId(now), createdAt: now.toISOString(), ...cs };
  if (!isChangeSet(full)) throw new Error("Not a valid change.");
  await writeFileAtomic(fileOf(vault, full.id), JSON.stringify(full, null, 2) + "\n");
  for (const p of touched(full)) await appendLedger(vault, { client: full.client, tool: full.command, scope: "propose", path: p, decision: "proposed", bytesOut: 0, id: full.id });
  return full;
}

export type ApplyResult = { status: "applied"; paths: string[] } | { status: "conflict"; path: string; reason: string };

/** Check every op against a simulated vault, then apply. Nothing is written on a conflict. */
export async function applyChangeSet(vault: string, cs: Pick<ChangeSet, "ops" | "client" | "command"> & { id?: string }, by = "cli"): Promise<ApplyResult> {
  const sim = new Map<string, string | null>();
  const cur = async (p: string) => (sim.has(p) ? sim.get(p)! : (sim.set(p, await readNote(vault, p)), sim.get(p)!));
  const original = new Map<string, string | null>();
  const remember = async (p: string) => {
    if (!original.has(p)) original.set(p, sim.has(p) ? sim.get(p)! : await readNote(vault, p));
  };
  for (const o of cs.ops) {
    if (o.op === "write") {
      await remember(o.path);
      const now = await cur(o.path);
      if (now !== o.before) return conflict(vault, cs, o.path, o.before === null ? "the note was created since" : now === null ? "the note was deleted since" : "the note changed since", by);
      sim.set(o.path, o.after);
    } else if (o.op === "move") {
      await remember(o.from);
      await remember(o.to);
      if ((await cur(o.from)) !== o.before) return conflict(vault, cs, o.from, "the note changed since", by);
      if ((await cur(o.to)) !== null) return conflict(vault, cs, o.to, "a note with the new name exists", by);
      sim.set(o.to, o.before);
      sim.set(o.from, null);
    } else {
      await remember(o.path);
      if ((await cur(o.path)) !== o.before) return conflict(vault, cs, o.path, "the note changed since", by);
      sim.set(o.path, null);
    }
  }
  const done: string[] = [];
  try {
    for (const o of cs.ops) {
      if (o.op === "write") await writeFileAtomic(await realVaultPath(vault, o.path), o.after);
      else if (o.op === "move") {
        const to = await realVaultPath(vault, o.to);
        await fs.mkdir(path.dirname(to), { recursive: true });
        await fs.rename(await realVaultPath(vault, o.from), to);
      } else await fs.rm(await realVaultPath(vault, o.path));
      done.push(o.op === "move" ? o.to : o.path);
    }
  } catch (e) {
    // Put back what was written: every touched path to its text before.
    for (const [p, text] of original) {
      try {
        if (text === null) await fs.rm(await realVaultPath(vault, p), { force: true });
        else await writeFileAtomic(await realVaultPath(vault, p), text);
      } catch {
        /* best effort; the error below says what failed */
      }
    }
    throw e;
  }
  if (cs.id) await fs.rm(fileOf(vault, cs.id), { force: true });
  for (const p of touched(cs)) await appendLedger(vault, { client: cs.client, tool: cs.command, path: p, decision: cs.id ? "approved" : "written", bytesOut: 0, ...(cs.id ? { id: cs.id } : {}), reason: by });
  return { status: "applied", paths: touched(cs) };
}

async function conflict(vault: string, cs: { id?: string; client: string; command: string }, p: string, reason: string, by: string): Promise<ApplyResult> {
  if (cs.id) {
    await fs.rm(fileOf(vault, cs.id), { force: true });
    await appendLedger(vault, { client: cs.client, tool: cs.command, path: p, decision: "conflict", bytesOut: 0, id: cs.id, reason: `${reason} (${by})` });
  }
  return { status: "conflict", path: p, reason };
}

export async function discardChangeSet(vault: string, id: string, by = "cli"): Promise<ChangeSet | null> {
  const cs = await getChangeSet(vault, id);
  if (!cs) return null;
  await fs.rm(fileOf(vault, id), { force: true });
  for (const p of touched(cs)) await appendLedger(vault, { client: cs.client, tool: cs.command, path: p, decision: "rejected", bytesOut: 0, id, reason: by });
  return cs;
}
