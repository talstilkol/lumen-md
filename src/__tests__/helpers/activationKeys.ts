/**
 * The activation strings (W13.I5, W13.I7): every literal t("…") key of the
 * first-run screens, the guided tour and the setup flow, plus the menus,
 * toolbar, view modes and the palette's own words.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../../..");
export const ACTIVATION_FILES = ["src/onboarding/FirstRun.tsx", "src/ui/OnboardingTour.tsx", "src/onboarding/setup.ts"];
export const ACTIVATION_PREFIXES = /^(group|toolbar|mode|palette|locale|onboard|tour)\./;

export function activationKeys(en: Record<string, string>): string[] {
  const keys = new Set<string>();
  for (const f of ACTIVATION_FILES) for (const m of readFileSync(join(ROOT, f), "utf8").matchAll(/\bt\(\s*"([\w.-]+)"/g)) keys.add(m[1]);
  for (const k of Object.keys(en)) if (ACTIVATION_PREFIXES.test(k)) keys.add(k);
  return [...keys].filter((k) => k in en).sort();
}

/** A value that is the same in every language: product names, symbols, WYSIWYG. */
export const SAME_EVERYWHERE = /^(?:[\s\d\p{P}\p{S}←→↔↕✓]*|(?:Notion|Evernote|Apple Notes|Google Keep|OneNote|Obsidian|Git|WYSIWYG|LTR ←|RTL →))$/u;
