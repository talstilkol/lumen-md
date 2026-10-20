/**
 * The user's AI mode — economy / balanced / quality (`lumen.ai.mode`).
 *
 * One small module with no dependencies, so both the context packer (how
 * much of the notes goes in) and the agent runtime (which local model
 * tier runs, plan 5.7) read the same key without pulling each other in.
 */

export type AiMode = "economy" | "balanced" | "quality";

export const AI_MODES: readonly AiMode[] = ["economy", "balanced", "quality"];

const KEY = "lumen.ai.mode";

/** The user's AI mode; balanced by default. */
export function getAiMode(): AiMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === "economy" || v === "quality" ? v : "balanced";
  } catch {
    return "balanced";
  }
}

export function setAiMode(mode: AiMode): void {
  try {
    if (mode === "balanced") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, mode);
  } catch {
    /* storage denied */
  }
}
