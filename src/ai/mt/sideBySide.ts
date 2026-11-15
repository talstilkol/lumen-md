/**
 * Side-by-side translation (plan W12.H6): a note and its translation,
 * aligned by paragraph, the translation kept next to the note as
 * `<note>.<lang>.md` with a hash of each source paragraph, so a paragraph
 * whose source changed shows as out of date and only it is translated again.
 *
 * The sidecar is plain Markdown (it opens anywhere):
 *
 *   ---
 *   translation-of: notes/שיעור.md
 *   lang: en
 *   layer: opus
 *   ---
 *   <!-- src:1a2b3c4d -->
 *   The translated first paragraph.
 *
 *   <!-- src:5e6f7a8b -->
 *   The second.
 *
 * Translation goes through the existing layers (./index translateLocally:
 * Chrome's Translator API, Opus-MT, M2M100). No new model. Where Chrome's
 * API is missing (mobile, Firefox, Safari), the next layer is used and the
 * result names the layer, so the view can say which one translated.
 */
import { hash } from "../../srs/cards";

export interface Paragraph {
  text: string;
  hash: string;
}

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/** The note's paragraphs (blank-line separated; frontmatter left out; a code fence is one paragraph). */
export function paragraphsOf(md: string): Paragraph[] {
  const body = md.replace(FRONTMATTER, "");
  const out: string[] = [];
  let cur: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    const t = cur.join("\n").trim();
    if (t) out.push(t);
    cur = [];
  };
  for (const line of body.split(/\r?\n/)) {
    const f = /^\s*(```|~~~)/.exec(line);
    if (fence) {
      cur.push(line);
      if (f && f[1] === fence) {
        fence = null;
        flush();
      }
      continue;
    }
    if (f) {
      flush();
      fence = f[1];
      cur.push(line);
      continue;
    }
    if (!line.trim()) flush();
    else cur.push(line);
  }
  flush();
  return out.map((text) => ({ text, hash: hash(text) }));
}

/** `notes/a.md` → `notes/a.en.md`. */
export function sidecarPath(path: string, lang: string): string {
  return path.replace(/(\.(?:md|markdown))?$/i, `.${lang}.md`);
}

export interface Sidecar {
  of: string;
  lang: string;
  layer: string | null;
  /** Translations by source hash, in sidecar order. */
  entries: Array<{ hash: string; text: string }>;
}

export function parseSidecar(md: string): Sidecar {
  const fm = FRONTMATTER.exec(md)?.[0] ?? "";
  const field = (k: string) => new RegExp(`^${k}:\\s*(.*)$`, "m").exec(fm)?.[1]?.trim() ?? null;
  const entries: Sidecar["entries"] = [];
  const body = md.slice(fm.length);
  const re = /<!-- src:([0-9a-f]{8}) -->\r?\n([\s\S]*?)(?=\r?\n<!-- src:[0-9a-f]{8} -->|$)/g;
  for (const m of body.matchAll(re)) entries.push({ hash: m[1], text: m[2].trim() });
  return { of: field("translation-of") ?? "", lang: field("lang") ?? "", layer: field("layer"), entries };
}

export function serializeSidecar(s: Sidecar): string {
  const head = ["---", `translation-of: ${s.of}`, `lang: ${s.lang}`, ...(s.layer ? [`layer: ${s.layer}`] : []), "---", ""];
  return head.join("\n") + s.entries.map((e) => `<!-- src:${e.hash} -->\n${e.text}`).join("\n\n") + "\n";
}

export interface Row {
  source: Paragraph;
  /** The translation kept for this paragraph, or null. */
  translation: string | null;
  /**
   * "ok": translated from this exact text. "stale": the paragraph at this
   * place was translated from a different text (shown, marked out of date).
   * "missing": never translated.
   */
  state: "ok" | "stale" | "missing";
}

/**
 * Align the note with its sidecar, paragraph by paragraph. A paragraph whose
 * hash is in the sidecar takes that translation; otherwise the translation
 * at the same place, when that place's source is gone, is shown as stale.
 */
export function align(sourceMd: string, sidecar: Sidecar | null): Row[] {
  const paras = paragraphsOf(sourceMd);
  const entries = sidecar?.entries ?? [];
  const byHash = new Map(entries.map((e) => [e.hash, e.text]));
  const current = new Set(paras.map((p) => p.hash));
  return paras.map((p, i) => {
    const exact = byHash.get(p.hash);
    if (exact !== undefined) return { source: p, translation: exact, state: "ok" as const };
    const there = entries[i];
    if (there && !current.has(there.hash)) return { source: p, translation: there.text, state: "stale" as const };
    return { source: p, translation: null, state: "missing" as const };
  });
}

export type TranslateTexts = (texts: string[]) => Promise<{ texts: string[]; layer: string }>;

/**
 * Translate what needs it (stale and missing paragraphs; all of them with
 * `all`) and return the new sidecar and the layer that ran. Paragraphs that
 * are up to date are not sent again.
 */
export async function updateSidecar(sourcePath: string, sourceMd: string, sidecar: Sidecar | null, lang: string, translate: TranslateTexts, opts: { all?: boolean } = {}): Promise<{ sidecar: Sidecar; layer: string | null; translated: number }> {
  const rows = align(sourceMd, sidecar);
  const todo = rows.map((r, i) => ({ r, i })).filter(({ r }) => opts.all || r.state !== "ok");
  let layer = sidecar?.layer ?? null;
  const out = rows.map((r) => (r.state === "ok" ? r.translation! : null));
  if (todo.length) {
    const res = await translate(todo.map(({ r }) => r.source.text));
    layer = res.layer;
    todo.forEach(({ i }, k) => (out[i] = res.texts[k] ?? ""));
  }
  return {
    sidecar: { of: sourcePath, lang, layer, entries: rows.map((r, i) => ({ hash: r.source.hash, text: out[i] ?? "" })) },
    layer,
    translated: todo.length,
  };
}

/**
 * The existing local layers as a TranslateTexts, one paragraph at a time so
 * the alignment holds. The layer is chosen once (translateLocally's
 * ranking: Chrome's Translator API, then Opus-MT, then M2M100); when none
 * can run, the error carries each layer's reason.
 */
export function viaLocalLayers(pair: { source: string; target: string }, consent: import("./localModels").ConsentDeps, opts: import("./index").TranslateOptions = {}): TranslateTexts {
  return async (texts) => {
    const { translateLocally } = await import("./index");
    const out: string[] = [];
    let layer = "";
    for (const text of texts) {
      const r = await translateLocally(text, pair, consent, opts);
      if (r.layer === null) throw Object.assign(new Error("no local translation layer"), { reasons: r.reasons });
      layer ||= r.layer;
      out.push(r.text);
    }
    return { texts: out, layer };
  };
}
