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
import { DEFAULT_PROFILE, globalProfile, localNoteProfile, normalizeProfile, sparseProfile } from "../reading/settings";
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

describe("W13.R6 a note's spread and place in its profile (INT7)", () => {
  it("round trip through the note's override on this device", () => {
    saveNotePlace("notes/a.md", { on: true, mode: "even", dir: "rtl", block: 12, scrollTop: 340 });
    expect(localNoteProfile("notes/a.md")).toMatchObject({ spread: true, spreadMode: "even", spreadDir: "rtl", spreadBlock: 12, spreadTop: 340 });
    expect(loadNotePlace("notes/a.md")).toEqual({ on: true, mode: "even", dir: "rtl", block: 12, scrollTop: 340 });
    expect(localStorage.getItem("lumen.spread:notes/a.md")).toBeNull();
    // Other notes are untouched; the defaults are scrolling, page 1 alone, direction by script.
    expect(loadNotePlace("notes/b.md")).toEqual({ on: false, mode: "odd", dir: undefined, block: undefined, scrollTop: undefined });
  });

  it("keeps the note's other profile keys", () => {
    localStorage.setItem("lumen-reading", JSON.stringify({ notes: { "n.md": { wpm: 420 } } }));
    saveNotePlace("n.md", { on: false, mode: "odd", block: 3 });
    expect(localNoteProfile("n.md")).toMatchObject({ wpm: 420, spread: false, spreadBlock: 3 });
  });

  it("a place saved under the old key is moved in once", () => {
    localStorage.setItem("lumen.spread:n.md", JSON.stringify({ on: true, mode: "none", block: 7 }));
    expect(loadNotePlace("n.md")).toMatchObject({ on: true, mode: "none", block: 7 });
    expect(localStorage.getItem("lumen.spread:n.md")).toBeNull();
    expect(localNoteProfile("n.md")).toMatchObject({ spread: true, spreadMode: "none", spreadBlock: 7 });
  });

  it("the fields are checked like every profile key, and a note's frontmatter carries only what it changes", () => {
    expect(sparseProfile({ spreadMode: "sideways", spreadDir: "up", spreadBlock: -5, sidenotes: "yes" })).toEqual({ spreadBlock: -1 });
    expect(normalizeProfile({}).spreadMode).toBe("odd");
    expect(profileYaml({ sidenotes: true })).toBe("{sidenotes: true}");
  });
});
