/**
 * The agent runtime's per-step helpers (W10.E30): tool execution with the
 * injection guard and approvals, the system prompt, and the language checks
 * on an output. Moved verbatim out of runtime.ts for the 800-line limit
 * (W6.25); runtime.ts re-exports what it exported.
 */
import type { AgentDefinition, AgentInput, AgentTool, NetworkConsentRequest, RetryPatch, RunOptions, ToolCall, ToolContext } from "./types";
import { toolProtocolPrompt } from "./protocol";
import { hebrewRatio } from "../text/hebrew";
import { formatSchemaErrors, validateSchema } from "./schema";
import { coerceArgs, ToolError } from "./tools/define";
import { approveTaintedWrite, approveUntrusted } from "./ruleOfTwo";

// The injection guard (plan 2.7) loads with the first run: the runtime is on the startup path.

export function isAbort(e: unknown, signal?: AbortSignal): boolean {
  return !!signal?.aborted || (e instanceof DOMException && e.name === "AbortError") || (e as Error)?.name === "AbortError";
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + `… [${s.length - n} more chars]` : s;
}

export interface ToolEnv {
  ctx: ToolContext;
  runId: string;
  agentId: string;
  /** The open document the run's `document` comes from (`docKey.ts`). */
  docKey?: string;
  consent?: RunOptions["consentNetwork"];
  /** Ids of the changes staged in this run, in order. */
  staged: string[];
  /**
   * Where the untrusted content in this run's context came from (plan 2.7);
   * grows as tools read outside content. Non-empty: write and network
   * calls need the user's approval.
   */
  taint: string[];
  /**
   * The run holds the user's own content: the document or selection it was
   * given, or what a tool read from the workspace, the editor or a repo.
   * A network call in a tainted run asks the user only then — an injected
   * page can only exfiltrate what the run has. The researcher's web run
   * holds only the question the user asked to send (`inputMayLeave`) and
   * the pages, until the model reads a note.
   */
  private: boolean;
  consentUntrusted?: RunOptions["consentUntrusted"];
}

/** Tools whose result is the model's own input turned around, not the user's data. */
export const NOT_PRIVATE = new Set(["validate_json", "validate_mermaid", "validate_echarts", "csv_parse"]);

/**
 * Lumen's own network tools whose result is public content only: a web search, a fetched page, and
 * the built-in Sefaria tools (`sefaria_*`, no `offeredBy`). Every other network tool counts as private.
 */
export const PUBLIC_NETWORK = new Set(["fetch_page", "search_web"]);
const SEFARIA_TOOL = /^sefaria_[a-z_]+$/;

/**
 * Whether a call's result can hold the user's own data (the vault, the
 * editor, a repo, whatever an outside server can reach). Fail closed: every
 * tool counts, except those that only turn the model's own input around, a
 * quote check against a page this run fetched, and Lumen's own public
 * network tools (PUBLIC_NETWORK, Sefaria). A tool an outside server offers
 * (MCP, `offeredBy`) always counts, whatever its scope: a stdio server not
 * marked offline is "network" here and can still read the disk (review 12,
 * M4). The trust class of what it read does not matter: a clipped page or
 * an imported PDF in the vault is the user's data.
 */
export function readsUserData(tool: AgentTool, args: Record<string, unknown>): boolean {
  if (tool.offeredBy?.length) return true;
  if (NOT_PRIVATE.has(tool.name)) return false;
  if (tool.scope === "network" && (PUBLIC_NETWORK.has(tool.name) || SEFARIA_TOOL.test(tool.name))) return false;
  if (tool.name === "extract_quotes" && typeof args.url === "string" && args.url.trim() && !(typeof args.path === "string" && args.path.trim())) return false;
  return true;
}

/**
 * Run one tool call under the runtime's rules:
 *  - unknown tools and scopes the run was not granted are refused;
 *  - the arguments must match the tool's JSON Schema (numeric / boolean
 *    strings are coerced first);
 *  - `network` tools pass the network gate (AI policy, per-call consent,
 *    privacy ledger) and get the only fetch they may use;
 *  - `write` tools get a `stage` function and must return its receipt: the
 *    change waits for approval in `staging.ts`, nothing is written;
 *  - cancellation propagates (the run ends `aborted`); every other failure
 *    becomes a tool error the model reads.
 */
export async function execTool(tools: AgentTool[], call: ToolCall, env: ToolEnv): Promise<{ result?: unknown; error?: string; note?: string; untrusted?: string[] }> {
  const tool = tools.find((t) => t.name === call.name);
  if (!tool) return { error: `Unknown tool "${call.name}". Available: ${tools.map((t) => t.name).join(", ")}` };
  if (tool.scope !== "read" && !env.ctx.grants.has(tool.scope)) return { error: `Tool "${call.name}" needs the "${tool.scope}" permission, which was not granted for this run` };
  const args = coerceArgs(call.args && typeof call.args === "object" ? call.args : {}, tool.parameters);
  const invalid = validateSchema(args, tool.parameters);
  if (invalid.length) return { error: `bad-args: ${formatSchemaErrors(invalid)}` };
  const callCtx: ToolContext = { ...env.ctx, stage: undefined, fetch: undefined };
  let note: string | undefined;
  const stagedHere: string[] = [];
  try {
    if (env.ctx.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const tainted = env.taint.length > 0;
    if (tool.scope === "network") {
      const { openNetworkGate } = await import("./network");
      // With untrusted content in the run the gate always asks: the
      // local-only per-call consent (which then carries the warning) or,
      // under the other policies, the untrusted-content approval.
      const guard = tainted && env.private ? { untrusted: [...env.taint], approve: (req: NetworkConsentRequest) => approveUntrusted(env, tool, args, req) } : undefined;
      const gate = await openNetworkGate(tool, { ...call, args }, env.consent, guard);
      callCtx.fetch = gate.fetch;
      callCtx.network = gate.bound;
      note = gate.consented ? (tainted ? "network: sent on the user's approval (untrusted content in the run)" : "network: sent on the user's consent (local-only)") : "network: allowed by the AI policy";
    } else if (tool.scope === "write") {
      // Plan 2.7 / W1.33: a tainted run's write waits for the user's yes (ruleOfTwo.ts).
      if (tainted) {
        const approval = await approveTaintedWrite(env, tool, args);
        if (approval.error !== undefined) return { error: approval.error };
        note = approval.note;
      }
      const { stageChange, receiptOf, textFingerprint } = await import("./staging");
      callCtx.stage = (proposal) => {
        // A range's offsets refer to the document the run received: record which text,
        // and which open document, that was.
        const staged =
          proposal.kind === "range"
            ? { ...proposal, basis: proposal.basis ?? textFingerprint(env.ctx.document ?? ""), docKey: proposal.docKey ?? env.docKey }
            : proposal;
        const change = stageChange(staged, { tool: tool.name, runId: env.runId, agentId: env.agentId });
        stagedHere.push(change.id);
        env.staged.push(change.id);
        return receiptOf(change);
      };
    }
    const result = await tool.run(args, callCtx);
    if (tool.scope === "write") {
      const { isStagedReceipt } = await import("./staging");
      if (!isStagedReceipt(result) || !stagedHere.includes(result.changeId)) throw new ToolError("failed", `"${tool.name}" did not return its staged change; nothing was written`);
      note = `${note ? `${note}; ` : ""}staged ${stagedHere.join(", ")} (waiting for approval)`;
    }
    let untrusted: string[] = [];
    if (tool.untrusted) {
      try {
        untrusted = await tool.untrusted(args, result, callCtx);
      } catch {
        // Can't tell where it came from: treat it as outside content.
        untrusted = [`${tool.name} result`];
      }
    }
    // A read of the user's own data (a note, the document, a repo) is now in the run —
    // whatever its trust class: an imported PDF in the vault is outside text AND the
    // user's data (audit r3, W11.I2). Fail closed: every non-network tool counts.
    if (readsUserData(tool, args)) env.private = true;
    return { result, note, untrusted };
  } catch (e) {
    // A failed call may still have read the user's data (its error text, a partial result): fail closed.
    if (readsUserData(tool, args)) env.private = true;
    if (isAbort(e, env.ctx.signal)) throw e;
    // A write tool that failed after staging withdraws its proposal.
    if (stagedHere.length) {
      const { rejectStagedChange } = await import("./staging");
      for (const id of stagedHere) {
        rejectStagedChange(id);
        env.staged.splice(env.staged.indexOf(id), 1);
      }
    }
    if (e instanceof ToolError) return { error: `${e.code}: ${e.message}` };
    if ((e as Error)?.name === "PrivacyBlockedError") return { error: `blocked: ${(e as Error).message}. Answer without the web, or tell the user that web research needs their consent.` };
    return { error: (e as Error)?.message ?? String(e) };
  }
}

/**
 * The tools a model may call itself. A streaming agent's tools serve only
 * as its context calls (`context`): its answer streams token by token, and
 * a tool turn would have to be parsed whole first.
 */
export function modelTools(def: AgentDefinition<never, unknown>): AgentTool[] {
  return def.streaming ? [] : (def.tools ?? []);
}

export function systemPrompt<I extends AgentInput, O>(def: AgentDefinition<I, O>, input: I, nativeTools: boolean, patch: RetryPatch): string {
  const base = patch.systemOverride ?? (typeof def.system === "function" ? def.system(input) : def.system);
  const parts = [base];
  const offered = modelTools(def);
  if (offered.length && !nativeTools) parts.push(toolProtocolPrompt(offered, def.outputSchema));
  // The schema stays in the prompt even when the executor constrains the
  // output natively: web-llm's JSON mode requires the prompt to ask for
  // JSON (otherwise it can emit whitespace to the token limit), and a
  // native-tools model needs to know the shape of its final answer.
  else if (def.outputSchema) parts.push("Reply with JSON only (no prose, no code fences) matching this schema: " + JSON.stringify(def.outputSchema));
  const lang = languageInstruction(def, input);
  if (lang) parts.push(lang);
  return parts.join("\n\n");
}

export function inputTextOf<I extends AgentInput>(def: AgentDefinition<I, unknown>, input: I): string {
  try {
    return input.text ?? def.user(input);
  } catch {
    return input.text ?? "";
  }
}

/**
 * "Answer in the language of the input" (T27): every prompt says it, for
 * local and cloud models alike, because small local models drift into
 * English on Hebrew input.
 */
export function languageMode<I extends AgentInput>(def: AgentDefinition<I, unknown>, input: I): "input" | "any" {
  const l = def.language ?? "input";
  return typeof l === "function" ? l(input) : l;
}

export function languageInstruction<I extends AgentInput>(def: AgentDefinition<I, unknown>, input: I): string | null {
  if (languageMode(def, input) === "any") return null;
  const text = inputTextOf(def, input);
  if (hebrewRatio(text) >= 0.5) return "The user's text is in Hebrew. Write every natural-language part of your answer in Hebrew (keep code, URLs, file names and JSON keys as they are).";
  return "Write every natural-language part of your answer in the same language as the user's text.";
}

/**
 * The script check behind it: a mostly-Hebrew input must not get a
 * mostly-Latin answer. Short answers (under 20 letters) and non-Hebrew
 * inputs pass — they say too little to judge. Code (fenced blocks, inline
 * code spans, HTML tags) is not prose and does not count.
 */
export function sameScript(inputText: string, output: unknown): { ok: true } | { ok: false; reason: string; hint: string } {
  if (hebrewRatio(inputText) < 0.5) return { ok: true };
  const raw = typeof output === "string" ? output : JSON.stringify(output ?? "").replace(/"[\w$-]+":/g, " ");
  const text = raw
    .replace(/```[\s\S]*?(?:```|$)/g, " ")
    .replace(/~~~[\s\S]*?(?:~~~|$)/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/<\/?[A-Za-z][^<>]*>/g, " ");
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length < 20) return { ok: true };
  const r = hebrewRatio(text);
  if (r >= 0.15) return { ok: true };
  return { ok: false, reason: `the input is Hebrew but the answer is ${Math.round(r * 100)}% Hebrew`, hint: "Answer in Hebrew, the language of the user's text." };
}

export const LANGUAGE_NAMES: Record<string, string> = { he: "Hebrew", en: "English", ar: "Arabic", ru: "Russian", fr: "French", de: "German", ja: "Japanese", zh: "Chinese", es: "Spanish", it: "Italian", pt: "Portuguese", nl: "Dutch", uk: "Ukrainian", fa: "Persian", tr: "Turkish", pl: "Polish" };
export const languageName = (tag: string) => LANGUAGE_NAMES[tag] ?? tag;

/**
 * The language check (plan 6.5): `sameScript` first; then, where input and
 * answer share a script (French in, English out), local language
 * identification decides. It acts only when both texts are long enough for
 * a confident guess, so a short or mixed answer is never rejected on it.
 */
export async function sameLanguage(inputText: string, output: unknown): Promise<{ ok: true } | { ok: false; reason: string; hint: string }> {
  const script = sameScript(inputText, output);
  if (!script.ok || hebrewRatio(inputText) >= 0.5) return script;
  const raw = typeof output === "string" ? output : JSON.stringify(output ?? "").replace(/"[\w$-]+":/g, " ");
  let detect: typeof import("../text/langId").detectLanguage;
  try {
    ({ detectLanguage: detect } = await import("../text/langId"));
  } catch {
    return { ok: true }; // the detector chunk failed to load: keep the script check only
  }
  const a = detect(inputText);
  const b = detect(raw);
  if (!a.confident || !b.confident || a.lang === "und" || b.lang === "und" || a.lang === b.lang || a.script !== b.script) return { ok: true };
  return { ok: false, reason: `the input is ${languageName(a.lang)} but the answer is ${languageName(b.lang)}`, hint: `Answer in ${languageName(a.lang)}, the language of the user's text.` };
}

/** A short stable key of an agent's input: a retry patch is bound to it. */
export function inputKeyOf<I extends AgentInput>(def: AgentDefinition<I, unknown>, input: I): string {
  let text: string;
  try {
    text = def.id + "\u0000" + def.user(input);
  } catch {
    text = def.id + "\u0000" + (input.text ?? "");
  }
  // FNV-1a, 32 bit, plus the length: enough to tell inputs of one command apart.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(36)}-${text.length.toString(36)}`;
}
