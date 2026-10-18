/**
 * Hebrew spelling service (T28): the dictionary download (explicit, once),
 * where it is kept (IndexedDB on this device), and the worker that checks.
 * Without the dictionary the dictionary-free rules still run.
 */
import { get, set, del } from "idb-keyval";
import type { GrammarMatch } from "./grammar";
import { HEBREW_DICT_URL, hebrewRules } from "./hebrewSpell";
import { hebrewRatio } from "../text/hebrew";

const DICT_KEY = "lumen.dict.he.v1";

export async function hebrewDictionaryInstalled(): Promise<boolean> {
  try {
    return typeof (await get<string>(DICT_KEY)) === "string";
  } catch {
    return false;
  }
}

/**
 * Download Hspell's word list (AGPL-3.0, 5.7 MB) to this device. Called only
 * from the user's own command — the app never fetches it by itself.
 */
export async function downloadHebrewDictionary(fetchImpl: typeof fetch = fetch): Promise<number> {
  const res = await fetchImpl(HEBREW_DICT_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (!/^\d+\r?\n/.test(text)) throw new Error("not a hunspell .dic file");
  await set(DICT_KEY, text);
  resetWorker();
  return Number.parseInt(text, 10);
}

export async function removeHebrewDictionary(): Promise<void> {
  await del(DICT_KEY);
  resetWorker();
}

let worker: Worker | null = null;
let ready: Promise<Worker | null> | null = null;
let seq = 0;
const pending = new Map<number, (m: GrammarMatch[]) => void>();

function resetWorker(): void {
  worker?.terminate();
  worker = null;
  ready = null;
}

function startWorker(): Promise<Worker | null> {
  if (ready) return ready;
  ready = (async () => {
    const dic = await get<string>(DICT_KEY).catch(() => undefined);
    if (typeof Worker === "undefined") return null;
    const w = new Worker(new URL("./hebrewSpell.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<{ type: string; id?: number; matches?: GrammarMatch[] }>) => {
      if (e.data.type === "result" && e.data.id !== undefined) {
        pending.get(e.data.id)?.(e.data.matches ?? []);
        pending.delete(e.data.id);
      }
    };
    if (dic) w.postMessage({ type: "load", dic });
    worker = w;
    return w;
  })();
  return ready;
}

/** Check Hebrew text: rules always, spelling once the dictionary is installed. */
export async function checkHebrew(text: string): Promise<GrammarMatch[]> {
  const w = await startWorker().catch(() => null);
  if (!w) return hebrewRules(text);
  const id = ++seq;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    w.postMessage({ type: "check", id, text });
  });
}

/**
 * Split a document by paragraph language (T28): Hebrew paragraphs are
 * checked here, on this device; the others go to `other` (LanguageTool)
 * as the same text with the Hebrew blanked out, so every offset still
 * points into the original (after the leading blank run `other` gets
 * without). LanguageTool has no Hebrew, and the old
 * fixed `en-US` flagged every Hebrew word.
 */
export async function checkByLanguage(
  text: string,
  other: (latinOnly: string) => Promise<GrammarMatch[]>,
): Promise<GrammarMatch[]> {
  const paragraphs = [...text.matchAll(/[^\n]+(?:\n(?!\s*\n)[^\n]+)*/g)];
  let latinOnly = "";
  let cursor = 0;
  const hebrewJobs: Array<Promise<GrammarMatch[]>> = [];
  for (const p of paragraphs) {
    const start = p.index!;
    latinOnly += text.slice(cursor, start);
    if (hebrewRatio(p[0]) >= 0.5) {
      latinOnly += p[0].replace(/[^\n]/g, " ");
      hebrewJobs.push(checkHebrew(p[0]).then((ms) => ms.map((m) => ({ ...m, offset: m.offset + start }))));
    } else latinOnly += p[0].replace(/\p{Script=Hebrew}/gu, " "); // Hebrew words inside a Latin paragraph stay on this device too.
    cursor = start + p[0].length;
  }
  latinOnly += text.slice(cursor);
  // `other` may trim its input (checkGrammar does): send it without the
  // leading blank run and shift its offsets back.
  const lead = latinOnly.length - latinOnly.trimStart().length;
  const [heb, rest] = await Promise.all([
    Promise.all(hebrewJobs).then((r) => r.flat()),
    latinOnly.trim()
      ? other(latinOnly.slice(lead)).then((ms) => ms.map((m) => ({ ...m, offset: m.offset + lead })), () => [] as GrammarMatch[])
      : Promise.resolve([] as GrammarMatch[]),
  ]);
  return [...rest, ...heb].sort((a, b) => a.offset - b.offset);
}
