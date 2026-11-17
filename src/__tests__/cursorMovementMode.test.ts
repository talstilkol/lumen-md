/**
 * Plan W13.H1 — Word's cursor movement (Options.CursorMovement) for both
 * editors: visual by default, logical as plan 9.7 built it. A personal
 * preference of the device, never synced. The 40 W11.H3 caret scenarios have
 * an expectation table for both modes (e2e/cursor-scenarios.ts), checked
 * here against a text-order oracle and in the browser by e2e/rtl-caret.spec.ts.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  CURSOR_MOVEMENT_DEFAULT,
  CURSOR_MOVEMENT_KEY,
  cursorMovement,
  onCursorMovementChange,
  resetCursorMovementCache,
  setCursorMovement,
  toggleCursorMovement,
} from "../editor/cursorMovementSetting";
import { charLogical, cursorMovementExtension, editorCursorMovement, groupLogical } from "../editor/cursorMovement";
import { buildBidiMarksCommands } from "../editor/bidiMarksCommands";
import { SETTINGS } from "../settings/schema";
import { CARET_SCENARIOS } from "../../e2e/cursor-scenarios";

const ROOT = resolve(__dirname, "..", "..");

beforeEach(() => {
  localStorage.removeItem(CURSOR_MOVEMENT_KEY);
  resetCursorMovementCache();
});
afterEach(() => {
  setCursorMovement("visual");
});

describe("the setting", () => {
  it("is visual by default, like Word", () => {
    expect(CURSOR_MOVEMENT_DEFAULT).toBe("visual");
    expect(cursorMovement()).toBe("visual");
  });

  it("keeps logical on this device and forgets a value it does not know", () => {
    setCursorMovement("logical");
    expect(localStorage.getItem(CURSOR_MOVEMENT_KEY)).toBe("logical");
    resetCursorMovementCache();
    expect(cursorMovement()).toBe("logical");
    localStorage.setItem(CURSOR_MOVEMENT_KEY, "sideways");
    resetCursorMovementCache();
    expect(cursorMovement()).toBe("visual");
  });

  it("stores nothing for the default", () => {
    setCursorMovement("logical");
    setCursorMovement("visual");
    expect(localStorage.getItem(CURSOR_MOVEMENT_KEY)).toBeNull();
  });

  it("toggles and tells its listeners", () => {
    const seen: string[] = [];
    const off = onCursorMovementChange((m) => seen.push(m));
    expect(toggleCursorMovement()).toBe("logical");
    expect(toggleCursorMovement()).toBe("visual");
    off();
    toggleCursorMovement();
    expect(seen).toEqual(["logical", "visual"]);
  });

  it("picks up a change the settings screen wrote (lumen-local-setting) at once", () => {
    const seen: string[] = [];
    const off = onCursorMovementChange((m) => seen.push(m));
    expect(cursorMovement()).toBe("visual");
    localStorage.setItem(CURSOR_MOVEMENT_KEY, "logical");
    window.dispatchEvent(new CustomEvent("lumen-local-setting", { detail: { id: CURSOR_MOVEMENT_KEY } }));
    expect(cursorMovement()).toBe("logical");
    window.dispatchEvent(new CustomEvent("lumen-local-setting", { detail: { id: "something.else" } }));
    off();
    expect(seen).toEqual(["logical"]);
  });

  it("is a device setting in the settings table, offered in Settings → General", () => {
    const e = SETTINGS.find((s) => s.id === CURSOR_MOVEMENT_KEY);
    expect(e).toMatchObject({ store: "local", kind: "setting", tab: "general", type: "choice", label: "editor.cursorMovement" });
    expect(e?.options?.map((o) => o.value)).toEqual(["visual", "logical"]);
  });

  it("is never synced: no sync code reads it, and it is not part of the persisted app store", () => {
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(n) && /cursorMovement|lumen\.cursorMovement/.test(readFileSync(p, "utf8"))) hits.push(p);
      }
    };
    for (const d of ["src/sync", "src/collab", "sync-server"]) {
      try {
        walk(join(ROOT, d));
      } catch {
        /* why: a folder that is not there has nothing to sync */
      }
    }
    expect(hits).toEqual([]);
    expect(SETTINGS.find((s) => s.id === CURSOR_MOVEMENT_KEY)?.store).toBe("local");
  });

  it("the settings screen announces a local write so open editors switch", () => {
    expect(readFileSync(join(ROOT, "src/ui/SettingsScreen.tsx"), "utf8")).toMatch(/new CustomEvent\("lumen-local-setting", \{ detail: \{ id: entry\.id \} \}\)/);
  });
});

describe("the source editor", () => {
  it("starts in the setting's mode and switches every open editor when it changes", () => {
    setCursorMovement("logical");
    const a = new EditorView({ state: EditorState.create({ doc: "שלום iPhone", extensions: cursorMovementExtension() }) });
    const b = new EditorView({ state: EditorState.create({ doc: "x", extensions: cursorMovementExtension() }) });
    expect(editorCursorMovement(a.state)).toBe("logical");
    setCursorMovement("visual");
    expect(editorCursorMovement(a.state)).toBe("visual");
    expect(editorCursorMovement(b.state)).toBe("visual");
    a.destroy();
    setCursorMovement("logical");
    expect(editorCursorMovement(b.state)).toBe("logical");
    b.destroy();
  });

  it("draws its own caret (drawSelection), so a bidi boundary is drawn on the side the move came from", () => {
    const v = new EditorView({ state: EditorState.create({ doc: "שלום iPhone", extensions: cursorMovementExtension("visual") }) });
    expect(v.dom.querySelector(".cm-cursorLayer")).not.toBeNull();
    v.destroy();
  });
});

describe("the expectation table: 40 scenarios × 2 modes", () => {
  it("has 10 lines with home, end, trip and word in both modes (80 expectations)", () => {
    expect(CARET_SCENARIOS).toHaveLength(10);
    let n = 0;
    for (const sc of CARET_SCENARIOS)
      for (const mode of ["logical", "visual"] as const) {
        const e = sc[mode];
        expect(e.trip).toHaveLength(7);
        expect(e.word).toHaveLength(2);
        n += 4;
      }
    expect(n).toBe(80);
  });

  it("Home and End reach the same offsets in both modes: the start and the end of the line", () => {
    for (const sc of CARET_SCENARIOS) {
      expect(sc.logical.home).toEqual(sc.visual.home);
      expect(sc.logical.end).toEqual(sc.visual.end);
      expect(sc.logical.home.head).toBe(0);
      expect(sc.logical.end.head).toBe(sc.text.length);
    }
  });

  it("the logical column is text order: it matches the oracle on every line", () => {
    for (const sc of CARET_SCENARIOS) {
      const state = EditorState.create({ doc: sc.text });
      const from = sc.logical.trip[0];
      const want = [from];
      let p = from;
      for (let i = 0; i < 6; i++) want.push((p = charLogical(state, p, i < 3)));
      expect(sc.logical.trip, sc.text).toEqual(want);
      const w = groupLogical(state, 0, true);
      expect(sc.logical.word, sc.text).toEqual([w, groupLogical(state, w, false)]);
    }
  });

  it("the visual column differs from text order exactly where a run of the other direction is crossed", () => {
    const differs = CARET_SCENARIOS.filter((sc) => JSON.stringify(sc.visual.trip) !== JSON.stringify(sc.logical.trip)).map((sc) => sc.text);
    // From the middle of "iPhone חדש…" (LTR) the caret sits in the Hebrew run; in "ראה `npm run dev`" (RTL) in the code run;
    // in "Hello עולם יפה" (LTR) in the Hebrew run, which ends at the line's visual right edge.
    expect(differs).toEqual(["iPhone חדש הגיע היום", "ראה `npm run dev`", "Hello עולם יפה"]);
    for (const sc of CARET_SCENARIOS) {
      const t = sc.visual.trip;
      // Visual moves are their own inverse unless the caret hit the line's edge on the way out (Hello עולם יפה).
      if (sc.text !== "Hello עולם יפה") expect(t[6], sc.text).toBe(t[0]);
    }
  });
});

describe("the palette command", () => {
  it("offers the other mode, switches, and says so", () => {
    const deps = { getView: () => null, getContent: () => "", setContent: () => undefined };
    const find = () => buildBidiMarksCommands(deps).find((c) => c.id === "edit.cursorMovement")!;
    expect(find().label).toBe("Cursor movement: switch to logical");
    void find().action();
    expect(cursorMovement()).toBe("logical");
    expect(find().label).toBe("Cursor movement: switch to visual");
  });
});

describe("the WYSIWYG editor follows the same setting", () => {
  it("leaves the arrows to the browser in visual mode and moves logically only in logical mode", () => {
    const src = readFileSync(join(ROOT, "src/editor/wysiwygBidi.ts"), "utf8");
    expect(src).toMatch(/if \(cursorMovement\(\) !== "logical"\) return false;\s*return logicalArrow\(/);
  });
});
