/**
 * Autonomous Agent Framework for Lumen IDE.
 *
 * Agents can read/write workspace files, run multi-step plans,
 * and interact with the LLM to accomplish complex tasks.
 */

import { chat, chatStream } from "./llm";
import { log } from "../lib/logger";
import {
  readWorkspaceFile,
  writeWorkspaceFile,
  listWorkspace,
  isOPFSAvailable,
} from "../storage/workspace";
import { showAiToast } from "../ui/AiToast";

/* ─── Agent Types ───────────────────────────────────────────────── */

export interface AgentResult {
  success: boolean;
  summary: string;
  /** Files that were modified. */
  modifiedFiles: string[];
  /** The generated content (for template/refactor). */
  output?: string;
}

/* ─── Refactor Agent ────────────────────────────────────────────── */

const REFACTOR_PROMPT =
  "You are an expert document restructuring agent. The user will give you a markdown " +
  "document and instructions on how to refactor it. Output ONLY the complete refactored " +
  "markdown document, nothing else. Preserve all information but improve structure, " +
  "headings, formatting, and organization as instructed.";

/**
 * Refactor an entire document based on AI instructions.
 * Reads the file, sends it to the LLM with instructions, and writes back.
 */
export async function refactorDocument(
  filePath: string,
  instructions: string,
): Promise<AgentResult> {
  if (!isOPFSAvailable()) {
    return { success: false, summary: "Workspace not available", modifiedFiles: [] };
  }

  try {
    const content = await readWorkspaceFile(filePath);
    showAiToast(t("toast.refactoringDocument"), "info");

    const refactored = await chat([
      { role: "system", content: REFACTOR_PROMPT },
      {
        role: "user",
        content: `Instructions: ${instructions}\n\n---\n\nDocument:\n${content}`,
      },
    ]);

    await writeWorkspaceFile(filePath, refactored);
    showAiToast(t("toast.documentRefactoredSuccessfully"), "success");

    return {
      success: true,
      summary: `Refactored ${filePath} according to: "${instructions}"`,
      modifiedFiles: [filePath],
      output: refactored,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    showAiToast(t("toast.refactorFailed", { msg }), "error");
    return { success: false, summary: msg, modifiedFiles: [] };
  }
}

/* ─── Template Agent ────────────────────────────────────────────── */

const TEMPLATE_PROMPT =
  "You are a document template generator. Based on the user's description, " +
  "create a complete, well-structured markdown document with proper headings, " +
  "sections, placeholder content, and formatting. Output ONLY the markdown, " +
  "nothing else. Make it professional and comprehensive.";

/**
 * Generate a new document from a template description.
 */
export async function generateTemplate(
  fileName: string,
  description: string,
): Promise<AgentResult> {
  if (!isOPFSAvailable()) {
    return { success: false, summary: "Workspace not available", modifiedFiles: [] };
  }

  try {
    showAiToast(t("toast.generatingTemplate"), "info");

    const content = await chat([
      { role: "system", content: TEMPLATE_PROMPT },
      { role: "user", content: description },
    ]);

    const path = fileName.endsWith(".md") ? fileName : `${fileName}.md`;
    await writeWorkspaceFile(path, content);
    showAiToast(t("toast.templateCreated", { path }), "success");

    return {
      success: true,
      summary: `Created ${path} from template: "${description}"`,
      modifiedFiles: [path],
      output: content,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    showAiToast(t("toast.templateFailed", { msg }), "error");
    return { success: false, summary: msg, modifiedFiles: [] };
  }
}

/* ─── Organize Agent ────────────────────────────────────────────── */

const ORGANIZE_PROMPT =
  "You are a file organization assistant. Given a list of filenames, " +
  "suggest a folder structure by outputting a JSON array where each item " +
  "has { \"from\": \"current_path\", \"to\": \"suggested_path\" }. " +
  "Group related files into folders like 'notes/', 'projects/', 'journal/', etc. " +
  "Output ONLY the JSON array.";

export interface OrganizeSuggestion {
  from: string;
  to: string;
}

/**
 * Suggest file organization using AI.
 * Returns suggestions but does NOT move files (user must approve).
 */
export async function suggestOrganization(): Promise<OrganizeSuggestion[]> {
  if (!isOPFSAvailable()) return [];

  try {
    const list = await listWorkspace({ includeAssets: false });
    const filePaths = list.map((e) => e.path).join("\n");

    const result = await chat([
      { role: "system", content: ORGANIZE_PROMPT },
      { role: "user", content: `Files:\n${filePaths}` },
    ]);

    // Parse JSON response
    const cleaned = result
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();

    return JSON.parse(cleaned) as OrganizeSuggestion[];
  } catch (e) {
    log.error("organization suggestion failed", e);
    return [];
  }
}

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
export async function suggestTags(content: string): Promise<string[]> {
  const existing = await collectExistingTags();
  const { runAgentOrThrow } = await import("../agents/runtime");
  const { taggerAgent, normalizeTags } = await import("../agents/defs");
  const out = await runAgentOrThrow(taggerAgent, { text: content, extra: { existing } }, { document: content });
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
    ? (existingMatch[1].match(/[a-z][a-z0-9-]+/gi) ?? []).map((t) => t.toLowerCase())
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

export type { LinkSuggestion } from "../agents/defs/linker";
import type { LinkSuggestion } from "../agents/defs/linker";
import { t } from "../i18n";

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
): Promise<LinkSuggestion[]> {
  const { catalog, titles } = await collectNotesCatalog(currentPath);
  if (!catalog) return [];
  const { runAgentOrThrow } = await import("../agents/runtime");
  const { linkerAgent, filterLinks } = await import("../agents/defs");
  const out = await runAgentOrThrow(linkerAgent, { text: content, path: currentPath, extra: { catalog, titles } }, { document: content, path: currentPath });
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

/* ─── Streaming Document Writer ─────────────────────────────────── */

/**
 * Stream-write a new document. Yields chunks for live preview.
 */
export async function* streamDocument(
  description: string,
): AsyncGenerator<string, void, undefined> {
  const stream = chatStream([
    { role: "system", content: TEMPLATE_PROMPT },
    { role: "user", content: description },
  ]);

  for await (const chunk of stream) {
    yield chunk;
  }
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
export async function generateDiagram(text: string): Promise<string> {
  const { runAgentOrThrow } = await import("../agents/runtime");
  const { diagrammerAgent } = await import("../agents/defs");
  const mermaid = await runAgentOrThrow(diagrammerAgent, { text }, { document: text });
  return "```mermaid\n" + mermaid + "\n```";
}

/** Extract action items from meeting notes as a Markdown task list (the `tasker` agent). */
export async function extractActionItems(text: string): Promise<string> {
  const { runAgentOrThrow } = await import("../agents/runtime");
  const { taskerAgent } = await import("../agents/defs");
  return runAgentOrThrow(taskerAgent, { text }, { document: text });
}

/**
 * Translate a Markdown document into the target language through the
 * `translator` agent, chunk by chunk for long documents (code fences are
 * never split). Each chunk must keep its fences and URLs and be written
 * in the target language's script before it is accepted.
 */
export async function translateMarkdown(text: string, targetLanguage: string): Promise<string> {
  const { runAgentOrThrow } = await import("../agents/runtime");
  const { translatorAgent, chunkMarkdown } = await import("../agents/defs");
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
    const translated = await runAgentOrThrow(translatorAgent, { text: body, extra: { targetLanguage } }, { document: text });
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
export async function generateChart(data: string): Promise<string> {
  const { runAgentOrThrow } = await import("../agents/runtime");
  const { charterAgent } = await import("../agents/defs");
  const option = await runAgentOrThrow(charterAgent, { text: data }, { document: data });
  return "```chart\n" + JSON.stringify(option, null, 2) + "\n```";
}
