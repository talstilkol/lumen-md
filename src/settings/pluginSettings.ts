/**
 * Settings that plugins add to the settings search (plan W13.E4).
 *
 * A plugin calls `api.registerSetting({ id, label, description?, keywords?,
 * open })` from `activate`; the settings screen finds it like a core setting
 * and, when the person picks it, closes and calls `open()` so the plugin
 * shows its own view. The entry goes when the plugin is deactivated or the
 * returned function is called. `lumen://settings/plugin:<plugin>/<id>` opens
 * it too.
 *
 * A label or description is a string (the plugin's language) or one string
 * per locale code ({ en: "…", he: "…" }); every one is searchable, the active
 * locale's is shown. No imports: the plugin system and the screen load it alone.
 */

export type Localized = string | Readonly<Record<string, string>>;

export interface PluginSettingDef {
  /** Unique within the plugin: letters, digits, `.`, `-`, `_`. */
  id: string;
  label: Localized;
  description?: Localized;
  /** Extra words the search should know (synonyms, the old name). */
  keywords?: readonly string[];
  /** Show the plugin's own settings view for this entry. */
  open: () => void;
}

export interface RegisteredPluginSetting extends PluginSettingDef {
  pluginId: string;
  pluginName?: string;
}

const registry = new Map<string, RegisteredPluginSetting>();
const listeners = new Set<() => void>();
const ID = /^[A-Za-z0-9._-]{1,80}$/;

function changed(): void {
  for (const l of listeners) l();
}

/** Register a plugin's setting; returns the function that removes it. Throws on a malformed id or label. */
export function registerPluginSetting(pluginId: string, def: PluginSettingDef, pluginName?: string): () => void {
  if (!ID.test(def.id) || !ID.test(pluginId)) throw new Error(`registerSetting: bad id "${pluginId}/${def.id}"`);
  const labels = typeof def.label === "string" ? [def.label] : Object.values(def.label ?? {});
  if (!labels.some((l) => typeof l === "string" && l.trim())) throw new Error(`registerSetting: "${def.id}" needs a label`);
  if (typeof def.open !== "function") throw new Error(`registerSetting: "${def.id}" needs open()`);
  const key = `${pluginId}/${def.id}`;
  const entry: RegisteredPluginSetting = { ...def, keywords: def.keywords ? [...def.keywords] : undefined, pluginId, pluginName };
  registry.set(key, entry);
  changed();
  return () => {
    if (registry.get(key) === entry) {
      registry.delete(key);
      changed();
    }
  };
}

/** Remove every setting of a plugin (on deactivate). */
export function unregisterPluginSettings(pluginId: string): void {
  let any = false;
  for (const [k, v] of registry) if (v.pluginId === pluginId) any = registry.delete(k) || any;
  if (any) changed();
}

/** The registered settings, in registration order. */
export function pluginSettings(): RegisteredPluginSetting[] {
  return [...registry.values()];
}

/** The plugin setting a `plugin:<plugin>/<id>` id names. */
export function findPluginSetting(id: string): RegisteredPluginSetting | undefined {
  return registry.get(id.replace(/^plugin:/, ""));
}

/** Called when the list changes (the open settings screen re-indexes). */
export function onPluginSettingsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
