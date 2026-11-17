/**
 * One settings screen (plan 11.1): tabs, search, export / import.
 *
 * - General: the persisted switches and choices, drawn from
 *   `src/settings/schema.ts` (each control writes straight to the store or
 *   localStorage, so a change applies at once).
 * - The other tabs are the existing dialogs (theme, AI with the model
 *   manager, sync and collaboration, training, trusted keys, organization),
 *   rendered in place with `embedded`.
 * - Search matches the labels and keys of every setting, including the
 *   ones inside a tab's dialog, and narrows the tabs to the matching ones.
 *   W13.E4: it ranks them too (settings/settingsSearch.ts: labels and
 *   keywords in the active language and English, niqqud- and accent-blind,
 *   plugins' settings included) in a list driven from the field: ↑/↓, Enter
 *   opens the setting (its tab, the control focused), Esc clears, ⌘F comes
 *   back to the field. ⌘, opens the screen with the field focused;
 *   lumen://settings/<id> opens it on a setting.
 *
 * The whole file is a lazy chunk: App only holds which tab is open.
 */

import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from "react";
import { Settings as SettingsIcon, X, Download, Upload, Search } from "lucide-react";
import { useAppStore, type AppState } from "../store/useStore";
import { SETTINGS, SETTINGS_TABS, type SettingEntry, type SettingsTab } from "../settings/schema";
import { buildSettingsIndex, rankSettings, type SettingsHit } from "../settings/settingsSearch";
import { onPluginSettingsChange } from "../settings/pluginSettings";
import { SettingsResults, optionId } from "./settings/SettingsResults";
import { exportSettings, importSettings, parseSettingsFile, type SettingsTarget } from "../settings/io";
import { downloadText } from "../storage/exportFormats";
import { showAiToast } from "./AiToast";
import { SUPPORTED_LOCALES, getLocale, t, tEnglish, type Locale } from "../i18n";
import { isBetaLocale } from "../i18n/review";
import { localeOptionLabel, openTranslationHelp } from "../i18n/localeLabel";
import "./settingsScreenStrings";
// W10.A10: the tab list names the "Train AI on my style" tab (fineTune.title) before its panel loads,
// so that panel's English travels with this chunk too (FineTuneSettings is only ever opened from here).
import "./fineTuneStrings";
import { HelpButton } from "./HelpButton";
import { SettingsAbout } from "./AccessibilityLinks";
// W5.11: the "keep photo metadata" switch's label ships with this lazy screen.
import "../lib/journalistStrings";
import { Modal } from "./Modal";

const ThemeSettings = lazy(() => import("./ThemeSettings").then((m) => ({ default: m.ThemeSettings })));
const AiSettingsPanel = lazy(() => import("./AiSettingsPanel").then((m) => ({ default: m.AiSettingsPanel })));
const CollabSettings = lazy(() => import("./CollabSettings").then((m) => ({ default: m.CollabSettings })));
const FineTuneSettings = lazy(() => import("./FineTuneSettings").then((m) => ({ default: m.FineTuneSettings })));
const TrustedKeysSettings = lazy(() => import("./TrustedKeysSettings").then((m) => ({ default: m.TrustedKeysSettings })));
const CalendarSettings = lazy(() => import("./settings/CalendarSettings").then((m) => ({ default: m.CalendarSettings })));
const McpServers = lazy(() => import("./settings/McpServers").then((m) => ({ default: m.McpServers })));
const OrgSettings = lazy(() => import("./OrgSettings").then((m) => ({ default: m.OrgSettings })));
const ImageHostsSection = lazy(() => import("./ImageHostsPanel").then((m) => ({ default: m.ImageHostsSection })));
const MonitoringSettings = lazy(() => import("./MonitoringSettings").then((m) => ({ default: m.MonitoringSettings })));
const OpenAlexSwitch = lazy(() => import("../citations/OpenAlexSwitch").then((m) => ({ default: m.OpenAlexSwitch })));

/** Every setting with a label: what an empty search shows. */
const SETTINGS_ENTRIES = SETTINGS.filter((e) => e.kind === "setting" && !!e.label);

/** A settings file is a few KB; anything far larger isn't one. */
const IMPORT_MAX_BYTES = 256 * 1024;

interface Props {
  tab?: SettingsTab;
  /** A setting to focus on open (a deep link, W13.E4): its id, or `plugin:<plugin>/<id>`. */
  focus?: string;
  onClose: () => void;
  onOpenAuditLog?: () => void;
}

/** Store fields whose setter does more than set (direction, lazy locale, sanitising). */
function applyAppPatch(patch: Record<string, unknown>): void {
  const s = useAppStore.getState();
  const rest: Partial<AppState> = {};
  for (const [field, value] of Object.entries(patch)) {
    switch (field) {
      case "theme":
        s.setTheme(value as AppState["theme"]);
        break;
      case "locale":
        s.setLocale(value as Locale);
        break;
      case "themeSettings":
        s.setThemeSettings(value as Partial<AppState["themeSettings"]>);
        break;
      case "dailyNotes": {
        const d = value as Record<string, unknown>;
        const strings = Object.fromEntries(
          (["folder", "pattern", "template"] as const).filter((k) => typeof d[k] === "string").map((k) => [k, d[k] as string]),
        );
        s.setDailyNotes(strings);
        break;
      }
      case "writingGoalWords":
        s.setWritingGoal(value as number);
        break;
      case "mobileToolbar":
        // Unknown or repeated action ids go, as when the store loads (review t5, L2).
        s.setMobileToolbar(value as AppState["mobileToolbar"]);
        break;
      case "enabledSnippets":
        rest.enabledSnippets = [...new Set(value as string[])];
        break;
      case "rtl":
        if (s.rtl !== value) s.toggleRtl();
        break;
      case "showCalendar":
        if (s.showCalendar !== value) s.toggleCalendar();
        break;
      case "useFineTunedModel":
        if (s.useFineTunedModel !== value) s.toggleFineTunedModel();
        break;
      default:
        (rest as Record<string, unknown>)[field] = value;
    }
  }
  if (Object.keys(rest).length) useAppStore.setState(rest);
}

function browserTarget(): SettingsTarget {
  return {
    getApp: () => useAppStore.getState() as unknown as Record<string, unknown>,
    applyApp: applyAppPatch,
    storage: localStorage,
  };
}

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    if (value === "") localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* why: storage denied */
  }
}

export function SettingsScreen({ tab: initialTab = "general", focus, onClose, onOpenAuditLog }: Props) {
  const ids = useId();
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const state = useAppStore();
  // Re-render after a localStorage-backed control changes.
  const [, setLocalVersion] = useState(0);

  // The search index (W13.E4): rebuilt when a plugin adds or removes a setting.
  const [pluginsVersion, setPluginsVersion] = useState(0);
  useEffect(() => onPluginSettingsChange(() => setPluginsVersion((v) => v + 1)), []);
  const index = useMemo(() => buildSettingsIndex([t, tEnglish], { locale: getLocale() }), [pluginsVersion]);
  const hits = useMemo(() => (query.trim() ? rankSettings(index, query) : []), [index, query]);
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [query]);
  // The tabs and the General list narrow to what the ranked search found.
  const { entries, tabs } = useMemo(() => {
    if (!query.trim()) return { entries: SETTINGS_ENTRIES, tabs: new Set<SettingsTab>(SETTINGS_TABS.map((x) => x.id)) };
    const tabs = new Set<SettingsTab>();
    const entries: SettingEntry[] = [];
    for (const h of hits) {
      if (h.item.tab) tabs.add(h.item.tab);
      if (h.item.entry) entries.push(h.item.entry);
    }
    return { entries, tabs };
  }, [hits, query]);
  const visibleTabs = SETTINGS_TABS.filter((x) => tabs.has(x.id));
  const resultsId = `${ids}-results`;
  const panelRef = useRef<HTMLElement>(null);
  /** A setting to focus once its tab has rendered (a picked result or a deep link). */
  const [pendingFocus, setPendingFocus] = useState<string | null>(focus ?? null);

  useEffect(() => {
    if (!focus) searchRef.current?.focus();
  }, [focus]);

  // Focus the picked setting's control when its tab is on screen; the panel itself when the
  // setting lives inside a tab's own dialog (never <body>). A plugin's setting opens its own view.
  useEffect(() => {
    if (!pendingFocus) return;
    if (pendingFocus.startsWith("plugin:")) {
      const p = index.find((x) => x.id === pendingFocus)?.plugin;
      setPendingFocus(null);
      if (p) {
        onClose();
        p.open();
      }
      return;
    }
    let tries = 0;
    const timer = window.setInterval(() => {
      const el = panelRef.current?.querySelector<HTMLElement>(`[data-setting="${CSS.escape(pendingFocus)}"]`);
      if (el || ++tries > 10) {
        window.clearInterval(timer);
        const target = el ?? panelRef.current;
        target?.focus();
        target?.scrollIntoView?.({ block: "center" });
        if (el) {
          el.closest<HTMLElement>("label,div")?.setAttribute("data-flash", "1");
          window.setTimeout(() => el.closest<HTMLElement>("label,div")?.removeAttribute("data-flash"), 1600);
        }
        setPendingFocus(null);
      }
    }, 50);
    return () => window.clearInterval(timer);
  }, [pendingFocus, tab, index, onClose]);

  const openHit = (h: SettingsHit) => {
    if (h.item.kind === "plugin") {
      setPendingFocus(h.item.id);
      return;
    }
    if (h.item.tab) setTab(h.item.tab);
    setQuery("");
    setPendingFocus(h.item.kind === "tab" ? "" : h.item.id);
    if (h.item.kind === "tab") window.setTimeout(() => panelRef.current?.focus(), 0);
  };

  /** The combobox keys, on the field and on the list. */
  const onResultsKey = (e: React.KeyboardEvent) => {
    if (!hits.length) return;
    const last = hits.length - 1;
    const move = (i: number) => {
      e.preventDefault();
      setActive(Math.max(0, Math.min(last, i)));
    };
    if (e.key === "ArrowDown") move(active + 1);
    else if (e.key === "ArrowUp") move(active - 1);
    else if (e.key === "PageDown") move(active + 8);
    else if (e.key === "PageUp") move(active - 8);
    else if ((e.key === "Home" || e.key === "End") && e.currentTarget !== searchRef.current) move(e.key === "Home" ? 0 : last);
    else if (e.key === "Enter") {
      e.preventDefault();
      const h = hits[active];
      if (h) openHit(h);
    }
  };

  // W13.E1: with Vim mode on, the settings move by Vim keys too (Obsidian 1.13).
  const vimKeys = useAppStore((st) => st.vimEnabled);
  const onVimKey = (e: React.KeyboardEvent): boolean => {
    if (!vimKeys || e.metaKey || e.ctrlKey || e.altKey) return false;
    const target = e.target as HTMLElement;
    // Typing stays typing: text fields keep their letters (a select's type-ahead gives way to j / k).
    if (target.matches?.('input:not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable="true"]')) return false;
    if (e.key === "/") {
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
      return true;
    }
    if (e.key !== "j" && e.key !== "k") return false;
    const step = e.key === "j" ? 1 : -1;
    if (target.getAttribute("role") === "listbox") {
      e.preventDefault();
      setActive((i) => Math.max(0, Math.min(hits.length - 1, i + step)));
      return true;
    }
    // In the tab list: the tabs; elsewhere: the controls of the open tab.
    const scope = target.closest('[role="tablist"]') ? '[role="tablist"] [role="tab"]' : '[role="tabpanel"] input, [role="tabpanel"] select, [role="tabpanel"] button';
    const list = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(scope)];
    const at = list.indexOf(target);
    const next = list[at < 0 ? 0 : at + step];
    if (next) {
      e.preventDefault();
      next.focus();
      if (next.getAttribute("role") === "tab") next.click();
      return true;
    }
    return false;
  };

  // ⌘F / Ctrl+F anywhere in the screen: back to the search field (Obsidian 1.13).
  const onScreenKey = (e: React.KeyboardEvent) => {
    if (onVimKey(e)) return;
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.code === "KeyF" || e.key.toLowerCase() === "f")) {
      e.preventDefault();
      e.stopPropagation();
      searchRef.current?.focus();
      searchRef.current?.select();
    }
  };

  // A search that leaves the open tab out moves to the first tab it found.
  useEffect(() => {
    if (!tabs.has(tab) && visibleTabs[0]) setTab(visibleTabs[0].id);
  }, [tabs, tab, visibleTabs]);

  const onImportFile = async (file: File | undefined) => {
    if (!file) return;
    const parsed = file.size <= IMPORT_MAX_BYTES ? parseSettingsFile(await file.text()) : null;
    if (!parsed) {
      showAiToast(t("settings.importFailed"), "error");
      return;
    }
    const { applied, skipped, refused } = importSettings(parsed, browserTarget());
    setLocalVersion((v) => v + 1);
    showAiToast(t("settings.imported", { n: applied, skipped: skipped.length }), "success");
    // An import never loosens privacy (settings/io.ts): name what it left as it was.
    if (refused.length) showAiToast(t("settings.importRefused", { keys: refused.join(", ") }), "info");
  };

  const onExport = () => {
    const file = exportSettings(browserTarget());
    downloadText("lumen-settings.json", `${JSON.stringify(file, null, 2)}\n`, "application/json");
  };

  const general = entries.filter((e) => e.tab === "general" && e.label && e.type !== "json" && e.type !== "list" && e.type !== "text");

  const setEntry = (entry: SettingEntry, value: unknown) => {
    if (entry.store === "app") applyAppPatch({ [entry.id]: value });
    else {
      writeLocal(entry.id, String(value));
      setLocalVersion((v) => v + 1);
    }
  };

  const valueOf = (entry: SettingEntry): unknown =>
    entry.store === "app" ? (state as unknown as Record<string, unknown>)[entry.id] : readLocal(entry.id) ?? "";

  const control = (entry: SettingEntry) => {
    const id = `${ids}-${entry.id}`;
    const value = valueOf(entry);
    const label = t(entry.label ?? entry.id);
    if (entry.type === "boolean") {
      const [off, on] = entry.values ?? [false, true];
      return (
        <label key={entry.id} htmlFor={id} style={row}>
          <input
            id={id}
            type="checkbox"
            checked={value === on}
            data-setting={entry.id}
            onChange={(e) => setEntry(entry, e.target.checked ? on : off)}
          />
          <span>{label}</span>
        </label>
      );
    }
    if (entry.type === "choice") {
      // Languages a native speaker has not reviewed yet are marked beta (plan W4.18, launch P0 #16).
      const optionLabel = (o: { value: string; label?: string }) => {
        if (o.label) return t(o.label);
        return entry.id === "locale" ? localeOptionLabel(o.value) : (SUPPORTED_LOCALES.find((l) => l.code === o.value)?.label ?? o.value);
      };
      const select = (
        <label key={entry.id} htmlFor={id} style={row}>
          <span style={{ flex: 1 }}>{label}</span>
          <select id={id} value={String(value)} data-setting={entry.id} onChange={(e) => setEntry(entry, e.target.value)} style={input}>
            {(entry.options ?? []).map((o) => (
              <option key={o.value} value={o.value}>
                {optionLabel(o)}
              </option>
            ))}
          </select>
        </label>
      );
      if (entry.id !== "locale") return select;
      const linkBtn = { border: "none", background: "none", padding: 0, color: "hsl(var(--accent))", cursor: "pointer", textDecoration: "underline", font: "inherit" } as const;
      const beta = isBetaLocale(String(value));
      return (
        <div key={entry.id}>
          {select}
          <p data-testid={beta ? "locale-beta-note" : "locale-beta-hint"} style={{ margin: "2px 0 8px", fontSize: 12, color: "hsl(var(--fg-muted))" }}>
            {beta ? t("locale.betaNote") : t("locale.betaHint")}{" "}
            {beta && (
              <>
                <button type="button" data-testid="locale-suggest" onClick={() => void import("./TranslationSuggest").then((m) => m.openTranslationSuggest())} style={linkBtn}>
                  {t("cmd.i18n.suggest")}
                </button>
                {" · "}
              </>
            )}
            <button type="button" data-testid="locale-beta-help" onClick={openTranslationHelp} style={linkBtn}>
              {t("locale.betaHelp")}
            </button>
          </p>
        </div>
      );
    }
    return (
      <label key={entry.id} htmlFor={id} style={row}>
        <span style={{ flex: 1 }}>{label}</span>
        <input
          id={id}
          type="number"
          min={entry.min}
          max={entry.max}
          value={Number(value) || 0}
          data-setting={entry.id}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) setEntry(entry, entry.store === "app" ? n : String(n));
          }}
          style={{ ...input, width: 96 }}
        />
      </label>
    );
  };

  const panel = () => {
    switch (tab) {
      case "general":
        // empty-action: the settings search field (clearing it shows every setting)
        return general.length ? <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>{general.map(control)}</div> : <p style={muted}>{t("settings.empty")}</p>;
      case "appearance":
        return <ThemeSettings open embedded onClose={onClose} />;
      case "ai":
        return <AiSettingsPanel open embedded onClose={onClose} />;
      case "calendar":
        return <CalendarSettings />;
      case "mcp":
        return <McpServers />;
      case "sync":
        return <CollabSettings embedded onClose={onClose} />;
      case "fineTune":
        return <FineTuneSettings open embedded onClose={onClose} />;
      case "privacy":
        return (
          <>
            <ImageHostsSection />
            <OpenAlexSwitch />
          </>
        );
      case "security":
        return (
          <>
            <TrustedKeysSettings open embedded onClose={onClose} />
            <Suspense fallback={null}>
              <MonitoringSettings />
            </Suspense>
          </>
        );
      case "org":
        return <OrgSettings open embedded onClose={onClose} onOpenAuditLog={onOpenAuditLog} />;
    }
  };

  return (
    <Modal aria-labelledby={`${ids}-title`} onClose={onClose} className="cmd-palette-backdrop" onClick={onClose}>
      <div
        className="cmd-palette"
        data-testid="settings-screen"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onScreenKey}
        style={{ width: "min(920px, 96vw)", maxWidth: 920, maxHeight: "90vh", height: "90vh", padding: 0, display: "flex", flexDirection: "column" }}
      >
        <header style={header}>
          <SettingsIcon size={16} aria-hidden="true" />
          <h2 id={`${ids}-title`} style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
            {t("settings.title")}
          </h2>
          <HelpButton topic="editor/settings" />
          <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, minWidth: 120 }}>
            <Search size={14} aria-hidden="true" style={{ color: "hsl(var(--fg-muted))" }} />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && query) {
                  // Clear first; a second Escape closes the screen.
                  e.preventDefault();
                  e.stopPropagation();
                  setQuery("");
                  return;
                }
                onResultsKey(e);
              }}
              placeholder={t("settings.search")}
              aria-label={t("settings.search")}
              role="combobox"
              aria-expanded={!!query.trim() && hits.length > 0}
              aria-controls={resultsId}
              aria-autocomplete="list"
              aria-activedescendant={query.trim() && hits.length ? optionId(resultsId, active) : undefined}
              data-testid="settings-search"
              style={{ ...input, flex: 1 }}
            />
          </div>
          <button type="button" style={secondaryBtn} onClick={onExport}>
            <Download size={13} aria-hidden="true" /> {t("themeSettings.export")}
          </button>
          <button type="button" style={secondaryBtn} onClick={() => fileRef.current?.click()}>
            <Upload size={13} aria-hidden="true" /> {t("themeSettings.import")}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            data-testid="settings-import-input"
            onChange={(e) => {
              void onImportFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <button type="button" onClick={onClose} aria-label={t("ai.settings.close")} style={iconBtn}>
            <X size={14} />
          </button>
        </header>
        {query.trim() && <SettingsResults id={resultsId} hits={hits} query={query} active={active} onActive={setActive} onOpen={openHit} onKeyDown={onResultsKey} />}
        <div style={{ display: "flex", flex: 1, minHeight: 0, flexWrap: "wrap" }}>
          <nav role="tablist" aria-orientation="vertical" aria-label={t("settings.title")} style={nav}>
            {visibleTabs.map((x) => (
              <button
                key={x.id}
                type="button"
                role="tab"
                id={`${ids}-tab-${x.id}`}
                aria-selected={tab === x.id}
                aria-controls={`${ids}-panel`}
                data-tab={x.id}
                onClick={() => setTab(x.id)}
                style={tab === x.id ? { ...tabBtn, ...tabActive } : tabBtn}
              >
                {t(x.label)}
              </button>
            ))}
            {/* empty-action: the settings search field above (clearing it shows every tab) */}
            {!visibleTabs.length && <p style={{ ...muted, padding: 8 }}>{t("settings.empty")}</p>}
          </nav>
          <section
            ref={panelRef}
            tabIndex={0}
            role="tabpanel"
            id={`${ids}-panel`}
            aria-labelledby={`${ids}-tab-${tab}`}
            data-testid={`settings-tab-${tab}`}
            style={{ flex: "1 1 320px", minWidth: 0, overflowY: "auto", padding: 16, maxHeight: "100%" }}
          >
            {visibleTabs.length > 0 && <Suspense fallback={<p style={muted}>…</p>}>{panel()}</Suspense>}
          </section>
        </div>
        <SettingsAbout />
      </div>
    </Modal>
  );
}

const header: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 10,
  padding: "12px 16px",
  borderBottom: "1px solid hsl(var(--border))",
};
const nav: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  padding: 8,
  flex: "0 0 200px",
  borderInlineEnd: "1px solid hsl(var(--border))",
  overflowY: "auto",
};
const tabBtn: React.CSSProperties = {
  textAlign: "start",
  padding: "8px 10px",
  borderRadius: 6,
  border: "none",
  background: "transparent",
  color: "hsl(var(--fg))",
  cursor: "pointer",
  fontSize: 13,
};
const tabActive: React.CSSProperties = { background: "hsl(var(--accent) / 0.12)", color: "hsl(var(--accent))", fontWeight: 600 };
const row: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, padding: "6px 0", fontSize: 13, cursor: "pointer" };
const input: React.CSSProperties = {
  padding: "5px 8px",
  borderRadius: 6,
  border: "1px solid hsl(var(--border))",
  background: "hsl(var(--bg-subtle))",
  color: "hsl(var(--fg))",
  fontSize: 13,
};
const iconBtn: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "hsl(var(--fg-muted))",
  cursor: "pointer",
  padding: 4,
  display: "flex",
};
const muted: React.CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.5, color: "hsl(var(--fg-muted))" };
const secondaryBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 12px",
  borderRadius: 6,
  border: "1px solid hsl(var(--border))",
  background: "hsl(var(--bg-subtle))",
  color: "hsl(var(--fg))",
  cursor: "pointer",
  fontSize: 12,
};
