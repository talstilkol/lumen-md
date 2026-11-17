/**
 * The side of `lumen` that holds the vault (plan W13.K1): runs a command,
 * then proposes its change set — or, with `--yes` and only when the user
 * allowed it in the app's settings, applies it.
 *
 * `diskHost` is the vault on disk: what the terminal uses when the app is
 * closed, and what the socket server (./server.ts) serves. The app embeds
 * the same `handle` with its own port and queue (its review screen).
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { applyChangeSet, discardChangeSet, listChangeSets, proposeChangeSet, touched, type ApplyResult, type ChangeSet } from "./changeset.js";
import { runCommand, type Outcome, type Proposal, type Request, type VaultPort } from "./commands.js";
import { readSettings } from "./endpoint.js";
import { SPEC_BY_NAME, type Lang } from "./specs.js";
import { readNote } from "../vault/pending.js";
import { safeRel } from "../vault/paths.js";

export interface Host {
  port: VaultPort;
  propose(change: Proposal): Promise<ChangeSet>;
  apply(change: Proposal): Promise<ApplyResult>;
  changes(): Promise<ChangeSet[]>;
  discard(id: string): Promise<ChangeSet | null>;
  /** The user's `allowYes` setting, read by the host (never from the request). */
  allowYes(): Promise<boolean>;
}

export interface Response {
  v: 1;
  exit: number;
  data: unknown;
  lines: string[];
  notes: string[];
  /** A write command: the change waiting for review. */
  proposed?: { id: string; summary: string; files: string[] };
  /** `--yes`, allowed: what was written. */
  applied?: string[];
  /** Where the answer came from. */
  via: "app" | "disk";
}

const he = (lang: Lang, en: string, hebrew: string) => (lang === "he" ? hebrew : en);

export async function handle(host: Host, req: Request & { yes?: boolean }, opts: { now?: Date; lang?: Lang } = {}): Promise<Response> {
  const lang = opts.lang ?? "en";
  const via = host.port.mode;
  const base = (o: Outcome): Response => ({ v: 1, exit: o.exit, data: o.data, lines: o.lines, notes: o.notes ?? [], via });
  if (req.cmd === "changes") {
    const list = await host.changes();
    return base({ exit: 0, data: list.map((c) => ({ id: c.id, command: c.command, summary: c.summary, files: touched(c), createdAt: c.createdAt })), lines: list.map((c) => `${c.id}\t${c.createdAt}\t${c.summary}`) });
  }
  if (req.cmd === "discard") {
    const gone = await host.discard(req.args[0] ?? "");
    return gone ? base({ exit: 0, data: { id: gone.id }, lines: [he(lang, `Discarded ${gone.id}: ${gone.summary}`, `בוטל ${gone.id}: ${gone.summary}`)] }) : base({ exit: 3, data: { error: "missing" }, lines: [], notes: [he(lang, `No waiting change ${req.args[0]}.`, `אין שינוי ממתין ${req.args[0]}.`)] });
  }
  const out = await runCommand(host.port, req, opts);
  const res = base(out);
  if (!out.change || out.exit !== 0) return res;
  if (SPEC_BY_NAME.get(req.cmd)?.kind !== "write") return res;
  if (req.yes) {
    if (!(await host.allowYes())) {
      return { ...res, exit: 2, notes: [...res.notes, he(lang, "--yes is off. Turn it on in Lumen: Settings > Desktop > Command line. Nothing was written.", "‏--yes כבוי. אפשר להפעיל ב-Lumen: הגדרות > שולחן העבודה > שורת הפקודה. שום דבר לא נכתב.")] };
    }
    const r = await host.apply(out.change);
    if (r.status === "conflict") return { ...res, exit: 5, notes: [...res.notes, he(lang, `Not written: ${r.path}: ${r.reason}.`, `לא נכתב: ${r.path}: ${r.reason}.`)] };
    return { ...res, applied: r.paths, notes: [...res.notes, he(lang, `Written: ${r.paths.length} file(s).`, `נכתב: ${r.paths.length} קבצים.`)] };
  }
  const cs = await host.propose(out.change);
  return {
    ...res,
    proposed: { id: cs.id, summary: cs.summary, files: touched(cs) },
    notes: [...res.notes, he(lang, `Waiting for your review in Lumen (change ${cs.id}). Nothing is written until you approve it.`, `ממתין לאישור שלך ב-Lumen (שינוי ${cs.id}). שום דבר לא נכתב עד שתאשרו.`)],
  };
}

const TEXT_EXT = /\.(md|markdown|txt|canvas|base|excalidraw|json|csv)$/i;

/** The vault on disk as a port. */
export function diskPort(vault: string): VaultPort {
  // The walk follows no links (a link is neither a file nor a folder to
  // `Dirent`), so a listed path is a real file inside the vault and is read
  // directly; any other path goes through `readNote`'s link check (M1).
  const listed = new Set<string>();
  return {
    root: vault,
    mode: "disk",
    async files() {
      const out: string[] = [];
      const walk = async (rel: string): Promise<void> => {
        let entries: import("node:fs").Dirent[];
        try {
          entries = await fs.readdir(rel ? path.join(vault, ...rel.split("/")) : vault, { withFileTypes: true });
        } catch {
          return;
        }
        await Promise.all(
          entries.map(async (e) => {
            if (e.name.startsWith(".") || e.name === "node_modules") return;
            const p = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory()) await walk(p);
            else if (e.isFile()) out.push(p);
          }),
        );
      };
      await walk("");
      listed.clear();
      for (const p of out) listed.add(p);
      return out.sort();
    },
    async read(p) {
      if (!TEXT_EXT.test(p)) return null;
      try {
        if (listed.has(p)) return await fs.readFile(path.join(vault, ...p.split("/")), "utf8");
        return await readNote(vault, safeRel(p));
      } catch {
        return null;
      }
    },
    async mtime(p) {
      try {
        return (await fs.stat(path.join(vault, ...safeRel(p).split("/")))).mtimeMs;
      } catch {
        return null;
      }
    },
  };
}

export function diskHost(vault: string, configDir: string, client = "cli"): Host {
  return {
    port: diskPort(vault),
    propose: (ch) => proposeChangeSet(vault, { client, command: ch.command, summary: ch.summary, ops: ch.ops }),
    apply: (ch) => applyChangeSet(vault, { client, command: ch.command, ops: ch.ops }, "cli --yes"),
    changes: () => listChangeSets(vault),
    discard: (id) => discardChangeSet(vault, id),
    allowYes: async () => (await readSettings(configDir)).allowYes,
  };
}
