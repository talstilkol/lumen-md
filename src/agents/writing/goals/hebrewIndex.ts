/**
 * W13.W14's writing goals read Hebrew readability from W13.W9's calibrated
 * index (src/agents/writing/readability/readability.ts) once both are in:
 * the seam `setReadabilityEngine` was waiting for it (INT7). The goal's
 * level is the index's band; its score is the index's own 1–5 scale. The
 * frequency list (the rare-word feature) is not loaded here: goals are
 * shown in the status bar, and the index stands without it.
 */
import { readability } from "../readability/readability";
import { setReadabilityEngine, type Readability } from "./readability";

/** W9's index as the goals' Hebrew engine (null for a text the index reads as English). */
export function hebrewIndexEngine(text: string): Readability | null {
  const r = readability(text);
  return r.lang === "he" ? { level: r.band, score: r.score, provisional: false, scale: "he5" } : null;
}

setReadabilityEngine(hebrewIndexEngine);
