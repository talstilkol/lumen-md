/**
 * The writing commands' bodies (plan W13.W1–W5), loaded on first use. One
 * flow for every writing agent and both editors:
 *  1. the text: the whole note for a detector (the coach, the
 *     proofreader), the selection or the paragraph at the cursor for a
 *     generator (tone, shorten, expand);
 *  2. the agent runs on this device with a cancel signal (Esc / "AI:
 *     Cancel"), with the local model door when it needs one;
 *  3. its suggestions are drawn in the editor and listed in the panel; the
 *     user accepts, edits or rejects — the note changes only then, in one
 *     undoable transaction.
 */
import type { EditorView } from "@codemirror/view";
import { t } from "../../i18n";
import { showAiToast } from "../../ui/AiToast";
import { isAbort } from "../../ai/aiAbort";
import { explainError } from "../../lib/userError";
import { cancellable, type CommandContext } from "./context";
import "../../ui/writingPanelStrings";
import { getWritingAgent, langOf, type WritingLevel, WRITING_LEVELS } from "../../agents/writing/agent";
import "../../agents/writing/agents";
import { runtimeModel } from "../../agents/writing/model";
import { validateSuggestion, type WritingSuggestion } from "../../agents/writing/suggestion";
import type { WritingHost } from "../../ui/WritingSuggestionsPanel";

type PmView = import("@milkdown/prose/view").EditorView;

const LEVEL_KEY = "lumen.writing.level";
const RANK_KEY = "lumen.writing.rankWithModel";

/** The writing level (a per-viewer convenience; default professional). */
export function writingLevel(): WritingLevel {
  try {
    const v = localStorage.getItem(LEVEL_KEY) as WritingLevel | null;
    return v && WRITING_LEVELS.includes(v) ? v : "professional";
  } catch {
    return "professional";
  }
}
export function setWritingLevel(level: WritingLevel): void {
  try {
    localStorage.setItem(LEVEL_KEY, level);
  } catch {
    /* why: storage may be blocked (private window); the level just isn't remembered */
  }
}
function rankWithModel(): boolean {
  try {
    return localStorage.getItem(RANK_KEY) === "1";
  } catch {
    return false;
  }
}
function setRankWithModel(on: boolean): void {
  try {
    localStorage.setItem(RANK_KEY, on ? "1" : "0");
  } catch {
    /* why: storage may be blocked; the choice just isn't remembered */
  }
}

/** Moves an agent's offsets (into `slice`, at `offset` in the document) to document offsets; drops any that do not fit. */
export function toDocument(list: readonly WritingSuggestion[], offset: number, doc: string): WritingSuggestion[] {
  return list.flatMap((s) => {
    const moved = { ...s, range: { from: s.range.from + offset, to: s.range.to + offset } };
    return validateSuggestion(moved, doc).length ? [] : [moved];
  });
}

/** The paragraph around `pos` (between blank lines). */
export function paragraphAround(doc: string, pos: number): { from: number; to: number } | null {
  const before = doc.lastIndexOf("\n\n", Math.max(0, pos - 1));
  const after = doc.indexOf("\n\n", pos);
  const from = before < 0 ? 0 : before + 2;
  const to = after < 0 ? doc.length : after;
  return doc.slice(from, to).trim() ? { from, to } : null;
}

interface Target {
  /** The text the agent reads and where it is in the editor's text. */
  text: string;
  offset: number;
  docText: string;
  host: (agentId: string) => Promise<WritingHost & { show(list: WritingSuggestion[]): void }>;
}

async function cmTarget(view: EditorView, whole: boolean): Promise<Target | null> {
  const doc = view.state.doc.toString();
  const sel = view.state.selection.main;
  const range = whole ? { from: 0, to: doc.length } : sel.empty ? paragraphAround(doc, sel.head) : { from: sel.from, to: sel.to };
  if (!range) return null;
  return {
    text: doc.slice(range.from, range.to),
    offset: range.from,
    docText: doc,
    host: async (agentId) => {
      const b = await import("../../agents/writing/cmBridge");
      await b.loadHistoryIsolation();
      b.ensureInstalled(view);
      return {
        show: (list) => b.showSuggestions(view, [...b.suggestionsIn(view.state).filter((s) => s.agentId !== agentId), ...list].sort((x, y) => x.range.from - y.range.from)),
        subscribe: (fn) => b.onSuggestionsChange(view, fn),
        accept: (choices) => {
          const plan = b.acceptInView(view, choices);
          view.focus();
          return plan;
        },
        reject: (ids) => b.rejectInView(view, ids),
        focus: (id) => b.focusSuggestion(view, id),
      };
    },
  };
}

async function pmTarget(view: PmView, whole: boolean): Promise<Target | null> {
  const b = await import("../../agents/writing/pmBridge");
  const ix = b.pmTextIndex(view.state.doc);
  let from = 0;
  let to = ix.text.length;
  if (!whole) {
    const { from: a, to: z, empty } = view.state.selection;
    const at = (p: number) => ix.pos.findIndex((x) => x >= p);
    if (!empty) {
      from = Math.max(0, at(a));
      to = Math.max(from, at(z) < 0 ? ix.text.length : at(z));
    } else {
      const r = paragraphAround(ix.text, Math.max(0, at(a)));
      if (!r) return null;
      ({ from, to } = r);
    }
  }
  return {
    text: ix.text.slice(from, to),
    offset: from,
    docText: ix.text,
    host: async (agentId) => {
      await b.loadPmHistoryClose();
      b.ensurePmInstalled(view);
      return {
        show: (list) => b.showPmSuggestions(view, [...b.pmSuggestions(view.state).filter((s) => s.agentId !== agentId), ...list]),
        subscribe: (fn) => b.onPmSuggestionsChange(view, fn),
        accept: (choices) => {
          const plan = b.acceptInPm(view, choices);
          view.focus();
          return plan;
        },
        reject: (ids) => b.rejectInPm(view, ids),
        focus: (id) => b.focusPm(view, id),
      };
    },
  };
}

/** The editor showing the note: the source editor when it is on screen, else the WYSIWYG one. */
async function activeTarget(ctx: Pick<CommandContext, "getEditorView">, whole: boolean): Promise<Target | null> {
  const cm = ctx.getEditorView?.();
  if (cm && cm.dom.isConnected && cm.dom.getClientRects().length) return cmTarget(cm, whole);
  const { getActiveWysiwygView } = await import("../../editor/wysiwygSuggest");
  const pm = getActiveWysiwygView();
  if (pm) return pmTarget(pm, whole);
  return cm ? cmTarget(cm, whole) : null;
}

let lastHost: WritingHost | null = null;
let lastLabel = "";

export async function runWritingAgent(ctx: Pick<CommandContext, "getEditorView">, agentId: string, options?: Record<string, unknown>): Promise<void> {
  const agent = getWritingAgent(agentId);
  if (!agent) return;
  const target = await activeTarget(ctx, agent.kind === "detector");
  if (!target) {
    showAiToast(t(ctx.getEditorView?.() ? "writing.noText" : "writing.noEditor"), "info");
    return;
  }
  if (!target.text.trim()) {
    showAiToast(t("writing.noText"), "info");
    return;
  }
  const { openWritingPanel } = await import("../../ui/WritingSuggestionsPanel");
  const host = await target.host(agentId);
  const label = t(`writing.agent.${agentId}`, { defaultValue: agentId });
  const rerun = () => void runWritingAgent(ctx, agentId, options);
  const panelHost = { ...host, rerun };
  lastHost = panelHost;
  lastLabel = label;
  // The level and the ranking matter to the detectors; changing one runs the agent again.
  const prefs = agent.kind === "detector"
    ? {
        level: writingLevel(),
        onLevel: (l: string) => (setWritingLevel(l as WritingLevel), rerun()),
        ...(agent.id === "styleCoach" ? { rank: rankWithModel(), onRank: (on: boolean) => (setRankWithModel(on), rerun()) } : {}),
      }
    : {};
  openWritingPanel(panelHost, { agentLabel: label, busy: true, ...prefs });
  try {
    const opts = { ...options };
    if (agentId === "toneShifter") {
      const sp = await import("../../ai/styleProfiles");
      if (sp.styleProfileActive()) opts.styleInstruction = sp.styleInstruction();
    }
    const useModel = agent.needsModel || rankWithModel();
    const list = await cancellable((signal) =>
      agent.run({ text: target.text, lang: langOf(target.text), level: writingLevel(), signal, model: useModel ? runtimeModel(agentId) : null, options: opts }),
    );
    host.show(toDocument(list, target.offset, target.docText));
    openWritingPanel(panelHost, { agentLabel: label, ...prefs });
  } catch (e) {
    if (isAbort(e)) {
      openWritingPanel(panelHost, { agentLabel: label, ...prefs });
      return;
    }
    let error = agent.needsModel ? t("writing.noModel", { error: explainError(e) }) : t("writing.failed", { error: explainError(e) });
    if (agent.needsModel) error += ` ${await suggestedModel(agentId, langOf(target.text))}`;
    openWritingPanel(panelHost, { agentLabel: label, error, ...prefs });
  }
}

/**
 * W13.W16's table (agents/writing/modelDefaults): which local model this agent defaults to on
 * a device of this size, so "no model" says what to install. Loaded only on that error.
 */
export async function suggestedModel(agentId: string, lang: string): Promise<string> {
  try {
    const { writingDefault } = await import("../../agents/writing/modelDefaults");
    const ram = typeof navigator !== "undefined" ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory : undefined;
    const pick = writingDefault(agentId, ram ?? null, lang === "he" ? "he" : "en");
    if (!pick || pick.kind !== "llm" || !pick.model) return "";
    return t("writing.suggestModel", { model: pick.model, licence: pick.licence });
  } catch {
    return "";
  }
}

/** Re-opens the panel on the last run's suggestions. */
export async function showWritingPanel(ctx: Pick<CommandContext, "getEditorView">): Promise<void> {
  const { openWritingPanel } = await import("../../ui/WritingSuggestionsPanel");
  if (lastHost) return openWritingPanel(lastHost, { agentLabel: lastLabel });
  const target = await activeTarget(ctx, true);
  if (!target) return void showAiToast(t("writing.noEditor"), "info");
  openWritingPanel(await target.host("none"), { agentLabel: t("writing.title") });
}
