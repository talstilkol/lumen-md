/**
 * Runaway guard for agent tool loops (R12.18).
 *
 * from talstilkol/tasker (owner's code): src/autopilot/guard.js (TK-E6) and
 * the hash-not-text rule of src/autopilot/ledger.js (TK-E5) @ a696fd2.
 * Adapted, not copied byte for byte: TypeScript; FNV-1a instead of
 * node:crypto so it runs in the browser; a repeated identical tool call is a
 * signal of its own (an agent loop has no "files changed" to watch); the
 * verdict reasons are in English.
 *
 * The response is graded, as in tasker: notify → pause → require_approval →
 * block. The runtime stops the run at `pause` and above, and only notes a
 * `notify` in the trace.
 *
 *   same tool call (name + normalised args) twice in a run   notify
 *   same tool call `sameCallMax` times (default 3)           pause
 *   same error `sameErrorMax` times (default 3)              pause
 *   tokens × `tokenGrowth` with no new tool call             require_approval
 *   a token or time cap passed                               block
 *
 * The log keeps a hash and the size of the prompt, never its text.
 */

export type GuardAction = "ok" | "notify" | "pause" | "require_approval" | "block";
const LEVEL: Record<GuardAction, number> = { ok: 0, notify: 1, pause: 2, require_approval: 3, block: 4 };

export interface GuardVerdict {
  action: GuardAction;
  reason?: string;
  at?: string;
}

export interface GuardConfig {
  sameErrorMax: number;
  sameCallMax: number;
  tokenGrowth: number;
}
export const DEFAULT_GUARD: GuardConfig = { sameErrorMax: 3, sameCallMax: 3, tokenGrowth: 3 };

/** FNV-1a 32-bit, twice with different offsets: a 16-hex key, stable across runs and engines. */
export function stableHash(s: string): string {
  const one = (seed: number) => {
    let h = seed >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  };
  return one(0x811c9dc5) + one(0x050c5d1f);
}

/** tasker's normalizeError: numbers, paths, hex and shas out, then a hash, so the same error has one key. */
export function normalizeError(s: unknown): string {
  const n = String(s ?? "")
    .replace(/(?:[A-Za-z]:)?(?:[\w.-]*\/)+[\w.-]+/g, "<path>")
    .replace(/0x[0-9a-f]+/gi, "<hex>")
    .replace(/\b[0-9a-f]{7,40}\b/g, "<sha>")
    .replace(/\d+(\.\d+)?/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return stableHash(n).slice(0, 12);
}

/** JSON with sorted keys, so {a,b} and {b,a} are the same call. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v) ?? "null";
}

export const callKey = (name: string, args: unknown) => stableHash(`${name}\u0000${canonical(args)}`).slice(0, 12);

export interface GuardLogEntry {
  action: GuardAction;
  reason: string;
  at: string;
}

export interface RunGuard {
  /** After each tool call (or model turn): the strongest verdict it triggers. */
  observe(o: { error?: string | null; call?: { name: string; args: unknown }; tokens?: number }): GuardVerdict;
  worst(): GuardAction;
  /** The log of this run: the prompt by hash and size only, and every verdict above ok. */
  log(prompt: string): { promptHash: string; promptChars: number; events: GuardLogEntry[] };
}

export function createRunGuard({ caps = {}, cfg = DEFAULT_GUARD, now = Date.now }: { caps?: { tokensPerRun?: number; minutesPerRun?: number }; cfg?: GuardConfig; now?: () => number } = {}): RunGuard {
  const started = now();
  const errors = new Map<string, number>();
  const calls = new Map<string, number>();
  const events: GuardLogEntry[] = [];
  let tokens = 0;
  let tokensAtLastNewCall = 0;
  const verdict = (action: GuardAction, reason: string): GuardVerdict => {
    const v = { action, reason, at: new Date(now()).toISOString() };
    events.push(v);
    return v;
  };
  return {
    observe({ error = null, call, tokens: t = 0 }) {
      tokens += t || 0;
      const out: GuardVerdict[] = [];
      if (caps.tokensPerRun && tokens > caps.tokensPerRun) out.push(verdict("block", `token budget passed: ${tokens}/${caps.tokensPerRun}`));
      if (caps.minutesPerRun && now() - started > caps.minutesPerRun * 60_000) out.push(verdict("block", `time budget passed: ${Math.round((now() - started) / 60_000)}/${caps.minutesPerRun} min`));
      if (error) {
        const h = normalizeError(error);
        const n = (errors.get(h) ?? 0) + 1;
        errors.set(h, n);
        if (n >= cfg.sameErrorMax) out.push(verdict("pause", `the same error ${n} times`));
      }
      if (call) {
        const k = callKey(call.name, call.args);
        const n = (calls.get(k) ?? 0) + 1;
        calls.set(k, n);
        if (n === 1) tokensAtLastNewCall = tokens;
        if (n >= cfg.sameCallMax) out.push(verdict("pause", `the same ${call.name} call ${n} times`));
        else if (n === 2) out.push(verdict("notify", `the same ${call.name} call again`));
      } else if (t && tokensAtLastNewCall > 0 && tokens >= cfg.tokenGrowth * tokensAtLastNewCall) {
        // A model turn: tokens keep growing while no new tool call is made.
        out.push(verdict("require_approval", `tokens ×${(tokens / tokensAtLastNewCall).toFixed(1)} with no new tool call`));
      }
      return out.sort((a, b) => LEVEL[b.action] - LEVEL[a.action])[0] ?? { action: "ok" };
    },
    worst: () => events.reduce<GuardAction>((w, e) => (LEVEL[e.action] > LEVEL[w] ? e.action : w), "ok"),
    log: (prompt) => ({ promptHash: stableHash(prompt), promptChars: prompt.length, events: events.map((e) => ({ ...e })) }),
  };
}

/** Does this verdict stop the run? */
export const stops = (v: GuardVerdict) => LEVEL[v.action] >= LEVEL.pause;
