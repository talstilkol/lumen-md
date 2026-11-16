/**
 * The Hebrew checker through the app's service (src/ai/hebrewSpellService.ts,
 * plan 6.2, 7.8, W10.E35): its worker with the bundled frequency list and,
 * once installed, Hspell's word list. Each item's findings on the sentence
 * and on its clean side go back as offsets only.
 */
import { DICTIONARY_CHANGED_EVENT, checkHebrew } from "../ai/hebrewSpellService";

const spans = async (text: string | null) => (text == null ? null : (await checkHebrew(text)).map((m) => ({ offset: m.offset, length: m.length })));

export async function checkItem(input: unknown): Promise<{ text: unknown; clean: unknown }> {
  const { text, clean } = input as { text: string; clean: string | null };
  return { text: await spans(text), clean: await spans(clean) };
}

/** Start the worker and wait for its frequency list: checks made before it arrives have no spelling hints. */
export function frequencyListLoaded(timeoutMs = 60_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("the frequency list did not load")), timeoutMs);
    window.addEventListener(DICTIONARY_CHANGED_EVENT, () => (clearTimeout(t), resolve()), { once: true });
    void checkHebrew("שלום");
  });
}
