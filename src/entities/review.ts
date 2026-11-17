/**
 * The graph review queue's operations (plan W12.E5): approve, reject,
 * merge and split, each a pure function of the vault's files that returns
 * the files it changes and an undo record. Undo restores every touched
 * file byte for byte (or removes a file the operation created), so one
 * step takes the vault back exactly.
 *
 * - Approve: an entity proposal becomes a note under `ישויות/<type>/`, or,
 *   when it matched a known entity, adds the mention's spelling to that
 *   note's aliases; an edge proposal is appended to edges.jsonl (status
 *   approved) and becomes a `[[link]]` relation property on its subject's
 *   note. The edge's paragraph gets its `^id` if it has none.
 * - Reject: remembered in decisions.jsonl, so it is not proposed again.
 * - Merge (as Capacities merges objects): aliases unite, edges move to the
 *   entity kept, the other note goes, and every `[[link]]` to it in the
 *   vault points at the kept note with the old name as its alias text.
 * - Split: chosen aliases and edges (the evidence of one "mention group")
 *   move to a new entity of the same type.
 *
 * These run on the user's click in the review panel. Agents never call
 * them: the extractors only write proposals (Rule of Two, W12.E4).
 */
import { parse as parseYaml, stringify } from "yaml";
import { splitFrontmatter } from "./frontmatter";
import { ENTITY_ROOT, edgeId, entityId, entityNotePath, type Edge, type Entity } from "./model";
import { ensureAnchor, paragraphByAnchor, splitParagraphs } from "./paragraphs";
import { assertEdge } from "./schema";
import { DECISIONS_PATH, EDGES_PATH, PROPOSALS_PATH, parseJsonl, proposalKey, readEdges, toJsonl, type Decision, type EntityProposal, type Proposal } from "./store";
import { entityNote, parseEntityNote } from "./notes";
import { compareNames } from "../i18n/collate";

export type Files = ReadonlyMap<string, string>;
/** Each touched path and what it held before (null: it did not exist). */
export type Undo = Map<string, string | null>;

export interface OpResult {
  files: Map<string, string>;
  undo: Undo;
  /** Paths written (created or changed) and removed, for the vault writer. */
  written: string[];
  removed: string[];
}

class Tx {
  readonly files: Map<string, string>;
  readonly undo: Undo = new Map();
  constructor(base: Files) {
    this.files = new Map(base);
  }
  get(path: string): string | null {
    return this.files.get(path) ?? null;
  }
  set(path: string, text: string | null): void {
    if (!this.undo.has(path)) this.undo.set(path, this.get(path));
    if (text === null) this.files.delete(path);
    else this.files.set(path, text);
  }
  done(): OpResult {
    const written: string[] = [];
    const removed: string[] = [];
    for (const [p, before] of this.undo) {
      const now = this.get(p);
      if (now === before) this.undo.delete(p);
      else if (now === null) removed.push(p);
      else written.push(p);
    }
    return { files: this.files, undo: this.undo, written, removed };
  }
}

/** Undo one operation: every touched file back as it was. */
export function undoOp(files: Files, undo: Undo): OpResult {
  const tx = new Tx(files);
  for (const [p, before] of undo) tx.set(p, before);
  return tx.done();
}

export function entitiesOf(files: Files): Entity[] {
  const out: Entity[] = [];
  for (const [p, c] of files) if (p.startsWith(`${ENTITY_ROOT}/`) && p.endsWith(".md")) {
    const e = parseEntityNote(p, c);
    if (e) out.push(e);
  }
  return out.sort((a, b) => compareNames(a.id, b.id));
}

export function proposalsOf(files: Files): Proposal[] {
  return parseJsonl<Proposal>(files.get(PROPOSALS_PATH) ?? "").rows;
}

export const edgesOf = (files: Files): Edge[] => readEdges(files.get(EDGES_PATH) ?? "").edges;

const notePathOf = (files: Files, id: string) => {
  for (const [p, c] of files) if (p.startsWith(`${ENTITY_ROOT}/`) && parseEntityNote(p, c)?.id === id) return p;
  return null;
};
const nameOfPath = (p: string) => p.split("/").pop()!.replace(/\.md$/i, "");

/** Front matter changed by `edit`; the body stays byte for byte. A broken front matter is left alone. */
function editProps(text: string, edit: (props: Record<string, unknown>) => void): string {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[^\S\r\n]*(\r?\n|$)/.exec(text);
  const { broken } = splitFrontmatter(text);
  if (broken) return text;
  const props: Record<string, unknown> = m ? ((parseYaml(m[1]) as Record<string, unknown>) ?? {}) : {};
  edit(props);
  const yaml = stringify(props, { lineWidth: 0 }).trimEnd();
  const body = m ? text.slice(m[0].length) : `\n${text}`;
  return `---\n${yaml}\n---\n${body}`;
}

const addAlias = (text: string, alias: string, name: string) =>
  editProps(text, (p) => {
    const list = Array.isArray(p.aliases) ? (p.aliases as unknown[]).filter((x): x is string => typeof x === "string") : [];
    if (alias !== name && !list.includes(alias)) list.push(alias);
    if (list.length) p.aliases = list;
  });

function writeEdges(tx: Tx, edges: readonly Edge[]): void {
  tx.set(EDGES_PATH, edges.length ? toJsonl(edges.map(assertEdge)) : null);
}

function writeProposals(tx: Tx, keep: readonly Proposal[]): void {
  tx.set(PROPOSALS_PATH, keep.length ? toJsonl(keep) : null);
}

/** Approve proposals by id. Edges whose ends are not (yet) entities wait in the queue. */
export function approve(files: Files, ids: readonly string[]): OpResult {
  const tx = new Tx(files);
  const want = new Set(ids);
  const all = proposalsOf(files);
  const left: Proposal[] = [];
  // Entities first, so edges in the same batch can reach them.
  for (const p of all) {
    if (!want.has(p.id) || p.kind !== "entity") continue;
    approveEntity(tx, p);
  }
  const known = new Set(entitiesOf(tx.files).map((e) => e.id));
  const edges = edgesOf(tx.files);
  for (const p of all) {
    if (!want.has(p.id)) {
      left.push(p);
      continue;
    }
    if (p.kind !== "edge") continue;
    if (!known.has(p.edge.subject) || !known.has(p.edge.object)) {
      left.push(p);
      continue;
    }
    const e: Edge = { ...p.edge, status: "approved" };
    // The paragraph's anchor: added now, on approval, if the note lacks it.
    const note = tx.get(e.provenance.note);
    if (note !== null && !paragraphByAnchor(note, e.provenance.anchor)) {
      const para = splitParagraphs(note).find((x) => x.hash === e.provenance.paragraphHash && !x.anchor);
      if (para) {
        const r = ensureAnchor(note, para.start, () => e.provenance.anchor);
        if (r) tx.set(e.provenance.note, r.content);
      }
    }
    if (!edges.some((x) => x.id === e.id)) edges.push(e);
    const sp = notePathOf(tx.files, e.subject);
    const op = notePathOf(tx.files, e.object);
    if (sp && op) {
      const link = `[[${nameOfPath(op)}]]`;
      tx.set(
        sp,
        editProps(tx.get(sp)!, (props) => {
          const list = Array.isArray(props[e.predicate]) ? (props[e.predicate] as unknown[]).filter((x): x is string => typeof x === "string") : [];
          if (!list.includes(link)) list.push(link);
          props[e.predicate] = list;
        }),
      );
    }
  }
  writeEdges(tx, edges);
  writeProposals(tx, left);
  return tx.done();
}

function approveEntity(tx: Tx, p: EntityProposal): void {
  const target = p.matches ? notePathOf(tx.files, p.matches) : null;
  if (target) {
    const e = parseEntityNote(target, tx.get(target)!)!;
    let text = tx.get(target)!;
    for (const m of p.mentions) text = addAlias(text, m.text.trim(), e.name);
    for (const a of p.aliases) text = addAlias(text, a, e.name);
    tx.set(target, text);
    return;
  }
  const ent: Entity = { id: entityId(p.type, p.name), type: p.type, name: p.name, aliases: [...p.aliases] };
  const path = entityNotePath(ent);
  const cur = tx.get(path);
  if (cur === null) tx.set(path, entityNote(ent).content);
  else for (const a of p.aliases) tx.set(path, addAlias(tx.get(path)!, a, ent.name));
}

/** Reject proposals by id: out of the queue, and remembered. */
export function reject(files: Files, ids: readonly string[], date: Date = new Date()): OpResult {
  const tx = new Tx(files);
  const want = new Set(ids);
  const all = proposalsOf(files);
  const decisions = parseJsonl<Decision>(files.get(DECISIONS_PATH) ?? "").rows;
  for (const p of all) if (want.has(p.id)) decisions.push({ key: proposalKey(p), verdict: "rejected", date: date.toISOString() });
  writeProposals(tx, all.filter((p) => !want.has(p.id)));
  tx.set(DECISIONS_PATH, toJsonl(decisions));
  return tx.done();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every `[[from]]`, `[[from|x]]`, `[[from#…]]` in `text` pointed at `to` (the old name kept as the shown text). */
export function relink(text: string, from: string, to: string): string {
  const re = new RegExp(`(!?)\\[\\[${escapeRe(from)}(#[^\\]|]*)?(?:\\|([^\\]]*))?\\]\\]`, "g");
  return text.replace(re, (_m, bang: string, frag: string | undefined, shown: string | undefined) => `${bang}[[${to}${frag ?? ""}|${shown ?? from}]]`);
}

function moveEdges(edges: readonly Edge[], from: string, to: string, only?: ReadonlySet<string>): Edge[] {
  const out: Edge[] = [];
  const seen = new Set<string>();
  for (const e of edges) {
    let x = e;
    if (!only || only.has(e.id)) {
      const s = e.subject === from ? to : e.subject;
      const o = e.object === from ? to : e.object;
      if (s !== e.subject || o !== e.object) x = { ...e, subject: s, object: o, id: edgeId(s, e.predicate, o, e.provenance.note, e.provenance.anchor) };
    }
    if (x.subject === x.object || seen.has(x.id)) continue;
    seen.add(x.id);
    out.push(x);
  }
  return out;
}

/** Merge `gone` into `keep`. */
export function merge(files: Files, keepId: string, goneId: string): OpResult {
  const tx = new Tx(files);
  const kp = notePathOf(files, keepId);
  const gp = notePathOf(files, goneId);
  if (!kp || !gp || kp === gp) throw new Error("merge: both entities must be notes");
  const keep = parseEntityNote(kp, files.get(kp)!)!;
  const gone = parseEntityNote(gp, files.get(gp)!)!;
  let text = files.get(kp)!;
  for (const a of [gone.name, ...gone.aliases]) text = addAlias(text, a, keep.name);
  // The gone note's relations move over.
  const goneProps = splitFrontmatter(files.get(gp)!).props;
  text = editProps(text, (props) => {
    for (const [k, v] of Object.entries(goneProps)) {
      if (!Array.isArray(v) || k === "aliases") continue;
      const list = Array.isArray(props[k]) ? (props[k] as unknown[]) : [];
      for (const x of v) if (!list.includes(x)) list.push(x);
      props[k] = list;
    }
  });
  tx.set(kp, text);
  tx.set(gp, null);
  const gName = nameOfPath(gp);
  const kName = nameOfPath(kp);
  for (const [p, c] of tx.files) {
    if (!p.endsWith(".md")) continue;
    const next = relink(c, gName, kName);
    if (next !== c) tx.set(p, next);
  }
  writeEdges(tx, moveEdges(edgesOf(files), goneId, keepId));
  return tx.done();
}

/** Split chosen aliases and edges off `fromId` into a new entity `name` of the same type. */
export function split(files: Files, fromId: string, name: string, pick: { aliases?: readonly string[]; edges?: readonly string[] }): OpResult {
  const tx = new Tx(files);
  const fp = notePathOf(files, fromId);
  if (!fp) throw new Error("split: no such entity note");
  const from = parseEntityNote(fp, files.get(fp)!)!;
  const fresh: Entity = { id: entityId(from.type, name), type: from.type, name, aliases: (pick.aliases ?? []).filter((a) => from.aliases.includes(a)) };
  const np = entityNotePath(fresh);
  if (files.has(np)) throw new Error("split: an entity with that name exists");
  const moved = new Set(pick.edges ?? []);
  const edges = moveEdges(edgesOf(files), fromId, fresh.id, moved);
  const nameOf = (id: string) => {
    const p = notePathOf(tx.files, id);
    return p ? nameOfPath(p) : undefined;
  };
  tx.set(
    fp,
    editProps(files.get(fp)!, (props) => {
      const rest = from.aliases.filter((a) => !fresh.aliases.includes(a));
      if (rest.length) props.aliases = rest;
      else delete props.aliases;
      // Relations of moved edges leave the old note.
      for (const e of edgesOf(files)) {
        if (!moved.has(e.id) || e.subject !== fromId) continue;
        const target = nameOf(e.object);
        const list = Array.isArray(props[e.predicate]) ? (props[e.predicate] as unknown[]).filter((x) => x !== `[[${target}]]`) : [];
        if (list.length) props[e.predicate] = list;
        else delete props[e.predicate];
      }
    }),
  );
  tx.set(np, entityNote(fresh, edges.filter((e) => e.subject === fresh.id), nameOf).content);
  writeEdges(tx, edges);
  return tx.done();
}
