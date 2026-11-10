/**
 * The AI commands' entry points (T55: one AI system). Every helper here runs
 * one of the agents in ./defs through the agent runtime — local executors
 * first, validated output, the critic on failure — and takes an AbortSignal
 * so Esc can cancel it. The old prompt-only framework (src/ai/agents.ts:
 * refactor / template / organize / stream, unused) is gone.
 */

import "../ai/mt/strings";
import {
  readWorkspaceFile,
  listWorkspace,
  isOPFSAvailable,
} from "../storage/workspace";

/* ─── Auto-tag agent (P3-01) ────────────────────────────────────── */

/**
 * Pull every existing tag in the workspace by scanning frontmatter `tags:`
 * across every note. Used to keep AI suggestions consistent with the user's
 * vocabulary (no fresh "ml" when "machine-learning" already exists).
 */
async function collectExistingTags(): Promise<string[]> {
  if (!isOPFSAvailable()) return [];
  const list = await listWorkspace({ includeAssets: false });
  const counts = new Map<string, number>();
  for (const f of list) {
    if (!/\.(md|markdown)$/i.test(f.path)) continue;
    let body: string;
    try {
      body = await readWorkspaceFile(f.path);
    } catch {
      continue;
    }
    const fm = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm) continue;
    const tagLine = fm[1].match(/^tags\s*:\s*(.+)$/m);
    if (!tagLine) continue;
    // Accept either YAML flow (`tags: [a, b]`) or block (`tags: ["a","b"]`)
    // or comma-separated; split on separators and keep Unicode word tokens
    // (Hebrew tags are tags too).
    const tokens = tagLine[1].match(/[\p{L}][\p{L}\p{N}-]+/gu) ?? [];
    for (const t of tokens) {
      const k = t.toLowerCase();
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  // Sort by frequency descending so the prompt sees the most-used first.
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
}

/**
 * Propose tags for a markdown body through the `tagger` agent (local
 * executors first, validated JSON, retries with the critic's feedback).
 * Existing workspace tags are injected so proposals stay consistent with
 * the user's vocabulary. Throws AgentRunError (with suggestions) when
 * there is no usable answer.
 */
export async function suggestTags(content: string, signal?: AbortSignal): Promise<string[]> {
  const existing = await collectExistingTags();
  const { runAgentOrThrow } = await import("./runtime");
  const { taggerAgent, normalizeTags } = await import("./defs");
  const out = await runAgentOrThrow(taggerAgent, { text: content, extra: { existing } }, { document: content, signal });
  return normalizeTags(out.tags);
}

/**
 * Merge the suggested tags into the document's YAML frontmatter, preserving
 * any existing `tags:` array. Returns the updated markdown source.
 */
export function mergeTagsIntoFrontmatter(content: string, tags: string[]): string {
  if (tags.length === 0) return content;
  const fm = content.match(/^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n)/);
  const block = fm ? fm[2] : "";
  const existingMatch = block.match(/^tags\s*:\s*(.+)$/m);
  const existing = existingMatch
    ? (existingMatch[1].match(/[\p{L}][\p{L}\p{N}-]+/gu) ?? []).map((t) => t.toLowerCase())
    : [];
  const merged = Array.from(new Set([...existing, ...tags]));
  const tagsLine = `tags: [${merged.map((t) => JSON.stringify(t)).join(", ")}]`;
  if (fm) {
    const newBlock = existingMatch
      ? block.replace(/^tags\s*:.*$/m, tagsLine)
      : `${block.replace(/\s*$/, "")}\n${tagsLine}`;
    return content.replace(fm[0], `${fm[1]}${newBlock}${fm[3]}`);
  }
  // No frontmatter yet — prepend a fresh block.
  return `---\n${tagsLine}\n---\n\n${content}`;
}

/* ─── Link-suggestion agent (P3-01) ─────────────────────────────── */

export type { LinkSuggestion } from "./defs/linker";
import type { LinkSuggestion } from "./defs/linker";

/** Build a compact catalogue of every note in the workspace for the prompt, and the list of titles. */
async function collectNotesCatalog(currentPath: string): Promise<{ catalog: string; titles: string[] }> {
  if (!isOPFSAvailable()) return { catalog: "", titles: [] };
  const list = await listWorkspace({ includeAssets: false });
  const lines: string[] = [];
  const titles: string[] = [];
  for (const f of list) {
    if (f.path === currentPath) continue;
    if (!/\.(md|markdown)$/i.test(f.path)) continue;
    let body: string;
    try {
      body = await readWorkspaceFile(f.path);
    } catch {
      continue;
    }
    // Skip frontmatter and grab the first non-empty paragraph.
    const stripped = body.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
    const firstSentence = (stripped.split(/\n\n/)[0] ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
    const title = f.name.replace(/\.(md|markdown)$/i, "");
    titles.push(title);
    lines.push(`- ${title} — ${firstSentence}`);
    if (lines.length >= 60) break;
  }
  return { catalog: lines.join("\n"), titles };
}

/**
 * Where to insert wiki-links in the current note, through the `linker`
 * agent. The catalogue of other notes is injected; only suggestions that
 * quote the body verbatim and target a listed note survive.
 */
export async function suggestLinks(
  currentPath: string,
  content: string,
  signal?: AbortSignal,
): Promise<LinkSuggestion[]> {
  const { catalog, titles } = await collectNotesCatalog(currentPath);
  if (!catalog) return [];
  const { runAgentOrThrow } = await import("./runtime");
  const { linkerAgent, filterLinks } = await import("./defs");
  const out = await runAgentOrThrow(linkerAgent, { text: content, path: currentPath, extra: { catalog, titles } }, { document: content, path: currentPath, signal });
  return filterLinks(out.links, content, titles);
}

/**
 * Apply a single link suggestion: replace the first occurrence of `phrase`
 * with `[[target|phrase]]`. Idempotent — already-linked phrases are skipped.
 */
export function applyLinkSuggestion(
  content: string,
  suggestion: LinkSuggestion,
): string {
  // Skip when the phrase is already inside a wiki-link or markdown link.
  const wiki = new RegExp(
    `\\[\\[[^\\]]*${escapeRe(suggestion.phrase)}[^\\]]*\\]\\]`,
  );
  if (wiki.test(content)) return content;
  const md = new RegExp(`\\[${escapeRe(suggestion.phrase)}\\]\\(`);
  if (md.test(content)) return content;
  // First-occurrence replacement. We anchor with a word-boundary only on
  // the sides where the phrase actually starts/ends with a word character —
  // otherwise the boundary anchor can't bind (e.g. a phrase ending in `)`
  // is sandwiched between two non-word chars and `\b` matches neither).
  const phrase = suggestion.phrase;
  const startsWord = /^\w/.test(phrase);
  const endsWord = /\w$/.test(phrase);
  const left = startsWord ? "\\b" : "";
  const right = endsWord ? "\\b" : "";
  const re = new RegExp(`${left}${escapeRe(phrase)}${right}`);
  if (!re.test(content)) return content;
  return content.replace(re, `[[${suggestion.target}|${phrase}]]`);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ─── Content-generation helpers (diagram / action items / translate) ─ */

/** Strip a single pair of surrounding ``` fences a model may have added. */
export function stripCodeFences(s: string): string {
  return s
    .replace(/^\s*```[a-zA-Z]*\s*\n?/, "")
    .replace(/\n?```\s*$/, "")
    .trim();
}

/**
 * Turn prose into a Mermaid diagram through the `diagrammer` agent (the
 * diagram is compiled before it is accepted). Returns a ready-to-insert
 * fenced ```mermaid block.
 */
export async function generateDiagram(text: string, signal?: AbortSignal): Promise<string> {
  const { runAgentOrThrow } = await import("./runtime");
  const { diagrammerAgent } = await import("./defs");
  const mermaid = await runAgentOrThrow(diagrammerAgent, { text }, { document: text, signal });
  return "```mermaid\n" + mermaid + "\n```";
}

/** Extract action items from meeting notes as a Markdown task list (the `tasker` agent). */
export async function extractActionItems(text: string, signal?: AbortSignal): Promise<string> {
  const { runAgentOrThrow } = await import("./runtime");
  const { taskerAgent } = await import("./defs");
  return runAgentOrThrow(taskerAgent, { text }, { document: text, signal });
}

/**
 * Translate a Markdown document into the target language through the
 * `translator` agent, chunk by chunk for long documents (code fences are
 * never split). Each chunk must keep its fences and URLs and be written
 * in the target language's script before it is accepted.
 */
export async function translateMarkdown(text: string, targetLanguage: string, signal?: AbortSignal): Promise<string> {
  return (await translateMarkdownDetailed(text, targetLanguage, signal)).text;
}

export interface TranslationOutcome {
  text: string;
  /** The local layer that translated (plan 6.4), or "llm" for the translator agent. */
  layer: "chrome" | "opus" | "m2m100" | "llm";
  /** The local layer's quality on this pair is not measured yet. */
  unmeasured: boolean;
  /** Why each local layer did not run (i18n keys, or "declined"), when the agent translated. */
  reasons: Partial<Record<"chrome" | "opus" | "m2m100", string>>;
}

/**
 * Local translation first (plan 6.4): the document's language from local
 * detection (plan 6.5), then Chrome's Translator, Opus-MT or M2M100 with
 * consent; the LLM translator agent only when no local layer can take the
 * pair, or the document's language cannot be told.
 */
export async function translateMarkdownDetailed(text: string, targetLanguage: string, signal?: AbortSignal): Promise<TranslationOutcome> {
  const reasons: TranslationOutcome["reasons"] = {};
  try {
    const [{ detectLanguage, languageCode }, { translateLocally }, { proseOf }, { uiConfirm }, { t, getLocale }] = await Promise.all([
      import("../text/langId"),
      import("../ai/mt"),
      import("./defs/translator"),
      import("../ui/PromptDialog"),
      import("../i18n"),
    ]);
    const target = languageCode(targetLanguage);
    const source = detectLanguage(proseOf(text));
    if (target && source.confident && source.lang !== "und" && source.lang !== target) {
      const r = await translateLocally(text, { source: source.lang, target }, { confirm: uiConfirm, t, locale: getLocale() }, { signal, detect: (p) => detectLanguage(p) });
      if (r.layer) return { text: r.text, layer: r.layer, unmeasured: r.unmeasured, reasons: {} };
      Object.assign(reasons, r.reasons);
    } else if (target) {
      reasons.opus = "mt.layer.sourceUnknown";
    }
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    // A local layer that broke mid-way is reported and the agent takes over.
    reasons.opus = "mt.layer.failed";
  }
  return { text: await translateWithAgent(text, targetLanguage, signal), layer: "llm", unmeasured: false, reasons };
}

/** The toasts after a translation (plan 6.4): which layer did it, and why the local ones did not when the agent had to. */
export function translationToasts(r: TranslationOutcome, t: (k: string, v?: Record<string, string | number>) => string): Array<[string, "info" | "success"]> {
  const out: Array<[string, "info" | "success"]> = [];
  const layer = t(`mt.layer.name.${r.layer}`);
  if (r.layer === "llm" && Object.keys(r.reasons).length) {
    const why = Object.entries(r.reasons)
      .map(([id, reason]) => `${t(`mt.layer.name.${id}`)}: ${reason === "declined" ? t("mt.layer.declined") : t(reason as string)}`)
      .join(" · ");
    out.push([t("toast.localMtUnavailable", { why }), "info"]);
  }
  out.push([r.unmeasured ? t("toast.translatedWithUnmeasured", { layer }) : t("toast.translatedWith", { layer }), "success"]);
  return out;
}

/** The LLM translator agent, chunk by chunk (layer 3b). */
async function translateWithAgent(text: string, targetLanguage: string, signal?: AbortSignal): Promise<string> {
  const { runAgentOrThrow } = await import("./runtime");
  const { translatorAgent, chunkMarkdown } = await import("./defs");
  const out: string[] = [];
  for (const chunk of chunkMarkdown(text)) {
    if (!chunk.trim()) {
      out.push(chunk);
      continue;
    }
    // The model's answer is trimmed; the blank lines around each chunk are
    // the document's paragraph breaks, so they are put back as they were.
    const lead = /^\s*/.exec(chunk)?.[0] ?? "";
    const trail = /\s*$/.exec(chunk)?.[0] ?? "";
    const body = chunk.slice(lead.length, chunk.length - trail.length);
    const translated = await runAgentOrThrow(translatorAgent, { text: body, extra: { targetLanguage } }, { document: text, signal });
    out.push(lead + translated.trim() + trail);
  }
  return out.join("\n").trim();
}

/**
 * Turn CSV/table data into an ECharts option through the `charter` agent
 * (series, data and axes are checked before it is accepted). Returns a
 * ready-to-insert fenced ```chart block, which the renderer's EChart block
 * picks up.
 */
export async function generateChart(data: string, signal?: AbortSignal): Promise<string> {
  const { runAgentOrThrow } = await import("./runtime");
  const { charterAgent } = await import("./defs");
  const option = await runAgentOrThrow(charterAgent, { text: data }, { document: data, signal });
  return "```chart\n" + JSON.stringify(option, null, 2) + "\n```";
}
