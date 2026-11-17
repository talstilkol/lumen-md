/**
 * The 40 commands (./specs.ts), run against a vault port (plan W13.K1).
 *
 * The same code runs in the app (behind the socket, over the app's live
 * workspace) and in the terminal against the disk when the app is closed
 * (read commands). A command never writes: it returns its data, the lines
 * to print, and — for the write commands — the change set to propose.
 */
import { lineDiff } from "../vault/pending.js";
import { parseFrontmatter } from "../frontmatter.js";
import { safeRel, notePath } from "../vault/paths.js";
import { tokenize, wordTerms } from "../vault/search.js";
import {
  appendText,
  headingsOf,
  isNote,
  linksOf,
  prependText,
  propertiesOf,
  removeTag,
  renameProperty,
  renameTag,
  Resolver,
  setProperty,
  setTask,
  stemOf,
  tagsOf,
  tasksOf,
  wordCount,
  type LinkRef,
} from "./analyze.js";
import type { Op } from "./changeset.js";
import { linksEngine, plainKey, type LinksEngine } from "./links.js";
import { helpText, REFUSED, SPEC_BY_NAME, type Lang } from "./specs.js";

export const PROTOCOL_VERSION = 1;
export const CLI_VERSION = "0.4.0";

/** What a command needs from the vault. Paths are vault-relative with `/`. */
export interface VaultPort {
  /** Every file, no dot folders, sorted. */
  files(): Promise<string[]>;
  read(path: string): Promise<string | null>;
  /** Last change time in ms (for `recent`); optional. */
  mtime?(path: string): Promise<number | null>;
  /** Where the vault is, for `lumen vault`. */
  root: string;
  /** "app": the running app's workspace; "disk": the files. */
  mode: "app" | "disk";
}

export interface Request {
  cmd: string;
  args: string[];
  flags: Record<string, string>;
}

export interface Proposal {
  command: string;
  summary: string;
  ops: Op[];
}

export interface Outcome {
  exit: number;
  data: unknown;
  lines: string[];
  /** Messages for stderr. */
  notes?: string[];
  change?: Proposal;
}

export class UsageError extends Error {}
export class NotFoundError extends Error {}

const ok = (data: unknown, lines: string[], extra: Partial<Outcome> = {}): Outcome => ({ exit: 0, data, lines, ...extra });

interface Ctx {
  port: VaultPort;
  key: (s: string) => string;
  links: () => Promise<LinksEngine>;
  now: Date;
  lang: Lang;
  files: string[];
  text(p: string): Promise<string | null>;
  notes(): Promise<Array<{ path: string; text: string }>>;
  resolver(): Resolver;
}

async function context(port: VaultPort, now: Date, lang: Lang): Promise<Ctx> {
  let engine: LinksEngine | null = null;
  try {
    engine = await linksEngine();
  } catch {
    /* reads use the plain key; moves will say the engine is missing */
  }
  const files = await port.files();
  const cache = new Map<string, string | null>();
  const text = async (p: string) => {
    if (!cache.has(p)) cache.set(p, await port.read(p));
    return cache.get(p)!;
  };
  let all: Array<{ path: string; text: string }> | null = null;
  const key = engine ? (s: string) => engine!.noteKey(s) : plainKey;
  let resolver: Resolver | null = null;
  return {
    resolver: () => (resolver ??= new Resolver(files, key)),
    port,
    key,
    links: linksEngine,
    now,
    lang,
    files,
    text,
    notes: async () => {
      if (!all) {
        all = [];
        // Bounded parallel reads: 10k notes in a few hundred ms on disk.
        const paths = files.filter(isNote);
        for (let i = 0; i < paths.length; i += 64) {
          const batch = await Promise.all(paths.slice(i, i + 64).map(async (p) => ({ path: p, text: (await text(p)) ?? "" })));
          all.push(...batch);
        }
      }
      return all;
    },
  };
}

/** A note named by path (with or without `.md`) or by name. Ambiguous names are an error. */
async function noteArg(c: Ctx, raw: string | undefined): Promise<string> {
  if (!raw) throw new UsageError("A note is required.");
  const name = raw.trim();
  try {
    const p = notePath(name);
    if (c.files.includes(p)) return p;
  } catch {
    /* not a path: look it up by name */
  }
  const want = c.key(name.replace(/\.(md|markdown)$/i, ""));
  const hits = c.files.filter((p) => isNote(p) && (c.key(p.replace(/\.(md|markdown)$/i, "")) === want || c.key(stemOf(p)) === want));
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) throw new UsageError(`'${name}' names ${hits.length} notes: ${hits.join(", ")}. Give the path.`);
  throw new NotFoundError(`No note matches '${name}'.`);
}

async function mustRead(c: Ctx, p: string): Promise<string> {
  const t = await c.text(p);
  if (t === null) throw new NotFoundError(`No note at ${p}.`);
  return t;
}

function writeOp(path: string, before: string | null, after: string): Op {
  return { op: "write", path, before, after };
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const dayStamp = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** Where every link of every note goes. */
async function linkMap(c: Ctx): Promise<Array<{ from: string; ref: LinkRef; to: string | null }>> {
  const out: Array<{ from: string; ref: LinkRef; to: string | null }> = [];
  const r = c.resolver();
  for (const n of await c.notes()) for (const ref of linksOf(n.text)) out.push({ from: n.path, ref, to: r.resolve(ref, n.path) });
  return out;
}

/** The ops of moving `from` to `to`: the move, then every note whose links change. */
async function moveOps(c: Ctx, from: string, to: string): Promise<Op[]> {
  if (from === to) throw new UsageError("The note is already there.");
  if (c.files.includes(to)) throw new UsageError(`${to} exists.`);
  const engine = await c.links();
  const before = await mustRead(c, from);
  const ops: Op[] = [{ op: "move", from, to, before }];
  // 10k notes: only a note whose text names the moved one can link to it,
  // and a short link can only resolve among the notes of the same name —
  // so the rewrite sees those few instead of the whole vault (same result).
  const oldKey = c.key(stemOf(from));
  const base = (p: string) => p.split("/").pop() ?? p;
  const rivals = c.files.filter((p) => c.key(p) === oldKey || c.key(base(p)) === oldKey);
  const decoded = (t: string) => (t.includes("%") ? t.replace(/(?:%[0-9A-Fa-f]{2})+/g, (m) => { try { return decodeURIComponent(m); } catch { return m; } }) : t);
  for (const n of await c.notes()) {
    const self = n.path === from;
    if (!self && !c.key(decoded(n.text)).includes(oldKey)) continue;
    const at = self ? to : n.path;
    const next = engine.rewriteLinks(n.text, at, from, to, { notePrevPath: n.path, vault: rivals });
    if (next !== n.text) ops.push(writeOp(at, n.text, next));
  }
  return ops;
}

function diffLines(ops: Op[], max = 40): string[] {
  const out: string[] = [];
  for (const o of ops) {
    if (o.op === "move") out.push(`→ ${o.from} ⇒ ${o.to}`);
    else if (o.op === "delete") out.push(`✕ ${o.path}`);
    else {
      out.push(`~ ${o.path}`);
      out.push(...lineDiff(o.before, o.after, 12).map((l) => `  ${l}`));
    }
    if (out.length > max) {
      out.push(`  … (${ops.length} files)`);
      break;
    }
  }
  return out;
}

function proposal(command: string, summary: string, ops: Op[], data: unknown = {}): Outcome {
  if (!ops.length) return ok({ ...(data as object), changed: 0 }, ["Nothing to change."]);
  return { exit: 0, data, lines: diffLines(ops), change: { command, summary, ops } };
}

/** Run one command. Errors become an outcome with an exit code (2 usage, 3 not found, 1 other). */
export async function runCommand(port: VaultPort, req: Request, opts: { now?: Date; lang?: Lang } = {}): Promise<Outcome> {
  const lang = opts.lang ?? "en";
  if (REFUSED[req.cmd]) return { exit: 2, data: { error: "refused", command: req.cmd }, lines: [], notes: [REFUSED[req.cmd][lang]] };
  const spec = SPEC_BY_NAME.get(req.cmd);
  if (!spec) return { exit: 2, data: { error: "unknown", command: req.cmd }, lines: [], notes: [lang === "he" ? `אין פקודה '${req.cmd}'. ‏lumen help לרשימה.` : `No command '${req.cmd}'. lumen help lists them.`] };
  if (req.args.length < (spec.min ?? 0)) return { exit: 2, data: { error: "usage", command: req.cmd }, lines: [], notes: [`usage: lumen ${spec.name} ${spec.args}`] };
  try {
    return await dispatch(await context(port, opts.now ?? new Date(), lang), req);
  } catch (e) {
    const exit = e instanceof UsageError ? 2 : e instanceof NotFoundError ? 3 : 1;
    return { exit, data: { error: (e as Error).message }, lines: [], notes: [(e as Error).message] };
  }
}

async function dispatch(c: Ctx, { cmd, args, flags }: Request): Promise<Outcome> {
  const a0 = args[0];
  const rest = (i: number) => args.slice(i).join(" ").trim();
  switch (cmd) {
    // ── files ──
    case "files": {
      const folder = flags.folder ? safeRel(flags.folder) + "/" : "";
      const ext = flags.ext ? `.${flags.ext.replace(/^\./, "").toLowerCase()}` : "";
      const list = c.files.filter((p) => (!folder || p.startsWith(folder)) && (!ext || p.toLowerCase().endsWith(ext)));
      return ok(list, list);
    }
    case "folders": {
      const set = new Set<string>();
      for (const p of c.files) {
        const parts = p.split("/");
        for (let i = 1; i < parts.length; i++) set.add(parts.slice(0, i).join("/"));
      }
      const list = [...set].sort();
      return ok(list, list);
    }
    case "read": {
      const p = await noteArg(c, rest(0));
      const t = await mustRead(c, p);
      return ok({ path: p, text: t }, [t.replace(/\n$/, "")]);
    }
    case "create": {
      const p = notePath(a0);
      if (c.files.includes(p) || (await c.text(p)) !== null) throw new UsageError(`${p} exists.`);
      const body = rest(1);
      return proposal("create", `Create ${p}`, [writeOp(p, null, body ? (body.endsWith("\n") ? body : body + "\n") : "")], { path: p });
    }
    case "insert": {
      const p = await noteArg(c, a0);
      const before = await mustRead(c, p);
      const add = rest(1);
      const at = flags.at || "end";
      if (at !== "start" && at !== "end") throw new UsageError("--at is start or end.");
      return proposal("insert", `Add text to ${p}`, [writeOp(p, before, at === "start" ? prependText(before, add) : appendText(before, add))], { path: p });
    }
    case "move":
    case "rename": {
      const from = await noteArg(c, a0);
      const target = rest(1);
      let to: string;
      if (cmd === "rename") {
        if (target.includes("/")) throw new UsageError("A new name, without a folder (use lumen move).");
        const dir = from.includes("/") ? from.slice(0, from.lastIndexOf("/") + 1) : "";
        to = notePath(dir + target);
      } else {
        const isFolder = target.endsWith("/") || c.files.some((p) => p.startsWith(target.replace(/\/+$/, "") + "/"));
        to = isFolder ? notePath(`${target.replace(/\/+$/, "")}/${from.split("/").pop()}`) : notePath(target);
      }
      const ops = await moveOps(c, from, to);
      const linksChanged = ops.filter((o) => o.op === "write" && o.path !== to).length;
      return proposal(cmd, `Move ${from} to ${to} and update links in ${linksChanged} note(s)`, ops, { from, to, linksUpdated: linksChanged });
    }
    case "delete": {
      const p = await noteArg(c, rest(0));
      const before = await mustRead(c, p);
      const breaking = (await linkMap(c)).filter((l) => l.to === p && l.from !== p).map((l) => ({ from: l.from, line: l.ref.line }));
      const out = proposal("delete", `Delete ${p}`, [{ op: "delete", path: p, before }], { path: p, breaksLinks: breaking });
      if (breaking.length) out.notes = [`${breaking.length} link(s) will point nowhere: ${[...new Set(breaking.map((b) => b.from))].join(", ")}`];
      return out;
    }
    // ── links ──
    case "backlinks": {
      const p = await noteArg(c, rest(0));
      const hits = (await linkMap(c)).filter((l) => l.to === p && l.from !== p).map((l) => ({ path: l.from, line: l.ref.line, embed: l.ref.embed }));
      return { ...ok(hits, hits.map((h) => `${h.path}:${h.line}`)), exit: hits.length ? 0 : 3 };
    }
    case "links": {
      const p = await noteArg(c, rest(0));
      const t = await mustRead(c, p);
      const list = linksOf(t).map((ref) => ({ target: ref.target, line: ref.line, embed: ref.embed, kind: ref.kind, path: c.resolver().resolve(ref, p) }));
      return ok(list, list.map((l) => `${l.line}\t${l.target}\t${l.path ?? "(unresolved)"}`));
    }
    case "orphans": {
      const linked = new Set((await linkMap(c)).filter((l) => l.to && l.to !== l.from).map((l) => l.to));
      const list = c.files.filter((p) => isNote(p) && !linked.has(p));
      return ok(list, list);
    }
    case "unresolved": {
      const by = new Map<string, Array<{ path: string; line: number }>>();
      for (const l of await linkMap(c)) {
        if (l.to) continue;
        const k = l.ref.target;
        if (!by.has(k)) by.set(k, []);
        by.get(k)!.push({ path: l.from, line: l.ref.line });
      }
      const list = [...by].map(([target, from]) => ({ target, from })).sort((x, y) => y.from.length - x.from.length || x.target.localeCompare(y.target));
      return ok(list, list.map((u) => `${u.target}\t${u.from.map((f) => `${f.path}:${f.line}`).join(", ")}`));
    }
    case "deadends": {
      const out = new Set((await linkMap(c)).filter((l) => l.to && l.to !== l.from).map((l) => l.from));
      const list = c.files.filter((p) => isNote(p) && !out.has(p));
      return ok(list, list);
    }
    case "embeds": {
      const scope = args.length ? [await noteArg(c, rest(0))] : null;
      const list = (await linkMap(c)).filter((l) => l.ref.embed && (!scope || scope.includes(l.from))).map((l) => ({ from: l.from, line: l.ref.line, target: l.ref.target, path: l.to }));
      return ok(list, list.map((e) => `${e.from}:${e.line}\t${e.target}\t${e.path ?? "(unresolved)"}`));
    }
    // ── tags ──
    case "tags": {
      const counts = new Map<string, { tag: string; count: number }>();
      for (const n of await c.notes())
        for (const t of tagsOf(n.text)) {
          const k = t.toLocaleLowerCase();
          const e = counts.get(k) ?? { tag: t, count: 0 };
          e.count++;
          counts.set(k, e);
        }
      const list = [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
      return ok(list, list.map((t) => `#${t.tag}\t${t.count}`));
    }
    case "tag:notes": {
      const want = a0.replace(/^#/, "").toLocaleLowerCase();
      const list = (await c.notes()).filter((n) => tagsOf(n.text).some((t) => t.toLocaleLowerCase() === want || t.toLocaleLowerCase().startsWith(want + "/"))).map((n) => n.path);
      return { ...ok(list, list), exit: list.length ? 0 : 3 };
    }
    case "tags:rename": {
      const from = a0.replace(/^#/, "");
      const to = (args[1] ?? "").replace(/^#/, "");
      if (!/^[\p{L}\p{N}_][\p{L}\p{N}\p{M}_/-]*$/u.test(to)) throw new UsageError(`'${to}' is not a tag.`);
      const ops: Op[] = [];
      for (const n of await c.notes()) {
        const next = renameTag(n.text, from, to);
        if (next !== n.text) ops.push(writeOp(n.path, n.text, next));
      }
      return proposal("tags:rename", `Rename #${from} to #${to} in ${ops.length} note(s)`, ops, { from, to, notes: ops.length });
    }
    case "tag:remove": {
      const tag = a0.replace(/^#/, "");
      const scope = flags.note ? [await noteArg(c, flags.note)] : null;
      const ops: Op[] = [];
      for (const n of await c.notes()) {
        if (scope && !scope.includes(n.path)) continue;
        const next = removeTag(n.text, tag);
        if (next !== n.text) ops.push(writeOp(n.path, n.text, next));
      }
      return proposal("tag:remove", `Remove #${tag} from ${ops.length} note(s)`, ops, { tag, notes: ops.length });
    }
    // ── properties ──
    case "properties": {
      if (args.length) {
        const p = await noteArg(c, rest(0));
        const props = propertiesOf(await mustRead(c, p));
        return ok(props, Object.entries(props).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`));
      }
      const counts = new Map<string, number>();
      for (const n of await c.notes()) for (const k of Object.keys(propertiesOf(n.text))) counts.set(k, (counts.get(k) ?? 0) + 1);
      const list = [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
      return ok(list, list.map((p) => `${p.name}\t${p.count}`));
    }
    case "property:get": {
      const p = await noteArg(c, a0);
      const props = propertiesOf(await mustRead(c, p));
      if (!(args[1] in props)) throw new NotFoundError(`${p} has no property '${args[1]}'.`);
      const v = props[args[1]];
      return ok(v, [Array.isArray(v) ? v.join(", ") : String(v)]);
    }
    case "property:set": {
      const p = await noteArg(c, a0);
      const before = await mustRead(c, p);
      const raw = rest(2);
      const value = flags.list ? raw.split(",").map((s) => s.trim()).filter(Boolean) : raw;
      const after = setProperty(before, args[1], value);
      return proposal("property:set", `Set ${args[1]} in ${p}`, after === before ? [] : [writeOp(p, before, after)], { path: p, name: args[1], value });
    }
    case "property:remove": {
      const p = await noteArg(c, a0);
      const before = await mustRead(c, p);
      const after = setProperty(before, args[1], undefined);
      return proposal("property:remove", `Remove ${args[1]} from ${p}`, after === before ? [] : [writeOp(p, before, after)], { path: p, name: args[1] });
    }
    case "property:rename": {
      const ops: Op[] = [];
      for (const n of await c.notes()) {
        const next = renameProperty(n.text, a0, args[1]);
        if (next !== n.text) ops.push(writeOp(n.path, n.text, next));
      }
      return proposal("property:rename", `Rename property ${a0} to ${args[1]} in ${ops.length} note(s)`, ops, { from: a0, to: args[1], notes: ops.length });
    }
    // ── search ──
    case "find": {
      // The shared tokenizer splits words at niqqud marks: fold them away first.
      const fold = (t: string) => t.normalize("NFD").replace(/[\u0591-\u05C7]/g, "").normalize("NFC");
      const words = tokenize(fold(rest(0))).map((w) => wordTerms(w));
      if (!words.length) throw new UsageError("Search for at least one word.");
      const limit = Math.max(1, Math.min(500, Number(flags.limit) || 20));
      const hits: Array<{ path: string; score: number; line: number; snippet: string }> = [];
      for (const n of await c.notes()) {
        const terms = new Map<string, number>();
        const folded = fold(n.text);
        for (const w of tokenize(folded)) for (const t of wordTerms(w)) terms.set(t, (terms.get(t) ?? 0) + 1);
        const title = stemOf(n.path);
        let score = 0;
        let all = true;
        for (const alts of words) {
          const f = Math.max(...alts.map((t) => terms.get(t) ?? 0));
          if (!f) all = false;
          score += f + (alts.some((t) => tokenize(title).some((w) => wordTerms(w).includes(t))) ? 3 : 0);
        }
        if (!all) continue;
        const lines = folded.split("\n");
        const original = n.text.split("\n");
        // The first matching line of the body; the properties only when the body has none.
        const has = (l: string) => tokenize(l).some((w) => wordTerms(w).some((t) => words.some((alts) => alts.includes(t))));
        const bodyAt = parseFrontmatter(n.text).bodyStart ? n.text.slice(0, parseFrontmatter(n.text).bodyStart).split("\n").length - 1 : 0;
        let li = lines.findIndex((l, i) => i >= bodyAt && has(l));
        if (li < 0) li = Math.max(0, lines.findIndex(has));
        hits.push({ path: n.path, score, line: li + 1, snippet: (original[li] ?? lines[li]).trim().slice(0, 200) });
      }
      hits.sort((x, y) => y.score - x.score || x.path.localeCompare(y.path));
      const top = hits.slice(0, limit);
      return { ...ok(top, top.map((h) => `${h.path}:${h.line}\t${h.snippet}`)), exit: top.length ? 0 : 3 };
    }
    case "outline": {
      const p = await noteArg(c, rest(0));
      const hs = headingsOf(await mustRead(c, p));
      return ok(hs, hs.map((h) => `${"  ".repeat(h.level - 1)}${h.text}`));
    }
    case "wordcount": {
      if (args.length) {
        const p = await noteArg(c, rest(0));
        const wc = wordCount(await mustRead(c, p));
        return ok({ path: p, ...wc }, [`${wc.words} words, ${wc.characters} characters`]);
      }
      let words = 0;
      let characters = 0;
      for (const n of await c.notes()) {
        const wc = wordCount(n.text);
        words += wc.words;
        characters += wc.characters;
      }
      return ok({ words, characters }, [`${words} words, ${characters} characters`]);
    }
    case "recent": {
      if (!c.port.mtime) throw new UsageError("This vault does not report change times.");
      const limit = Math.max(1, Math.min(500, Number(flags.limit) || 10));
      const list: Array<{ path: string; mtime: number }> = [];
      for (const p of c.files.filter(isNote)) list.push({ path: p, mtime: (await c.port.mtime(p)) ?? 0 });
      list.sort((a, b) => b.mtime - a.mtime || a.path.localeCompare(b.path));
      const top = list.slice(0, limit);
      return ok(top, top.map((r) => `${new Date(r.mtime).toISOString()}\t${r.path}`));
    }
    // ── tasks ──
    case "tasks": {
      const scope = args.length ? [await noteArg(c, rest(0))] : null;
      const list: Array<{ path: string; line: number; done: boolean; text: string }> = [];
      for (const n of await c.notes()) {
        if (scope && !scope.includes(n.path)) continue;
        for (const t of tasksOf(n.text)) if ((!flags.open || !t.done) && (!flags.done || t.done)) list.push({ path: n.path, ...t });
      }
      return ok(list, list.map((t) => `${t.path}:${t.line}\t[${t.done ? "x" : " "}] ${t.text}`));
    }
    case "task:done":
    case "task:undone": {
      const p = await noteArg(c, a0);
      const before = await mustRead(c, p);
      const line = Number(args[1]);
      if (!Number.isInteger(line) || line < 1) throw new UsageError("A line number.");
      const after = setTask(before, line, cmd === "task:done");
      return proposal(cmd, `${cmd === "task:done" ? "Complete" : "Reopen"} the task on ${p}:${line}`, after === before ? [] : [writeOp(p, before, after)], { path: p, line });
    }
    case "task:add": {
      const p = await noteArg(c, a0);
      const before = await mustRead(c, p);
      return proposal("task:add", `Add a task to ${p}`, [writeOp(p, before, appendText(before, `- [ ] ${rest(1)}`))], { path: p });
    }
    // ── daily ──
    case "daily:path":
    case "daily:read":
    case "daily:append": {
      let d = c.now;
      if (flags.date) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(flags.date);
        if (!m) throw new UsageError("--date is YYYY-MM-DD.");
        d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
      }
      const folder = (flags.folder ?? "journal").replace(/^\/+|\/+$/g, "");
      const p = notePath(`${folder ? `${folder}/` : ""}${dayStamp(d)}.md`);
      if (cmd === "daily:path") return ok({ path: p, exists: c.files.includes(p) }, [p]);
      const before = await c.text(p);
      if (cmd === "daily:read") {
        if (before === null) throw new NotFoundError(`No note for ${dayStamp(d)} (${p}).`);
        return ok({ path: p, text: before }, [before.replace(/\n$/, "")]);
      }
      const line = `- ${pad2(d.getHours())}:${pad2(d.getMinutes())} ${rest(0)}`;
      return proposal("daily:append", `Add to ${p}`, [writeOp(p, before, appendText(before ?? `# ${dayStamp(d)}\n`, line))], { path: p });
    }
    // ── vault ──
    case "vault": {
      const notes = c.files.filter(isNote).length;
      return ok({ root: c.port.root, mode: c.port.mode, files: c.files.length, notes }, [`${c.port.root}`, `${notes} notes, ${c.files.length} files (${c.port.mode === "app" ? "the running app" : "on disk; the app is not running"})`]);
    }
    case "version":
      return ok({ cli: CLI_VERSION, protocol: PROTOCOL_VERSION }, [`lumen ${CLI_VERSION} (protocol ${PROTOCOL_VERSION})`]);
    case "help": {
      const h = helpText(c.lang, a0);
      if (!h) throw new NotFoundError(c.lang === "he" ? `אין פקודה '${a0}'.` : `No command '${a0}'.`);
      return ok({ lines: h }, h);
    }
    case "stats": {
      const links = await linkMap(c);
      let words = 0;
      let open = 0;
      let done = 0;
      const tags = new Set<string>();
      for (const n of await c.notes()) {
        words += wordCount(n.text).words;
        for (const t of tasksOf(n.text)) t.done ? done++ : open++;
        for (const t of tagsOf(n.text)) tags.add(t.toLocaleLowerCase());
      }
      const s = { notes: c.files.filter(isNote).length, files: c.files.length, words, links: links.length, unresolved: links.filter((l) => !l.to).length, tags: tags.size, tasksOpen: open, tasksDone: done };
      return ok(s, Object.entries(s).map(([k, v]) => `${k}\t${v}`));
    }
    case "changes":
    case "discard":
      // The queue lives with the vault's host (./host.ts); a port has no queue.
      throw new UsageError("The review queue is handled by the host.");
  }
  throw new UsageError(`No command '${cmd}'.`);
}
