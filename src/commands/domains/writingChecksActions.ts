/**
 * The L5 writing checkers' palette flows (W13.W6–W10), loaded on demand.
 * Every flow is cancellable (Esc / "Cancel AI"), reads only, and ends in
 * the review panel: nothing is written until the user approves it there.
 */
import { t } from "../../i18n";
import { showAiToast } from "../../ui/AiToast";
import { isAbort } from "../../ai/aiAbort";
import { explainError } from "../../lib/userError";
import { cancellable, type CommandContext } from "./context";
import type { WritingSuggestion } from "../../agents/writing/suggestionShape";
import type { ReportLabels } from "../../agents/writing/stage";
import "./writingChecksStrings";

type Ctx = Pick<CommandContext, "getEditorView" | "liveDoc">;

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** The open note: its live text (the editor's, when it shows the source) and its vault path ("" when unsaved). */
function openNote(ctx: Ctx): { text: string; path: string } | null {
  const view = ctx.getEditorView?.();
  const doc = ctx.liveDoc();
  const text = view ? view.state.doc.toString() : doc.content;
  if (!text.trim()) return null;
  return { text, path: doc.workspaceName ?? "" };
}

export function reportLabels(agent: "consistency" | "structure" | "argument" | "harper"): ReportLabels {
  return {
    title: t(`writingCheck.title.${agent}`),
    count: (n) => t("writingCheck.count", { n }),
    none: t("writingCheck.none"),
    why: t("writingCheck.why"),
    sources: t("writingCheck.sources"),
    staged: (n) => t("writingCheck.stagedLine", { n }),
    kind: (k) => t(`writingCheck.kind.${k.startsWith("grammar:") ? "grammar" : k}`, { defaultValue: k }),
  };
}

async function stageAndTell(sugs: WritingSuggestion[], texts: Map<string, string>, agentId: string, labels: ReportLabels): Promise<void> {
  if (!sugs.length) {
    showAiToast(t("writingCheck.none"), "success");
    return;
  }
  const [{ stageWritingSuggestions, REPORT_DIR }, ws] = await Promise.all([import("../../agents/writing/stage"), import("../../storage/workspace")]);
  const path = `${REPORT_DIR}/${agentId}-${today()}.md`;
  const before = (await ws.workspaceHasFile(path).catch(() => false)) ? await ws.readWorkspaceFile(path) : null;
  const r = stageWritingSuggestions({ suggestions: sugs, texts, agentId, tool: `writing.${agentId}`, labels, today: today(), reportBefore: before });
  const comments = sugs.length - r.staged.length;
  showAiToast(t("writingCheck.done", { staged: r.staged.length, comments }), "success");
  window.dispatchEvent(new Event("lumen-open-agent-review"));
}

async function run(fn: (signal: AbortSignal) => Promise<void>): Promise<void> {
  try {
    showAiToast(t("writingCheck.running"), "info");
    await cancellable(fn);
  } catch (e) {
    if (isAbort(e)) return;
    showAiToast(t("writingCheck.failed", { error: explainError(e) }), "error");
  }
}

/** W13.W6: names, facts and terms across the vault, against the entity graph. */
export function consistencyFlow(_ctx: Ctx): Promise<void> {
  return run(async (signal) => {
    const [{ loadEntityGraph }, { runVaultConsistency }, { ENTITY_ROOT }, { REPORT_DIR }] = await Promise.all([
      import("../../entities/graphData"),
      import("../../agents/writing/consistency/vaultConsistency"),
      import("../../entities/model"),
      import("../../agents/writing/stage"),
    ]);
    const g = await loadEntityGraph();
    const texts = new Map([...g.texts].filter(([p]) => p.endsWith(".md") && !p.startsWith(`${ENTITY_ROOT}/`) && !p.startsWith(`${REPORT_DIR}/`)));
    const sugs = await runVaultConsistency({ notes: [...texts].map(([path, content]) => ({ path, content })), entities: g.entities }, { signal });
    await stageAndTell(sugs, texts, "consistency", reportLabels("consistency"));
  });
}

/** W13.W7: the open note's structure; the topic-sentence question goes to a local model through the runtime when one answers. */
export function structureFlow(ctx: Ctx): Promise<void> {
  const note = openNote(ctx);
  if (!note) {
    showAiToast(t("writingCheck.noNote"), "info");
    return Promise.resolve();
  }
  return run(async (signal) => {
    const [{ critiqueStructure }, { runtimeTopicJudge }, { runAgent }] = await Promise.all([
      import("../../agents/writing/structure/structureCritic"),
      import("../../agents/writing/structure/topicSentenceAgent"),
      import("../../agents/runtime"),
    ]);
    const sugs = (await critiqueStructure(note.text, { signal, judge: runtimeTopicJudge(runAgent), judgeModel: "local" })).map((s) => ({ ...s, path: note.path }));
    await stageAndTell(sugs, new Map([[note.path, note.text]]), "structure", reportLabels("structure"));
  });
}

/** W13.W8: the open note's claims, leaps and fallacies, with the vault's sources and argument map. */
export function argumentFlow(ctx: Ctx): Promise<void> {
  const note = openNote(ctx);
  if (!note) {
    showAiToast(t("writingCheck.noNote"), "info");
    return Promise.resolve();
  }
  return run(async (signal) => {
    const [{ checkArgument }, { ensureIndex, indexedNotes }, { frontmatterOf }] = await Promise.all([
      import("../../agents/writing/argument/argumentChecker"),
      import("../../storage/workspaceIndex"),
      import("../../viz/ArgumentMapBlock"),
    ]);
    await ensureIndex();
    const notes = (await indexedNotes()).map((n) => ({ path: n.path, content: n.content, fm: frontmatterOf(n.content) }));
    const sources = notes.filter((n) => /^(?:evidence|source|מקור)$/i.test(String(n.fm.type ?? ""))).map((n) => ({ path: n.path, text: n.content }));
    const sugs = checkArgument({ text: note.text, path: note.path || undefined, sources, mapNotes: notes.map(({ path, fm }) => ({ path, fm })) }, { signal }).map((s) => ({ ...s, path: note.path }));
    await stageAndTell(sugs, new Map([[note.path, note.text]]), "argument", reportLabels("argument"));
  });
}

/** W13.W9: the open note's readability, in a toast (the level and what raises it most). */
export function readabilityFlow(ctx: Ctx): Promise<void> {
  const note = openNote(ctx);
  if (!note) {
    showAiToast(t("writingCheck.noNote"), "info");
    return Promise.resolve();
  }
  return run(async () => {
    const [{ readability, topList }, { parseFrequencyList, HEBREW_FREQ_PATH }] = await Promise.all([import("../../agents/writing/readability/readability"), import("../../ai/hebrewFreq")]);
    let freq;
    try {
      const base = ((import.meta.env?.BASE_URL as string | undefined) ?? "/").replace(/\/?$/, "/");
      // privacy-ledger: same-origin app asset (public/dict/he_50k.txt, precached), as the Hebrew spelling worker loads it
      const res = await fetch(new URL(`${base}${HEBREW_FREQ_PATH}`, location.href).href);
      if (res.ok) freq = topList(parseFrequencyList(await res.text()));
    } catch {
      /* why: offline before the precache: the model without the rare-word feature */
    }
    const r = readability(note.text, { freq });
    showAiToast(readabilityLine(r), "info");
  });
}

/** One line: the band, the score, the school stage and what raises it most. */
export function readabilityLine(r: import("../../agents/writing/readability/readability").Readability): string {
  const top = r.reasons.find((x) => x.points > 0) ?? r.reasons[0];
  const pct = (v: number) => Math.round(v * 100);
  const reason = !top
    ? t("writingCheck.reason.none")
    : r.lang === "en" && top.feature === "wordLen"
      ? t("writingCheck.reasonEn.wordLen", { value: top.value.toFixed(2) })
      : top.feature === "rare" || top.feature === "ambiguous"
        ? t(`writingCheck.reason.${top.feature}`, { value: pct(top.value) })
        : t(`writingCheck.reason.${top.feature}`, { value: top.value.toFixed(1) });
  return t(r.lang === "he" ? "writingCheck.readability.he" : "writingCheck.readability.en", {
    band: t(`writingCheck.band.${r.band}`),
    score: r.score.toFixed(1),
    stage: t(`writingCheck.stage.${r.stage}`),
    reason,
  });
}

/** W13.W10: Harper on the English parts of the open note. */
export function harperFlow(ctx: Ctx): Promise<void> {
  const note = openNote(ctx);
  if (!note) {
    showAiToast(t("writingCheck.noNote"), "info");
    return Promise.resolve();
  }
  return run(async (signal) => {
    const { harperLints, harperSuggestions } = await import("../../agents/writing/harper/harperService");
    if ((await harperLints("Harper check.", { signal })) === null) {
      showAiToast(t("writingCheck.harperMissing"), "info");
      return;
    }
    const sugs = (await harperSuggestions(note.text, { signal })).map((s) => ({ ...s, path: note.path }));
    await stageAndTell(sugs, new Map([[note.path, note.text]]), "harper", reportLabels("harper"));
  });
}
