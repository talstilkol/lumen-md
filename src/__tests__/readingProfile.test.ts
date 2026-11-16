/**
 * Plan W13.R1 — one reading profile per note: `lumen-reading` in the
 * frontmatter (or this device only) over the global profile, key by key.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { DEFAULT_PROFILE, globalProfile, localNoteProfile, normalizeProfile, profileDiff, resolveProfile, saveGlobalProfile, saveLocalNoteProfile, saveNoteReading, noteReading, sparseProfile, DEFAULT_READING } from "../reading/settings";
import { fileProfile, mayHaveFileProfile, noteProfile, profileYaml, writeFileProfile, PROFILE_KEY } from "../reading/profileStore";
import { FrontmatterError } from "../properties/frontmatter";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

beforeEach(() => localStorage.clear());

describe("schema", () => {
  it("keeps only valid keys, clamps numbers, drops unknown keys and wrong types", () => {
    expect(sparseProfile({ mode: "rsvp", wpm: 9999, width: 10, nikud: "show", bogus: 1, aids: "yes", lineFocus: "3", tint: "purple" })).toEqual({ mode: "rsvp", wpm: 600, width: 40, nikud: "show", lineFocus: 3 });
    expect(sparseProfile(null)).toEqual({});
    expect(sparseProfile(["mode"])).toEqual({});
    expect(normalizeProfile({ mode: "nope" })).toEqual(DEFAULT_PROFILE);
  });

  it("a diff holds only the keys that differ", () => {
    expect(profileDiff({ ...DEFAULT_PROFILE, wpm: 320, mode: "rsvp" })).toEqual({ mode: "rsvp", wpm: 320 });
    expect(profileDiff(DEFAULT_PROFILE)).toEqual({});
  });

  it("the global profile takes the aids' own settings (W5.6) until it sets them", () => {
    localStorage.setItem("lumen-reading-aids", JSON.stringify({ dyslexia: true, tint: "blue", rate: 1.4, lineFocus: true }));
    expect(globalProfile()).toMatchObject({ aids: true, tint: "blue", rate: 1.4, lineFocus: 1 });
    saveGlobalProfile({ ...globalProfile(), tint: "green" });
    expect(globalProfile().tint).toBe("green");
  });
});

describe("a note's profile wins over the global one", () => {
  it("key by key: defaults < global < file < this device", () => {
    const global = { ...DEFAULT_PROFILE, font: "notoSerif" as const, width: 80, wpm: 250 };
    const { profile, from } = resolveProfile(global, { width: 60, mode: "rsvp" }, { wpm: 400 });
    expect(profile).toMatchObject({ font: "notoSerif", width: 60, mode: "rsvp", wpm: 400 });
    expect(from.font).toBe("global");
    expect(from.width).toBe("file");
    expect(from.wpm).toBe("device");
  });

  it("through storage and the frontmatter", () => {
    saveGlobalProfile({ ...DEFAULT_PROFILE, width: 90, nikud: "asWritten" });
    const md = "---\ntitle: א\nlumen-reading: {width: 56, nikud: show, mode: immersive}\n---\n\n# שלום\n";
    const n = noteProfile("a.md", md);
    expect(n.profile).toMatchObject({ width: 56, nikud: "show", mode: "immersive" });
    expect(n.from.width).toBe("file");
    // Another note follows the global profile.
    expect(noteProfile("b.md", "# b\n").profile.width).toBe(90);
    // This device's override beats the file.
    saveLocalNoteProfile("a.md", { width: 64 });
    expect(noteProfile("a.md", md).profile.width).toBe(64);
    expect(noteProfile("a.md", md).from.width).toBe("device");
  });

  it("a block map written by hand is read too; invalid YAML gives no profile", () => {
    expect(fileProfile("---\nlumen-reading:\n  mode: focus\n  focusUnit: paragraph\n---\nx")).toEqual({ mode: "focus", focusUnit: "paragraph" });
    expect(fileProfile("---\nlumen-reading: {mode: [\n---\nx")).toEqual({});
    expect(mayHaveFileProfile("# no frontmatter\nlumen-reading: {mode: rsvp}")).toBe(false);
  });

  it("the device override keeps the old typography entries (W3.5) working", () => {
    saveNoteReading("a.md", { ...DEFAULT_READING, size: 22 });
    saveLocalNoteProfile("a.md", { ...localNoteProfile("a.md"), mode: "rsvp" });
    expect(noteReading("a.md")?.size).toBe(22);
    saveNoteReading("a.md", null);
    expect(noteReading("a.md")).toBeNull();
    expect(localNoteProfile("a.md")).toEqual({ mode: "rsvp" });
  });
});

describe("writing the file", () => {
  it("adds, replaces in place and removes only the lumen-reading line", () => {
    const md = "---\ntitle: \"x\" # keep\ntags: [a, b]\n---\n\nbody\n";
    const one = writeFileProfile(md, { mode: "rsvp", wpm: 320 });
    expect(one).toBe("---\ntitle: \"x\" # keep\ntags: [a, b]\nlumen-reading: {mode: rsvp, wpm: 320}\n---\n\nbody\n");
    const moved = "---\nlumen-reading: {mode: rsvp}\ntitle: y\n---\nb";
    expect(writeFileProfile(moved, { width: 60 })).toBe("---\nlumen-reading: {width: 60}\ntitle: y\n---\nb");
    expect(writeFileProfile(one, null)).toBe(md);
    expect(writeFileProfile(md, {})).toBe(md);
  });

  it("creates a frontmatter when there is none, keeps CRLF and a block map is replaced whole", () => {
    expect(writeFileProfile("# hi\n", { nikud: "show" })).toBe(`---\n${PROFILE_KEY}: {nikud: show}\n---\n# hi\n`);
    expect(writeFileProfile("---\r\ntitle: a\r\n---\r\nx", { anchor: true })).toBe("---\r\ntitle: a\r\nlumen-reading: {anchor: true}\r\n---\r\nx");
    expect(writeFileProfile("---\nlumen-reading:\n  mode: focus\n  wpm: 200\nz: 1\n---\nx", { mode: "page", font: "notoSerif" })).toBe("---\nlumen-reading: {font: notoSerif, mode: page}\nz: 1\n---\nx");
  });

  it("quotes a voice name that YAML would misread, and the result reads back", () => {
    const yaml = profileYaml({ voice: "Carmit: he-IL, #1" });
    expect(yaml).toBe('{voice: "Carmit: he-IL, #1"}');
    expect(fileProfile(writeFileProfile("x", { voice: "Carmit: he-IL, #1", mode: "focus" }))).toEqual({ mode: "focus", voice: "Carmit: he-IL, #1" });
    expect(profileYaml({ voice: "yes" })).toBe('{voice: "yes"}');
  });

  it("refuses a frontmatter that does not parse", () => {
    expect(() => writeFileProfile("---\na: [\n---\nx", { mode: "rsvp" })).toThrow(FrontmatterError);
  });
});

describe("“this device only” never changes the file", () => {
  it("the hash is the same before and after", () => {
    const md = "---\ntitle: שלום\nlumen-reading: {width: 60}\n---\n\nבְּרֵאשִׁית בָּרָא\n";
    const before = sha(md);
    saveLocalNoteProfile("n.md", { mode: "rsvp", wpm: 420, nikud: "show" });
    const n = noteProfile("n.md", md);
    expect(n.profile).toMatchObject({ mode: "rsvp", wpm: 420, width: 60 });
    expect(sha(md)).toBe(before);
    // The file path would have changed it: the check can tell.
    expect(sha(writeFileProfile(md, { mode: "rsvp", wpm: 420, nikud: "show", width: 60 }))).not.toBe(before);
  });
});
