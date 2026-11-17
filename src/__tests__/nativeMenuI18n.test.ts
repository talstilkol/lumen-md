/**
 * W13.K5: the native menu bar in the UI language — every item translated
 * in English and Hebrew, the other languages listed for review, the same
 * order and shortcuts in every language (the system mirrors an RTL menu
 * bar), and every item one the shell accepts (src-tauri/desktop/src/appmenu.rs).
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { MENU, SHELL_IDS, buildNativeMenu, menuCommands, menuKeys, applyNativeMenu, onNativeMenu } from "../desktop/nativeMenu";
import { loadLocale, applyLocale } from "../i18n";

const en = JSON.parse(readFileSync("src/i18n/lazy/nativeMenu.json", "utf8")) as Record<string, string>;
const locale = (l: string): Record<string, string> => Object.assign({}, ...readdirSync(`src/i18n/locales/${l}`).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(`src/i18n/locales/${l}/${f}`, "utf8"))));
const review = JSON.parse(readFileSync("i18n/needs-review/common.json", "utf8")) as Record<string, Record<string, string>>;
const OTHERS = ["ar", "de", "fr", "ja", "ru", "zh-CN"];
const BRAND = new Set(["nativeMenu.app"]);

describe("every menu item is translated", () => {
  const keys = menuKeys();

  it("has a real menu: 6 menus, the system items and the commands", () => {
    expect(MENU.map((s) => s.id)).toEqual(["app", "file", "edit", "view", "window", "help"]);
    expect(keys.length).toBeGreaterThan(50);
    expect(Object.keys(en).sort()).toEqual([...keys].sort()); // no stray strings, none missing
  });

  it("in English and Hebrew (Hebrew letters, not the English text)", () => {
    const he = locale("he");
    for (const k of keys) {
      expect(en[k], k).toBeTruthy();
      expect(he[k], k).toBeTruthy();
      if (!BRAND.has(k)) {
        expect(he[k], k).toMatch(/[א-ת]/);
        expect(he[k], k).not.toBe(en[k]);
      }
      expect(review[k]?.he, `${k} is reviewed Hebrew`).toBeUndefined();
      // An ellipsis in one language is an ellipsis in the other (the item opens a dialog).
      expect(he[k].endsWith("…"), k).toBe(en[k].endsWith("…"));
    }
  });

  it("in the other languages: present, and listed for review until a native speaker checks them", () => {
    for (const l of OTHERS) {
      const m = locale(l);
      for (const k of keys) {
        expect(m[k], `${l} ${k}`).toBeTruthy();
        expect(review[k]?.[l], `${l} ${k} needs review`).toBeTruthy();
      }
    }
  });
});

describe("the menu the shell receives", () => {
  it("Hebrew: translated labels, the same order, ids and shortcuts as English, rtl set", async () => {
    await loadLocale("he");
    applyLocale("en");
    const a = buildNativeMenu("en", "macos");
    applyLocale("he");
    const b = buildNativeMenu("he", "macos");
    applyLocale("en");
    expect(b.rtl).toBe(true);
    expect(a.rtl).toBe(false);
    const shape = (m: typeof a) => m.sections.map((s) => [s.id, s.items.map((i) => ("id" in i ? [i.id, i.accel ?? ""] : "role" in i ? i.role : "-"))]);
    expect(shape(b)).toEqual(shape(a));
    const file = b.sections.find((s) => s.id === "file")!;
    expect(file.label).toBe("קובץ");
    expect(file.items[0]).toEqual({ id: "file.new", label: "פתק חדש", accel: "CmdOrCtrl+N" });
    expect(b.sections.find((s) => s.id === "edit")!.items).toContainEqual({ role: "copy", label: "העתקה" });
  });

  it("Windows and Linux: no application menu, no Services or Hide", () => {
    const w = buildNativeMenu("en", "windows");
    expect(w.sections.map((s) => s.id)).toEqual(["file", "edit", "view", "window", "help"]);
    expect(JSON.stringify(w)).not.toMatch(/"role":"(services|hide|hideOthers|showAll|about)"/);
    expect(JSON.stringify(buildNativeMenu("en", "macos"))).toMatch(/"role":"services"/);
  });

  it("is sent with tray_set_menu (no new IPC command), leaving the tray's recent list alone", async () => {
    const invoke = vi.fn(async () => undefined);
    await applyNativeMenu(invoke, "en", "linux");
    expect(invoke).toHaveBeenCalledTimes(1);
    const [cmd, args] = invoke.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(cmd).toBe("tray_set_menu");
    expect(Object.keys(args)).toEqual(["appMenu"]);
  });

  it("one shortcut per item: no two items share one", () => {
    const accels = MENU.flatMap((s) => s.items.flatMap((i) => (i.kind === "command" && i.accel ? [i.accel] : [])));
    expect(new Set(accels).size).toBe(accels.length);
  });
});

describe("the shell accepts it, and every item does something", () => {
  const rs = readFileSync("src-tauri/desktop/src/appmenu.rs", "utf8");
  const roles = [...(/pub const ROLES: &\[&str\] = &\[([\s\S]*?)\];/.exec(rs)?.[1] ?? "").matchAll(/"(\w+)"/g)].map((m) => m[1]);

  it("every system item is one appmenu.rs builds", () => {
    expect(roles.length).toBeGreaterThan(10);
    for (const s of MENU) for (const i of s.items) if (i.kind === "role") expect(roles, i.role).toContain(i.role);
  });

  it("every command item is a palette command or one the shell handles (useTauriMenu, lib.rs)", () => {
    const domains = readdirSync("src/commands/domains").map((f) => readFileSync(`src/commands/domains/${f}`, "utf8")).join("\n");
    const hook = readFileSync("src/hooks/useTauriMenu.ts", "utf8") + readFileSync("src-tauri/src/lib.rs", "utf8");
    for (const id of menuCommands()) {
      const ok = domains.includes(`id: "${id}"`) || (SHELL_IDS.includes(id) && hook.includes(`"${id}"`));
      expect(ok, id).toBe(true);
    }
  });

  it("a click runs that command, and nothing for an id the menu does not have", () => {
    const run = vi.fn();
    expect(onNativeMenu("view.reading", run)).toBe(true);
    expect(run).toHaveBeenCalledWith("view.reading");
    expect(onNativeMenu("vault.encrypt", run)).toBe(false);
    expect(onNativeMenu(42, run)).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
