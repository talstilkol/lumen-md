/**
 * Autonomous Agent Framework for Lumen IDE.
 *
 * Agents can read/write workspace files, run multi-step plans,
 * and interact with the LLM to accomplish complex tasks.
 */

import { chat, chatStream } from "./llm";
import { PROMPTS } from "./prompts";
import type { ChatMessage } from "./llm";
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
    console.error("Organization suggestion failed:", e);
    return [];
  }
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
