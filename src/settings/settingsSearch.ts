/**
 * Settings search (plan W13.E4, Obsidian 1.13's searchable settings).
 *
 * One index over every setting a person can change:
 *   - the core settings of `schema.ts` that have a label (a tab's own
 *     dialog edits the rest);
 *   - the settings tabs themselves ("Appearance" finds the tab);
 *   - what plugins register through `registerPluginSetting` (pluginSettings.ts).
 *
 * Each entry is searched by its label, its keywords (`settingsSearch.kw.<id>`:
 * synonyms and a short description, translated like any UI string), the
 * names of its choices and its tab — in the active language AND in English,
 * so "dark" finds the theme in a Hebrew UI and "מצב כהה" in an English one
 * when the Hebrew bundle is loaded. Matching goes through the filter fold
 * (W13.E3): niqqud, accents, case and geresh do not count.
 *
 * Ranking, per query word, best field wins: the whole label (100), the label
 * starts with it (80), a word of the label does (60), the label contains it
 * (40); keywords score 0.75 of that, the tab name and the choices 0.3, the
 * stored key 0.25. Every word must match somewhere; a query that matches
 * the label as one phrase gets a bonus. Ties: the shorter label, then the
 * schema's order. Pure: the screen and the tests share it.
 */

import { normalizeForFilter } from "../text/filterMatch";
import { SETTINGS, SETTINGS_TABS, type SettingEntry, type SettingsTab } from "./schema";
import { pluginSettings, type RegisteredPluginSetting } from "./pluginSettings";

export type SettingsHitKind = "setting" | "tab" | "plugin";

export interface SettingsIndexEntry {
  kind: SettingsHitKind;
  /** The setting's id (schema id, `tab:<id>`, or `plugin:<plugin>/<id>`). */
  id: string;
  /** The tab that edits it (plugins: undefined; they open their own view). */
  tab?: SettingsTab;
  /** What the result shows, in the active language. */
  label: string;
  /** Under the label: the tab's name, or the plugin's. */
  detail: string;
  /** Folded search fields (see the weights above). */
  fields: { label: string[]; keywords: string[]; context: string[]; key: string[] };
  /** Schema order, for stable ties. */
  order: number;
  /** The core entry, for the screen. */
  entry?: SettingEntry;
  plugin?: RegisteredPluginSetting;
}

export interface SettingsHit {
  item: SettingsIndexEntry;
  score: number;
}

/** A translator: the active language's `t`, or English. Returns the key itself when it has no text. */
export type Translate = (key: string) => string;

/** The keywords' i18n key for a setting or a tab. */
export const keywordKey = (id: string) => `settingsSearch.kw.${id}`;

const fold = normalizeForFilter;

/** Translate `key` with every translator; drop missing ones (the key echoed back) and duplicates. */
function texts(key: string | undefined, translators: readonly Translate[]): string[] {
  if (!key) return [];
  const out = new Set<string>();
  for (const tr of translators) {
    const v = tr(key);
    if (v && v !== key) out.add(v);
  }
  return [...out];
}

/** Keyword strings are comma (or ، / 、) separated lists. */
function keywordList(key: string, translators: readonly Translate[]): string[] {
  return texts(key, translators).flatMap((s) => s.split(/[,،、，;]/)).map((s) => s.trim()).filter(Boolean);
}

/**
 * Build the index. `translators[0]` is the active language (it names the
 * results); the rest only add searchable text (English, normally).
 */
export function buildSettingsIndex(
  translators: readonly Translate[],
  opts: { locale?: string; plugins?: readonly RegisteredPluginSetting[] } = {},
): SettingsIndexEntry[] {
  const extra = opts.plugins ?? pluginSettings();
  const locale = opts.locale ?? "en";
  const [active] = translators;
  const tabName = (tab: SettingsTab | undefined) => {
    const t = SETTINGS_TABS.find((x) => x.id === tab);
    return t ? active(t.label) : "";
  };
  const out: SettingsIndexEntry[] = [];
  let order = 0;
  for (const tab of SETTINGS_TABS) {
    out.push({
      kind: "tab",
      id: `tab:${tab.id}`,
      tab: tab.id,
      label: active(tab.label),
      detail: "",
      fields: { label: texts(tab.label, translators).map(fold), keywords: keywordList(keywordKey(`tab.${tab.id}`), translators).map(fold), context: [], key: [fold(tab.id)] },
      order: order++,
    });
  }
  for (const e of SETTINGS) {
    if (e.kind !== "setting" || !e.label || !e.tab) continue;
    const optionTexts = (e.options ?? []).flatMap((o) => (o.label ? texts(o.label, translators) : [o.value]));
    out.push({
      kind: "setting",
      id: e.id,
      tab: e.tab,
      label: active(e.label),
      detail: tabName(e.tab),
      fields: {
        label: texts(e.label, translators).map(fold),
        keywords: keywordList(keywordKey(e.id), translators).map(fold),
        context: [...texts(SETTINGS_TABS.find((x) => x.id === e.tab)?.label, translators), ...optionTexts].map(fold),
        key: [fold(e.id.replace(/^lumen\./, "").replace(/[._-]+/g, " "))],
      },
      order: order++,
      entry: e,
    });
  }
  for (const p of extra) {
    const labels = typeof p.label === "string" ? [p.label] : Object.values(p.label);
    const active0 = typeof p.label === "string" ? p.label : (p.label[locale] ?? p.label.en ?? labels[0] ?? p.id);
    out.push({
      kind: "plugin",
      id: `plugin:${p.pluginId}/${p.id}`,
      label: active0,
      detail: p.pluginName ?? p.pluginId,
      fields: {
        label: labels.map(fold),
        keywords: [...(p.keywords ?? []), ...(p.description === undefined ? [] : typeof p.description === "string" ? [p.description] : Object.values(p.description))].map(fold),
        context: [fold(p.pluginName ?? p.pluginId)],
        key: [fold(p.id)],
      },
      order: order++,
      plugin: p,
    });
  }
  return out;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 100 the whole field, 80 its start, 60 a word's start, 40 inside it, 0 not at all. */
function quality(field: string, w: string): number {
  if (field === w) return 100;
  if (field.startsWith(w)) return 80;
  if (new RegExp(`(^|[^\\p{L}\\p{N}])${escape(w)}`, "u").test(field)) return 60;
  return field.includes(w) ? 40 : 0;
}

const WEIGHTS = { label: 1, keywords: 0.75, context: 0.3, key: 0.25 } as const;

function best(item: SettingsIndexEntry, w: string): number {
  let s = 0;
  for (const f of Object.keys(WEIGHTS) as Array<keyof typeof WEIGHTS>) {
    for (const v of item.fields[f]) {
      const q = quality(v, w) * WEIGHTS[f];
      if (q > s) s = q;
    }
  }
  return s;
}

/** The ranked hits for `query` (all entries, in order, for an empty query). */
export function rankSettings(index: readonly SettingsIndexEntry[], query: string, limit = 50): SettingsHit[] {
  const q = fold(query.trim());
  if (!q) return index.filter((x) => x.kind !== "tab").map((item) => ({ item, score: 0 }));
  const words = q.split(/\s+/).filter(Boolean);
  const hits: SettingsHit[] = [];
  for (const item of index) {
    let score = 0;
    let all = true;
    for (const w of words) {
      const s = best(item, w);
      if (!s) {
        all = false;
        break;
      }
      score += s;
    }
    if (!all) continue;
    score /= words.length;
    // The words as one phrase in the label or the keywords: what was meant, not a scatter.
    if (words.length > 1) {
      const phrase = Math.max(...item.fields.label.map((v) => quality(v, q)), ...item.fields.keywords.map((v) => quality(v, q) * WEIGHTS.keywords), 0);
      score += phrase * 0.5;
    }
    // A tab is a place, not a setting: just below a setting that matches as well.
    if (item.kind === "tab") score -= 1;
    hits.push({ item, score });
  }
  hits.sort((a, b) => b.score - a.score || a.item.label.length - b.item.label.length || a.item.order - b.item.order);
  return hits.slice(0, limit);
}

/* ─── Deep links ────────────────────────────────────────────────────── */

const LINK = /^lumen:\/\/settings(?:\/([^?#]*))?(?:[?#].*)?$/i;

/** `lumen://settings/<id>` → the setting's id (or `tab:<tab>`), `""` for the screen itself; null when it is not a settings link. */
export function parseSettingsLink(url: string): string | null {
  const m = LINK.exec(url.trim());
  if (!m) return null;
  try {
    return decodeURIComponent(m[1] ?? "").replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** The deep link to a setting. */
export function settingsLink(id: string): string {
  return `lumen://settings/${encodeURIComponent(id).replace(/%2F/g, "/")}`;
}

/** Where a link's id opens: the tab, and the setting to focus (if any). */
export function resolveSettingsTarget(id: string): { tab: SettingsTab; focus?: string } | null {
  if (!id) return { tab: "general" };
  const tab = SETTINGS_TABS.find((x) => x.id === id.replace(/^tab:/, ""));
  if (tab) return { tab: tab.id };
  const e = SETTINGS.find((x) => x.id === id && x.kind === "setting" && x.tab);
  if (e?.tab) return { tab: e.tab, focus: e.id };
  if (id.startsWith("plugin:")) return { tab: "general", focus: id };
  return null;
}
