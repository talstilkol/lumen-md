import { describe, it, expect, beforeEach } from "vitest";
import {
  DEFAULT_THEME_SETTINGS,
  MANAGED_VARS,
  PRESETS,
  PRESET_IDS,
  applyThemeSettings,
  contrastReport,
  cssVariablesFor,
  effectivePalette,
  exportThemeJson,
  fontStackFor,
  isValidCustomFont,
  parseThemeJson,
  sanitizeThemeSettings,
  validateThemeObject,
  type ThemeSettings,
} from "../lib/themeSettings";
import { contrastRatio } from "../lib/contrast";
import { useAppStore } from "../store/useStore";

const base = (patch: Partial<ThemeSettings> = {}): ThemeSettings => ({ ...DEFAULT_THEME_SETTINGS, ...patch });

describe("presets meet WCAG", () => {
  for (const id of PRESET_IDS) {
    for (const dark of [false, true]) {
      it(`${id} (${dark ? "dark" : "light"}) passes the AA report`, () => {
        const report = contrastReport(effectivePalette(base({ preset: id }), dark));
        for (const c of report) expect(c.pass, `${c.id} ${c.ratio.toFixed(2)}`).toBe(true);
      });
    }
  }

  for (const mode of ["light", "dark"] as const) {
    it(`high contrast (${mode}) is AAA for text and AA for borders`, () => {
      const p = PRESETS.highContrast[mode]!;
      expect(contrastRatio(p.fg, p.bg)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(p.fgSubtle, p.bg)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(p.fgMuted, p.bg)).toBeGreaterThanOrEqual(7);
      // Muted text must stay legible on every surface tone, not just bg.
      for (const surface of [p.bgSubtle, p.bgMuted, p.bgInset]) {
        expect(contrastRatio(p.fgMuted, surface)).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrastRatio(p.border, p.bg)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(p.accent, p.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(p.accentFg, p.accent)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe("cssVariablesFor", () => {
  it("default preset only sets typography + measure (stylesheet palette stays)", () => {
    const vars = cssVariablesFor(base(), true);
    expect(vars["--bg"]).toBeUndefined();
    expect(vars["--accent"]).toBeUndefined();
    expect(vars["--editor-font-size"]).toBe("14px");
    expect(vars["--editor-line-height"]).toBe("1.65");
    expect(vars["--content-width"]).toBe("80ch");
    expect(vars["--preview-width"]).toBe("72ch");
  });

  it("accent override sets accent + a readable accent-fg", () => {
    const vars = cssVariablesFor(base({ accent: "#ffd60a" }), false);
    expect(vars["--accent"]).toMatch(/^\d+(\.\d)? \d+(\.\d)?% \d+(\.\d)?%$/);
    expect(vars["--accent-fg"]).toBe("0 0% 0%");
    expect(vars["--bg"]).toBeUndefined();
  });

  it("non-default presets write the full palette for the active mode", () => {
    const light = cssVariablesFor(base({ preset: "highContrast" }), false);
    const dark = cssVariablesFor(base({ preset: "highContrast" }), true);
    expect(light["--bg"]).toBe("0 0% 100%");
    expect(dark["--bg"]).toBe("0 0% 0%");
  });

  it("font stacks", () => {
    expect(fontStackFor({ fontFamily: "serif", customFont: "" })).toMatch(/serif$/);
    expect(fontStackFor({ fontFamily: "custom", customFont: "Fira Code" })).toMatch(/^"Fira Code", /);
    // An invalid custom name never reaches CSS.
    expect(fontStackFor({ fontFamily: "custom", customFont: 'x"; }' })).not.toContain("x\"");
  });
});

describe("applyThemeSettings", () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = document.createElement("div");
  });

  it("writes CSS variables onto the element", () => {
    applyThemeSettings(base({ preset: "nord", fontSize: 18, contentWidth: 100 }), root, true);
    expect(root.style.getPropertyValue("--editor-font-size")).toBe("18px");
    expect(root.style.getPropertyValue("--content-width")).toBe("100ch");
    expect(root.style.getPropertyValue("--bg")).not.toBe("");
    expect(root.dataset.themePreset).toBe("nord");
  });

  it("clears palette variables when returning to the default preset", () => {
    applyThemeSettings(base({ preset: "sepia", accent: "#ff0000" }), root, false);
    expect(root.style.getPropertyValue("--accent")).not.toBe("");
    applyThemeSettings(base(), root, false);
    expect(root.style.getPropertyValue("--accent")).toBe("");
    expect(root.style.getPropertyValue("--bg")).toBe("");
    for (const v of MANAGED_VARS.filter((n) => n.startsWith("--editor") || n.endsWith("width"))) {
      expect(root.style.getPropertyValue(v)).not.toBe("");
    }
  });

  it("follows the dark class by default", () => {
    root.classList.add("dark");
    applyThemeSettings(base({ preset: "highContrast" }), root);
    expect(root.style.getPropertyValue("--bg")).toBe("0 0% 0%");
  });
});

describe("theme JSON validation", () => {
  it("round-trips export → import", () => {
    const s = base({ preset: "sepia", accent: "#123abc", fontFamily: "custom", customFont: "Fira Code", fontSize: 16, lineHeight: 1.8, contentWidth: 96 });
    const res = parseThemeJson(exportThemeJson(s));
    expect(res).toEqual({ ok: true, settings: s });
  });

  it("fills omitted keys with defaults", () => {
    const res = validateThemeObject({ lumenTheme: 1, preset: "nord" });
    expect(res.ok && res.settings).toEqual(base({ preset: "nord" }));
  });

  it("normalises short hex accents", () => {
    const res = validateThemeObject({ lumenTheme: 1, accent: "#ABC" });
    expect(res.ok && res.settings.accent).toBe("#aabbcc");
  });

  it.each<[string, unknown, string, string?]>([
    ["non-JSON", "{nope", "notJson"],
    ["array", "[]", "notObject"],
    ["null", "null", "notObject"],
    ["string", '"x"', "notObject"],
    ["missing version", "{}", "badVersion", "lumenTheme"],
    ["wrong version", '{"lumenTheme":2}', "badVersion", "lumenTheme"],
    ["unknown key", '{"lumenTheme":1,"bg":"#fff"}', "unknownKey", "bg"],
    ["proto key", '{"lumenTheme":1,"__proto__":{"x":1}}', "unknownKey", "__proto__"],
    ["named color", '{"lumenTheme":1,"accent":"red"}', "invalidColor", "accent"],
    ["css injection color", '{"lumenTheme":1,"accent":"#fff;}body{"}', "invalidColor", "accent"],
    ["rgb()", '{"lumenTheme":1,"accent":"rgb(0,0,0)"}', "invalidColor", "accent"],
    ["bad preset", '{"lumenTheme":1,"preset":"dracula"}', "invalidValue", "preset"],
    ["bad font choice", '{"lumenTheme":1,"fontFamily":"comic"}', "invalidValue", "fontFamily"],
    ["custom w/o name", '{"lumenTheme":1,"fontFamily":"custom"}', "invalidValue", "customFont"],
    ["font injection", '{"lumenTheme":1,"customFont":"x\\"; } body { color: red"}', "invalidValue", "customFont"],
    ["font too small", '{"lumenTheme":1,"fontSize":4}', "invalidValue", "fontSize"],
    ["font as string", '{"lumenTheme":1,"fontSize":"14"}', "invalidValue", "fontSize"],
    ["line height NaN-ish", '{"lumenTheme":1,"lineHeight":null}', "invalidValue", "lineHeight"],
    ["width too wide", '{"lumenTheme":1,"contentWidth":500}', "invalidValue", "contentWidth"],
  ])("rejects %s", (_name, text, error, key) => {
    const res = parseThemeJson(text as string);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe(error);
      if (key) expect(res.key).toBe(key);
    }
  });

  it("rejects oversized input before parsing", () => {
    const res = parseThemeJson(`{"lumenTheme":1,"customFont":"${"a".repeat(9000)}"}`);
    expect(res).toEqual({ ok: false, error: "tooLarge" });
  });

  it("custom font names: letters in any script, no CSS metacharacters", () => {
    expect(isValidCustomFont("Fira Code")).toBe(true);
    expect(isValidCustomFont("Noto Sans Hebrew")).toBe(true);
    expect(isValidCustomFont("פונט עברי")).toBe(true);
    expect(isValidCustomFont("a,b")).toBe(false);
    expect(isValidCustomFont("url(x)")).toBe(false);
    expect(isValidCustomFont("   ")).toBe(false);
    expect(isValidCustomFont("a".repeat(65))).toBe(false);
  });
});

describe("sanitizeThemeSettings (persisted state)", () => {
  it("drops invalid fields individually", () => {
    expect(
      sanitizeThemeSettings({ preset: "nord", accent: "nope", fontSize: 999, lineHeight: 1.5, extra: 1 }),
    ).toEqual(base({ preset: "nord", lineHeight: 1.5 }));
  });
  it("handles garbage", () => {
    expect(sanitizeThemeSettings(undefined)).toEqual(base());
    expect(sanitizeThemeSettings("x")).toEqual(base());
  });
  it("custom font without a name falls back to the default family", () => {
    expect(sanitizeThemeSettings({ fontFamily: "custom", customFont: "" }).fontFamily).toBe("mono");
  });
});

describe("store integration", () => {
  beforeEach(() => {
    useAppStore.getState().resetThemeSettings();
  });

  it("setThemeSettings applies variables to <html> live", () => {
    useAppStore.getState().setThemeSettings({ fontSize: 20 });
    expect(useAppStore.getState().themeSettings.fontSize).toBe(20);
    expect(document.documentElement.style.getPropertyValue("--editor-font-size")).toBe("20px");
  });

  it("rejects out-of-range patches", () => {
    useAppStore.getState().setThemeSettings({ fontSize: 1000 });
    expect(useAppStore.getState().themeSettings.fontSize).toBe(DEFAULT_THEME_SETTINGS.fontSize);
  });

  it("resetThemeSettings restores defaults and clears the palette", () => {
    useAppStore.getState().setThemeSettings({ preset: "highContrast" });
    expect(document.documentElement.style.getPropertyValue("--bg")).not.toBe("");
    useAppStore.getState().resetThemeSettings();
    expect(useAppStore.getState().themeSettings).toEqual(base());
    expect(document.documentElement.style.getPropertyValue("--bg")).toBe("");
  });
});
