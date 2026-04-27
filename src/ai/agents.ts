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
    showAiToast("Refactoring document...", "info");

    const refactored = await chat([
      { role: "system", content: REFACTOR_PROMPT },
      {
        role: "user",
        content: `Instructions: ${instructions}\n\n---\n\nDocument:\n${content}`,
      },
    ]);

    await writeWorkspaceFile(filePath, refactored);
    showAiToast("Document refactored successfully!", "success");

    return {
      success: true,
      summary: `Refactored ${filePath} according to: "${instructions}"`,
      modifiedFiles: [filePath],
      output: refactored,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    showAiToast(`Refactor failed: ${msg}`, "error");
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
    showAiToast("Generating template...", "info");

    const content = await chat([
      { role: "system", content: TEMPLATE_PROMPT },
      { role: "user", content: description },
    ]);

    const path = fileName.endsWith(".md") ? fileName : `${fileName}.md`;
    await writeWorkspaceFile(path, content);
    showAiToast(`Template "${path}" created!`, "success");

    return {
      success: true,
      summary: `Created ${path} from template: "${description}"`,
      modifiedFiles: [path],
      output: content,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    showAiToast(`Template failed: ${msg}`, "error");
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

const AUTO_TAG_PROMPT =
  "You are a tag-suggestion assistant. The user shares a markdown document " +
  "and a list of tags they already use across their notes. Suggest 3-7 " +
  "concise lowercase-kebab-case tags that capture the document's topic. " +
  "Prefer tags from the existing pool when they fit. Output ONLY a JSON " +
  'array of strings, e.g. ["machine-learning","attention","paper-summary"].';

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
    // or comma-separated; just split on non-word chars and pick lowercase
    // alphanumeric+hyphen tokens.
    const tokens = tagLine[1].match(/[a-z][a-z0-9-]+/gi) ?? [];
    for (const t of tokens) {
      const k = t.toLowerCase();
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  // Sort by frequency descending so the prompt sees the most-used first.
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
}

/**
 * Ask the LLM to propose tags for a markdown body. Uses any tags already
 * in the workspace as a vocabulary hint so the proposals stay consistent.
 */
export async function suggestTags(content: string): Promise<string[]> {
  const existing = await collectExistingTags();
  const trimmed = content.length > 6000 ? content.slice(0, 6000) + "\n…" : content;
  const userMsg =
    `Existing tags in vocabulary (most-used first):\n${existing.slice(0, 80).join(", ") || "(none yet)"}\n\n` +
    `Document:\n${trimmed}`;
  const reply = await chat([
    { role: "system", content: AUTO_TAG_PROMPT },
    { role: "user", content: userMsg },
  ]);
  // Strip any code fence the model might add and parse the JSON array.
  const cleaned = reply.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Fallback: a comma-separated reply.
    parsed = cleaned.split(/[,\n]+/);
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((t) => String(t).trim().toLowerCase().replace(/^#/, "").replace(/[^a-z0-9-]/g, "-"))
    .filter((t) => t.length > 1 && t.length < 40)
    .slice(0, 7);
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

const LINK_SUGGEST_PROMPT =
  "You are a wiki-link suggestion assistant. The user shares the body of a " +
  "markdown note and a list of OTHER notes in their workspace (title + " +
  "first sentence). Identify up to 5 places in the body where adding a " +
  '`[[Note Title]]` link would help the reader. Output ONLY a JSON array ' +
  'of objects with shape { "phrase": "literal text in body", "target": ' +
  '"note title to link to", "reason": "≤ 12 words why" }. The phrase MUST ' +
  "appear verbatim in the body and the target MUST be one of the notes " +
  "listed. Skip anything you're not confident about.";

export interface LinkSuggestion {
  phrase: string;
  target: string;
  reason: string;
}

/** Build a compact catalogue of every note in the workspace for the prompt. */
async function collectNotesCatalog(currentPath: string): Promise<string> {
  if (!isOPFSAvailable()) return "";
  const list = await listWorkspace({ includeAssets: false });
  const lines: string[] = [];
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
    lines.push(`- ${title} — ${firstSentence}`);
    if (lines.length >= 60) break;
  }
  return lines.join("\n");
}

/** Ask the LLM where to insert wiki-links in the current note. */
export async function suggestLinks(
  currentPath: string,
  content: string,
): Promise<LinkSuggestion[]> {
  const catalog = await collectNotesCatalog(currentPath);
  if (!catalog) return [];
  const trimmed = content.length > 5000 ? content.slice(0, 5000) + "\n…" : content;
  const reply = await chat([
    { role: "system", content: LINK_SUGGEST_PROMPT },
    {
      role: "user",
      content: `Current note body:\n${trimmed}\n\nOther notes:\n${catalog}`,
    },
  ]);
  const cleaned = reply.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((s): s is LinkSuggestion => {
      if (!s || typeof s !== "object") return false;
      const x = s as Partial<LinkSuggestion>;
      return (
        typeof x.phrase === "string" &&
        typeof x.target === "string" &&
        typeof x.reason === "string" &&
        x.phrase.length > 1 &&
        x.target.length > 0 &&
        // Sanity: the AI must have copied the phrase verbatim from the body.
        content.includes(x.phrase)
      );
    })
    .slice(0, 5);
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
