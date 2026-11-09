/**
 * Lumen local agents — shared types.
 *
 * An *agent* is a definition: what to ask the model, which tools it may
 * call, what shape the answer must have and how to check it. The *runtime*
 * (`runtime.ts`) runs a definition against an *executor* (Ollama, in-browser
 * WebGPU, …): it loops over tool calls, parses and validates the answer,
 * and when there is no usable answer it asks the *critic* (`critic.ts`)
 * what to change for a retry or what to suggest to the user.
 *
 * The model only proposes; tools execute; validators decide.
 */

/** A JSON Schema object (draft 7 subset is enough for every executor). */
export type JsonSchema = Record<string, unknown>;

/** What a tool may touch. Write and network tools need an explicit grant. */
export type ToolScope = "read" | "write" | "net";

export interface ToolContext {
  signal?: AbortSignal;
  /** Workspace path of the active document, when there is one. */
  path?: string | null;
  /** The active document's full text (editor state, not the file on disk). */
  document?: string;
  /** The current editor selection. */
  selection?: string;
  /** Scopes the caller granted for this run. */
  grants: ReadonlySet<ToolScope>;
}

export interface AgentTool<A = Record<string, unknown>, R = unknown> {
  name: string;
  description: string;
  parameters: JsonSchema;
  scope: ToolScope;
  run(args: A, ctx: ToolContext): Promise<R>;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** A message as executors see it: text, plus tool calls and tool results. */
export interface ExecutorMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Assistant turn that requested tools. */
  toolCalls?: ToolCall[];
  /** Tool turn: which call this answers. */
  toolCallId?: string;
  /** Tool turn: the tool's name. */
  name?: string;
}

export type ModelTier = "tiny" | "small" | "medium" | "large";

export const MODEL_TIERS: readonly ModelTier[] = ["tiny", "small", "medium", "large"];

export interface ExecutorRequest {
  messages: ExecutorMessage[];
  /** Tools the model may call this turn. */
  tools?: AgentTool[];
  /** When set, the answer must be JSON matching this schema. */
  schema?: JsonSchema;
  /** Pins a model; otherwise the executor picks one for `tier`. */
  model?: string;
  tier?: ModelTier;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  /** Receives text deltas when the executor can stream. */
  onDelta?: (chunk: string) => void;
  /**
   * Charges the run's quota prompt (idempotent). The runtime calls it
   * before a native local executor's request; the chat adapter hands it to
   * chat(), which calls it at dispatch, after its key and rate-limit checks.
   */
  charge?: () => void;
}

export interface ExecutorUsage {
  inputTokens: number;
  outputTokens: number;
  estimated: boolean;
}

export interface ExecutorResponse {
  content: string;
  toolCalls: ToolCall[];
  model: string;
  usage?: ExecutorUsage;
}

export type ExecutorId = "ollama" | "webllm" | "transformers" | "chat";

export interface Availability {
  available: boolean;
  /** Stable reason code when unavailable (`ollama-offline`, `no-webgpu`, `cors`, …). */
  reason?: string;
  detail?: string;
}

export interface Executor {
  id: ExecutorId;
  label: string;
  available(): Promise<Availability>;
  chat(req: ExecutorRequest): Promise<ExecutorResponse>;
  /** Native tool calling (otherwise the runtime uses the JSON-ReAct protocol). */
  supportsTools(model?: string): boolean;
  /** Native JSON-schema constrained output. */
  supportsSchema(model?: string): boolean;
  /**
   * The model the executor would use for a tier (and, when the agent calls
   * tools, one that supports them natively if the device has one).
   */
  modelFor(tier: ModelTier, opts?: { tools?: boolean }): string;
}

export interface AgentInput {
  /** The main text the agent works on (document, selection, diff…). */
  text?: string;
  /** Workspace path of the document, when relevant. */
  path?: string | null;
  selection?: string;
  /** UI locale, so prompts can ask for the user's language. */
  locale?: string;
  /** Agent-specific extras (target language, instructions…). */
  extra?: Record<string, unknown>;
}

export type ValidationResult = { ok: true } | { ok: false; reason: string; hint?: string };

export interface Validator<O> {
  name: string;
  check(output: O, input: AgentInput): ValidationResult | Promise<ValidationResult>;
}

/** One change the critic proposes for a retry. */
export interface RetryPatch {
  model?: string;
  tier?: ModelTier;
  temperature?: number;
  /** Appended to the user message (e.g. the validator's error). */
  promptSuffix?: string;
  /** Replaces the system prompt for the retry. */
  systemOverride?: string;
  /** Try another executor. */
  executor?: ExecutorId;
}

export type SuggestionAction =
  | { type: "retry"; patch: RetryPatch }
  | { type: "pull-model"; executor: ExecutorId; model: string }
  | { type: "switch-executor"; executor: ExecutorId }
  | { type: "set-policy"; policy: "local-only" | "local-first" | "cloud" }
  | { type: "open-docs"; key: string }
  | { type: "split-input" };

export interface Suggestion {
  id: string;
  /** i18n key for the title (the UI translates it) — or plain text when `raw`. */
  title: string;
  /** Title/detail are plain text (the model critic writes them), not i18n keys. */
  raw?: boolean;
  /** i18n key for the detail; `params` fill its placeholders. */
  detail?: string;
  params?: Record<string, string | number>;
  action?: SuggestionAction;
}

export interface AgentDefinition<I extends AgentInput = AgentInput, O = string> {
  id: string;
  /** Palette command this agent backs, for traces. */
  commandId?: string;
  description: string;
  system: string | ((input: I) => string);
  user: (input: I) => string;
  tools?: AgentTool[];
  /** JSON output; the executor constrains it when it can. */
  outputSchema?: JsonSchema;
  /** Turns the model's final text into the output (default: JSON when a schema is set, else trimmed text). */
  parse?: (text: string, input: I) => O;
  validators?: Validator<O>[];
  /** Executors to try, in order. Default: the runtime's policy order. */
  executorPreference?: ExecutorId[];
  tier?: ModelTier;
  maxSteps?: number;
  /** Retries after a failed validation (default 2). Interactive agents set 0. */
  maxRetries?: number;
  temperature?: number;
  maxTokens?: number;
  /** Stream deltas to the caller (text agents). */
  streaming?: boolean;
  /** Scopes this agent needs beyond `read`. */
  requires?: ToolScope[];
  /**
   * Reuse an identical earlier answer from the local response cache (and
   * store this one once it validated). Only for deterministic
   * transformations of the given input; the user can turn the cache off.
   */
  cache?: boolean;
}

export type StepKind = "model" | "tool" | "validate" | "retry" | "critic" | "cache";

export interface AgentStep {
  kind: StepKind;
  at: number;
  ms: number;
  /** Tool name, validator name, retry reason… */
  label: string;
  ok: boolean;
  detail?: string;
}

export type RunStatus = "ok" | "failed" | "aborted";

export interface AgentRun<O = unknown> {
  id: string;
  agentId: string;
  commandId?: string;
  executor: ExecutorId | null;
  model: string | null;
  startedAt: number;
  endedAt: number;
  status: RunStatus;
  output?: O;
  /** Stable code when failed (`no-executor`, `validation`, `parse`, `tool`, `aborted`, `error`). */
  errorCode?: string;
  error?: string;
  attempts: number;
  steps: AgentStep[];
  suggestions: Suggestion[];
  tokens: { input: number; output: number; estimated: boolean };
  /** Key of the input (agent + user prompt): a retry picked in the panel applies to this input. */
  inputKey?: string;
}

export interface RunOptions {
  signal?: AbortSignal;
  /** Scopes granted for this run (`read` is always granted). */
  grants?: ToolScope[];
  /** Editor context for the editor tools. */
  document?: string;
  selection?: string;
  path?: string | null;
  onDelta?: (chunk: string) => void;
  onStep?: (step: AgentStep) => void;
  /** Force an executor (the suggestions panel uses it). */
  executor?: ExecutorId;
  /** Apply a critic patch from the start (a retry the user asked for). */
  patch?: RetryPatch;
  /**
   * A non-palette request that pays for itself (see ChatOptions.ownPrompt):
   * counted against the monthly quota here, never billed to a waiting
   * palette command. `"silent"`: no toast when the quota is spent.
   */
  ownPrompt?: boolean | "silent";
}
