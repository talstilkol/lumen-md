/**
 * The "גרסה אחרת" agent (plan R12.10): reads the vault, finds where the
 * notes disagree (agents/contradictions.ts, no model needed), and proposes
 * a report note through the approval queue (agents/staging.ts). It never
 * edits a note: the only thing it can do is stage one new file, which the
 * user approves or rejects in the review panel (Rule of Two: it reads
 * outside content, so it gets no direct write).
 *
 * Clean reimplementation (design reference only: israelconnect's
 * counter-evidence agent, AGPL; no code taken).
 */
import { t } from "../i18n";
import { findContradictions, type Candidate } from "./contradictions";
import { untrustedSourcesOfNote } from "./provenance";
import { stageChange } from "./staging";
import type { StagedChange } from "./types";
import "./contradictionsStrings";

export const REPORT_DIR = "סתירות";

/** The workspace calls the agent uses (tests pass the real module over a memory vault). */
export interface ContradictorVault {
  listWorkspace(): Promise<Array<{ path: string }>>;
  readWorkspaceFile(path: string): Promise<string>;
  workspaceHasFile(path: string): Promise<boolean>;
}

const quoteBlock = (q: Candidate["a"]) => `> ${q.text.replace(/\n/g, "\n> ")}\n> — [[${q.note.replace(/\.md$/i, "")}]] (${q.start}–${q.end})`;

/** The report note: each candidate's two quotes side by side, the user's own notes first. */
export function contradictionReport(cands: readonly Candidate[], day: string): string {
  const out = [`# ${t("contradictions.title")} · ${day}`, ""];
  if (!cands.length) out.push(t("contradictions.none"));
  else out.push(t("contradictions.candidates", { n: String(cands.length) }));
  cands.forEach((c, i) => {
    out.push("", `## ${i + 1}. ${t(`contradictions.kind.${c.kind}`)}: ${c.subjects.join(", ")}`, "", quoteBlock(c.a), "", quoteBlock(c.b));
    for (const u of c.untrusted) out.push("", `*${t("contradictions.untrusted", { why: u.why.join("; ") })}*`);
  });
  return out.join("\n") + "\n";
}

export async function runContradictor(opts: { vault?: ContradictorVault; today: string }): Promise<{ candidates: Candidate[]; staged: StagedChange }> {
  const ws = opts.vault ?? ((await import("../storage/workspace")) as unknown as ContradictorVault);
  const notes = new Map<string, string>();
  for (const e of await ws.listWorkspace()) {
    if (!/\.md$/i.test(e.path) || e.path.startsWith(`${REPORT_DIR}/`)) continue;
    try {
      notes.set(e.path, await ws.readWorkspaceFile(e.path));
    } catch {
      /* why: removed while listing */
    }
  }
  const names = [...notes.keys()].map((p) => p.split("/").pop()!.replace(/\.md$/i, ""));
  const candidates = findContradictions(notes, { names, untrusted: (p, c) => untrustedSourcesOfNote(p, c) });
  const path = `${REPORT_DIR}/${opts.today}.md`;
  const before = (await ws.workspaceHasFile(path)) ? await ws.readWorkspaceFile(path) : null;
  const staged = stageChange({ kind: "file", path, before, after: contradictionReport(candidates, opts.today), summary: t("contradictions.summary", { n: String(candidates.length) }) }, { tool: "find_contradictions", agentId: "contradictor" });
  return { candidates, staged };
}
