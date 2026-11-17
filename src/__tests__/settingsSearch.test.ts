/**
 * W13.E4 — settings search and keyboard navigation (Obsidian 1.13).
 *
 * - The index: core settings, tabs and plugins' settings; labels and
 *   keywords in the active language and English, niqqud- and accent-blind
 *   (W13.E3's fold).
 * - 20 golden queries (10 Hebrew, 10 English): the right setting first.
 * - Every one of the 8 languages finds the theme by its own words.
 * - The plugin API (`api.registerSetting`), deep links (lumen://settings/<id>),
 *   ⌘, in the shortcut table.
 * - The screen: a combobox + listbox; ↓/↑ move, Enter opens the setting with
 *   its control focused, Esc clears, ⌘F comes back to the field.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

vi.mock("../ui/AiToast", () => ({ showAiToast: vi.fn() }));

import { buildSettingsIndex, keywordKey, parseSettingsLink, rankSettings, resolveSettingsTarget, settingsLink, type Translate } from "../settings/settingsSearch";
import { pluginSettings, registerPluginSetting } from "../settings/pluginSettings";
import { registerPlugin, unregisterPlugin } from "../plugins/pluginSystem";
import { SETTINGS } from "../settings/schema";
import { appShortcutFor, SHORTCUTS } from "../lib/shortcuts";
import { SettingsScreen } from "../ui/SettingsScreen";
import { useAppStore } from "../store/useStore";

const ROOT = join(__dirname, "..");
const merge = (dir: string): Record<string, string> =>
  Object.assign({}, ...readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8"))));
const EN: Record<string, string> = { ...merge(join(ROOT, "i18n/lazy")), ...merge(join(ROOT, "i18n/locales/en")) };
const bundle = (lang: string): Translate => {
  const b = merge(join(ROOT, "i18n/locales", lang));
  return (k) => b[k] ?? EN[k] ?? k;
};
const en: Translate = (k) => EN[k] ?? k;
const LANGS = ["en", "he", "ar", "de", "fr", "ja", "ru", "zh-CN"] as const;

const indexFor = (lang: string) => buildSettingsIndex(lang === "en" ? [en] : [bundle(lang), en], { locale: lang, plugins: [] });
const first = (lang: string, q: string) => rankSettings(indexFor(lang), q)[0]?.item.id;

describe("golden queries: the right setting first", () => {
  const GOLDEN: Array<[lang: "he" | "en", query: string, id: string]> = [
    ["en", "dark mode", "theme"],
    ["en", "language", "locale"],
    ["en", "vim", "vimEnabled"],
    ["en", "spelling", "spellCheck"],
    ["en", "autosave", "autoSave"],
    ["en", "font size", "themeSettings"],
    ["en", "right to left", "rtl"],
    ["en", "ollama model", "lumen.ollama.model"],
    ["en", "crash reports", "lumen.telemetry.optOut"],
    ["en", "exif", "lumen.images.keepMetadata"],
    ["he", "מצב כהה", "theme"],
    ["he", "שפה", "locale"],
    ["he", "שָׂפָה", "locale"], // with niqqud (W13.E3)
    ["he", "איות", "spellCheck"],
    ["he", "שמירה אוטומטית", "autoSave"],
    ["he", "גופן", "themeSettings"],
    ["he", "ימין לשמאל", "rtl"],
    ["he", "מכונת כתיבה", "typewriterMode"],
    ["he", "יעד כתיבה", "writingGoalWords"],
    ["he", "מיקום תמונות", "lumen.images.keepMetadata"],
  ];
  it.each(GOLDEN)("[%s] %s → %s", (lang, q, id) => {
    expect(first(lang, q)).toBe(id);
  });

  it("an English word finds the setting in the Hebrew UI, and the result is named in Hebrew", () => {
    const hit = rankSettings(indexFor("he"), "dark mode")[0];
    expect(hit.item.id).toBe("theme");
    expect(hit.item.label).toBe(bundle("he")("themeSettings.title"));
  });

  it("every word must match; a query with no match finds nothing", () => {
    expect(rankSettings(indexFor("en"), "dark zzzz")).toEqual([]);
    expect(rankSettings(indexFor("en"), "zzzz-nothing")).toEqual([]);
  });

  it("finds the tabs too, just below a setting that matches as well", () => {
    const hits = rankSettings(indexFor("en"), "appearance");
    expect(hits.some((h) => h.item.id === "tab:appearance")).toBe(true);
  });
});

describe("all 8 languages", () => {
  it("every locale translates every keyword string (no English left in the bundle)", () => {
    const kw = Object.keys(EN).filter((k) => k.startsWith("settingsSearch.kw."));
    expect(kw.length).toBeGreaterThanOrEqual(25);
    for (const lang of LANGS.filter((l) => l !== "en")) {
      const b = merge(join(ROOT, "i18n/locales", lang));
      const missing = kw.filter((k) => !b[k]);
      expect(missing, lang).toEqual([]);
    }
  });

  it.each(LANGS)("%s: the first keyword of the theme finds the theme", (lang) => {
    const kw = (lang === "en" ? en : bundle(lang))(keywordKey("theme")).split(/[,،、，]/)[0].trim();
    expect(first(lang, kw)).toBe("theme");
  });

  it.each(LANGS)("%s: the label of the language setting finds it", (lang) => {
    const label = (lang === "en" ? en : bundle(lang))("settings.language");
    expect(first(lang, label)).toBe("locale");
  });
});

describe("plugins", () => {
  afterEach(() => {
    for (const p of pluginSettings()) unregisterPlugin(p.pluginId);
  });

  it("a plugin registers a setting through its API; it is found, and goes with the plugin", async () => {
    const open = vi.fn();
    await registerPlugin({
      id: "acme.citations",
      name: "Acme Citations",
      version: "1.0.0",
      activate: (api) => {
        api.registerSetting({ id: "style", label: { en: "Citation style", he: "סגנון ציטוט" }, keywords: ["APA", "Chicago"], open });
      },
    });
    const idx = buildSettingsIndex([bundle("he"), en], { locale: "he" });
    const hit = rankSettings(idx, "chicago")[0];
    expect(hit.item.id).toBe("plugin:acme.citations/style");
    expect(hit.item.label).toBe("סגנון ציטוט");
    expect(hit.item.detail).toBe("Acme Citations");
    expect(rankSettings(idx, "סגנון ציטוט")[0].item.kind).toBe("plugin");
    unregisterPlugin("acme.citations");
    expect(rankSettings(buildSettingsIndex([en], { locale: "en" }), "chicago")).toEqual([]);
  });

  it("refuses a malformed id, an empty label or no open()", () => {
    expect(() => registerPluginSetting("p", { id: "bad id!", label: "x", open: () => {} })).toThrow();
    expect(() => registerPluginSetting("p", { id: "ok", label: "  ", open: () => {} })).toThrow();
    expect(() => registerPluginSetting("p", { id: "ok", label: "x" } as never)).toThrow();
  });

  it("the returned function removes only its own entry", () => {
    const off = registerPluginSetting("p1", { id: "a", label: "Alpha", open: () => {} });
    registerPluginSetting("p1", { id: "b", label: "Beta", open: () => {} });
    off();
    expect(pluginSettings().map((p) => p.id)).toEqual(["b"]);
    unregisterPlugin("p1");
  });
});

describe("deep links and the shortcut", () => {
  it("parses lumen://settings links", () => {
    expect(parseSettingsLink("lumen://settings/theme")).toBe("theme");
    expect(parseSettingsLink("lumen://settings")).toBe("");
    expect(parseSettingsLink("LUMEN://settings/lumen.ollama.model/")).toBe("lumen.ollama.model");
    expect(parseSettingsLink("lumen://settings/plugin:acme/style")).toBe("plugin:acme/style");
    expect(parseSettingsLink("lumen://clip?data=x")).toBeNull();
    expect(parseSettingsLink("https://example.com/settings/theme")).toBeNull();
    for (const e of SETTINGS.filter((x) => x.kind === "setting" && x.label)) expect(parseSettingsLink(settingsLink(e.id))).toBe(e.id);
  });

  it("resolves a link to its tab and the control to focus", () => {
    expect(resolveSettingsTarget("theme")).toEqual({ tab: "general", focus: "theme" });
    expect(resolveSettingsTarget("lumen.ollama.model")).toEqual({ tab: "ai", focus: "lumen.ollama.model" });
    expect(resolveSettingsTarget("tab:privacy")).toEqual({ tab: "privacy" });
    expect(resolveSettingsTarget("")).toEqual({ tab: "general" });
    expect(resolveSettingsTarget("no-such-setting")).toBeNull();
    expect(resolveSettingsTarget("lumen.ai.key.openai")).toBeNull(); // a secret is never a link target
  });

  it("⌘, (Ctrl+, elsewhere) opens the settings, in the Hebrew layout too", () => {
    expect(SHORTCUTS.filter((s) => s.combo === "Mod+,")).toHaveLength(1);
    expect(appShortcutFor({ key: ",", code: "Comma", metaKey: true })).toBe("settings.open");
    expect(appShortcutFor({ key: "ת", code: "Comma", ctrlKey: true })).toBe("settings.open");
    expect(appShortcutFor({ key: ",", code: "Comma" })).toBeNull();
  });
});

describe("the screen: keyboard only", () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState({ vimEnabled: false, spellCheck: true, mode: "split" });
  });
  afterEach(cleanup);

  const search = () => screen.getByTestId("settings-search") as HTMLInputElement;

  it("opens with the field focused; typing shows ranked results as a listbox the field drives", () => {
    render(React.createElement(SettingsScreen, { onClose: () => {} }));
    expect(document.activeElement).toBe(search());
    expect(search().getAttribute("role")).toBe("combobox");
    fireEvent.change(search(), { target: { value: "dark mode" } });
    const list = screen.getByRole("listbox");
    const options = screen.getAllByRole("option");
    expect(options[0].getAttribute("data-result")).toBe("theme");
    expect(search().getAttribute("aria-controls")).toBe(list.id);
    expect(search().getAttribute("aria-activedescendant")).toBe(options[0].id);
    expect(options[0].getAttribute("aria-selected")).toBe("true");
  });

  it("↓ and ↑ move the active option; Enter opens the setting and focuses its control", async () => {
    render(React.createElement(SettingsScreen, { onClose: () => {} }));
    fireEvent.change(search(), { target: { value: "check" } });
    const options = screen.getAllByRole("option");
    expect(options.length).toBeGreaterThan(1);
    fireEvent.keyDown(search(), { key: "ArrowDown" });
    expect(search().getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[1].id);
    fireEvent.keyDown(search(), { key: "ArrowUp" });
    fireEvent.keyDown(search(), { key: "ArrowUp" }); // stays on the first
    const firstId = screen.getAllByRole("option")[0].getAttribute("data-result")!;
    expect(search().getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[0].id);
    fireEvent.keyDown(search(), { key: "Enter" });
    await waitFor(() => expect((document.activeElement as HTMLElement | null)?.getAttribute("data-setting")).toBe(firstId));
    expect(search().value).toBe("");
  });

  it("Enter on a setting of another tab moves there; focus lands in that tab, never on <body>", async () => {
    render(React.createElement(SettingsScreen, { onClose: () => {} }));
    fireEvent.change(search(), { target: { value: "ollama model" } });
    fireEvent.keyDown(search(), { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("settings-tab-ai")).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId("settings-tab-ai").contains(document.activeElement)).toBe(true), { timeout: 2000 });
    expect(document.activeElement).not.toBe(document.body);
  });

  it("Escape clears the search first; ⌘F / Ctrl+F comes back to the field from anywhere", async () => {
    const onClose = vi.fn();
    render(React.createElement(SettingsScreen, { onClose }));
    fireEvent.change(search(), { target: { value: "vim" } });
    fireEvent.keyDown(search(), { key: "Escape" });
    expect(search().value).toBe("");
    expect(onClose).not.toHaveBeenCalled();
    const control = document.querySelector<HTMLElement>('[data-setting="spellCheck"]')!;
    control.focus();
    fireEvent.keyDown(control, { key: "f", code: "KeyF", ctrlKey: true });
    expect(document.activeElement).toBe(search());
  });

  it("no match: says so, as a status", () => {
    render(React.createElement(SettingsScreen, { onClose: () => {} }));
    fireEvent.change(search(), { target: { value: "zzzz-nothing" } });
    expect(screen.getByTestId("settings-results-none").getAttribute("role")).toBe("status");
  });

  it("a deep link's focus opens on the setting with its control focused", async () => {
    render(React.createElement(SettingsScreen, { tab: "general", focus: "vimEnabled", onClose: () => {} }));
    await waitFor(() => expect((document.activeElement as HTMLElement | null)?.getAttribute("data-setting")).toBe("vimEnabled"));
  });
});
