/**
 * INT7 — the margins mode (W13.R9) and a note's book pages and reading place
 * (W13.R6) live in W13.R1's ReadingProfile, not in keys of their own:
 *  - the margins switch is the global profile's `sidenotes`;
 *  - a note's spread, start page, direction and place are fields of its
 *    override on this device (never the file);
 *  - what was saved under the old keys is moved in once, then the old key
 *    is gone.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_PROFILE, globalProfile, localNoteProfile, moveNoteReading, normalizeProfile, sparseProfile } from "../reading/settings";
import { setSidenotes, sidenotesOn } from "../reading/sidenotesSetting";
import { loadNotePlace, saveNotePlace } from "../reading/notePlace";
import { profileYaml } from "../reading/profileStore";

beforeEach(() => localStorage.clear());

describe("W13.R9 margins in the reading profile (INT7)", () => {
  it("the switch is the global profile's sidenotes field", () => {
    expect(DEFAULT_PROFILE.sidenotes).toBe(false);
    expect(sidenotesOn()).toBe(false);
    setSidenotes(true);
    expect(globalProfile().sidenotes).toBe(true);
    expect(sidenotesOn()).toBe(true);
    expect(localStorage.getItem("lumen.reading.sidenotes")).toBeNull();
    setSidenotes(false);
    expect(globalProfile().sidenotes).toBe(false);
  });

  it("a switch saved under the old key is moved into the profile once", () => {
    localStorage.setItem("lumen.reading.sidenotes", "1");
    expect(sidenotesOn()).toBe(true);
    expect(localStorage.getItem("lumen.reading.sidenotes")).toBeNull();
    expect(globalProfile().sidenotes).toBe(true);
  });
});

describe("W13.R6 a note's spread and place in its profile (INT7; review 13 M6: real document keys)", () => {
  // The preview passes renderer/previewDoc docIdentity: `ws:<path>` for a workspace note.
  it("round trip through the note's override on this device, stored by the note's PATH", () => {
    saveNotePlace("ws:notes/a.md", { on: true, mode: "even", dir: "rtl", block: 12, scrollTop: 340 });
    expect(localNoteProfile("notes/a.md")).toMatchObject({ spread: true, spreadMode: "even", spreadDir: "rtl", spreadBlock: 12, spreadTop: 340 });
    expect(Object.keys(JSON.parse(localStorage.getItem("lumen-reading")!).notes)).toEqual(["notes/a.md"]);
    expect(loadNotePlace("ws:notes/a.md")).toEqual({ on: true, mode: "even", dir: "rtl", block: 12, scrollTop: 340 });
    expect(localStorage.getItem("lumen.spread:ws:notes/a.md")).toBeNull();
    // Other notes are untouched; the defaults are scrolling, page 1 alone, direction by script.
    expect(loadNotePlace("ws:notes/b.md")).toEqual({ on: false, mode: "odd", dir: undefined, block: undefined, scrollTop: undefined });
  });

  it("a renamed note keeps its place (moveNoteReading moves the path key)", () => {
    saveNotePlace("ws:a.md", { on: true, mode: "odd", block: 4 });
    moveNoteReading("a.md", "b.md");
    expect(loadNotePlace("ws:b.md")).toMatchObject({ on: true, block: 4 });
  });

  it("a document without a path (a file from disk, an unsaved buffer) keeps its place for the session only: the stored map does not grow", () => {
    for (let i = 1; i <= 50; i++) saveNotePlace(`fh:${i}:readme.md`, { on: true, mode: "odd", block: i });
    saveNotePlace("name:untitled.md#3", { on: true, mode: "none" });
    expect(loadNotePlace("fh:7:readme.md")).toMatchObject({ on: true, block: 7 });
    expect(loadNotePlace("name:untitled.md#3")).toMatchObject({ on: true, mode: "none" });
    expect(localStorage.getItem("lumen-reading")).toBeNull();
  });

  it("document keys stored by an earlier build are cleaned up: ws: moved to the path, per-session keys dropped", () => {
    localStorage.setItem("lumen-reading", JSON.stringify({ notes: { "ws:n.md": { spread: true, spreadBlock: 9 }, "fh:3:x.md": { spread: true }, "name:y.md#1": { spread: true }, "n.md": { wpm: 420 } } }));
    expect(loadNotePlace("ws:n.md")).toMatchObject({ on: true, block: 9 });
    expect(JSON.parse(localStorage.getItem("lumen-reading")!).notes).toEqual({ "n.md": { wpm: 420, spread: true, spreadBlock: 9 } });
  });

  it("keeps the note's other profile keys", () => {
    localStorage.setItem("lumen-reading", JSON.stringify({ notes: { "n.md": { wpm: 420 } } }));
    saveNotePlace("ws:n.md", { on: false, mode: "odd", block: 3 });
    expect(localNoteProfile("n.md")).toMatchObject({ wpm: 420, spread: false, spreadBlock: 3 });
  });

  it("a place saved under the old key is moved in once", () => {
    localStorage.setItem("lumen.spread:ws:n.md", JSON.stringify({ on: true, mode: "none", block: 7 }));
    expect(loadNotePlace("ws:n.md")).toMatchObject({ on: true, mode: "none", block: 7 });
    expect(localStorage.getItem("lumen.spread:ws:n.md")).toBeNull();
    expect(localNoteProfile("n.md")).toMatchObject({ spread: true, spreadMode: "none", spreadBlock: 7 });
  });

  it("the fields are checked like every profile key, and a note's frontmatter carries only what it changes", () => {
    expect(sparseProfile({ spreadMode: "sideways", spreadDir: "up", spreadBlock: -5, sidenotes: "yes" })).toEqual({ spreadBlock: -1 });
    expect(normalizeProfile({}).spreadMode).toBe("odd");
    expect(profileYaml({ sidenotes: true })).toBe("{sidenotes: true}");
  });
});

describe("review 13 H2: the startup modules do not load the reading settings", () => {
  it("sidenotesSetting and notePlace import ./profileCore, not ./settings (its faces and aids stay out of the startup bundle)", () => {
    const src = (f: string) => readFileSync(join(__dirname, "../reading", f), "utf8");
    for (const f of ["sidenotesSetting.ts", "notePlace.ts", "noteSpreadHook.ts", "profileCore.ts"]) {
      const runtime = src(f).split("\n").filter((l) => /^import\s(?!type\b)/.test(l));
      expect([f, runtime.filter((l) => /["']\.\/(settings|fonts|readingAids)["']/.test(l))]).toEqual([f, []]);
    }
  });
});
