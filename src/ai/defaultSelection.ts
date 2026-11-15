/**
 * Plan W11.I12 — the measured default model per RAM tier, as
 * `npm run models:select` wrote it (models/default-selection.json, from
 * public or held-out eval cards). Until a Mac run measures the candidates,
 * the 8 GB tier keeps qwen2.5:7b and the 4 GB tier has none.
 */
import selection from "../../models/default-selection.json";

export interface TierChoice {
  model: string | null;
  reason: string;
  numbers?: Record<string, number>;
}

const TIERS = selection.tiers as unknown as Record<string, TierChoice>;

/** The tiers, smallest first. */
export const SELECTION_TIERS: readonly number[] = Object.keys(TIERS)
  .map(Number)
  .sort((a, b) => a - b);

/**
 * The default for a machine with `ramGB` of memory: the choice of the largest
 * tier that fits it. Never a tier above the device's memory; null when no
 * tier that fits has a choice. Unknown memory counts as 8 GB.
 */
export function measuredDefault(ramGB: number | null | undefined): TierChoice & { tier: number } | null {
  const ram = ramGB ?? 8;
  for (const tier of [...SELECTION_TIERS].reverse()) {
    if (tier > ram) continue;
    const c = TIERS[String(tier)];
    if (c?.model) return { ...c, tier };
  }
  return null;
}
