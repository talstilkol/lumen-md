/**
 * Blind tests (plan W6.15, W10.D19): a note locked with its own password.
 *
 * Written from the spec only: "A note with its own password" in
 * docs/src/content/docs/security/journalist-mode.md and the declarations tsc
 * emits for src/storage/lockedNote.ts and lockedNotesRegistry.ts (signatures
 * and doc comments, no function bodies, no existing lockedNote tests). Lane
 * X-BL, against verify/train-5 (c3f055218e).
 *
 * Properties: on disk the note is ciphertext with a readable first line; the
 * password is at least 8 characters; every save is sealed under a fresh
 * nonce; the KDF parameters are bound in; while the note is locked nothing
 * replaces it but its own envelope byte for byte — plain text and any other
 * envelope (even one that copies its salt) are refused.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  __resetLockedNotes,
  allowEnvelopeWrite,
  allowPlainWrite,
  forgetOpen,
  isEnvelopeText,
  isOpenLocked,
  isSealedNote,
  lockNote,
  LockedNoteOverwriteError,
  LOCKED_NOTE_MAGIC,
  makeSealer,
  MIN_NOTE_PASSWORD,
  NotALockedNoteError,
  openSealed,
  rememberOpen,
  sealNote,
  unlockNote,
  WrongNotePasswordError,
} from "../../storage/lockedNote";
import { caught } from "./_e2eeHarness";

const ITER = 1000;
const POLICY = { minPbkdf2Iterations: ITER };
const PW = "a long note password";
const TEXT = "# Sources\n\nThe witness is ש. — call after 18:00.";

/** The payload line, decoded: {"v":1,"kdf":{…},"iv":"…","ct":"…"}. */
function payload(sealed: string): { v: number; kdf: Record<string, unknown>; iv: string; ct: string } {
  const line = sealed.split("\n").find((l) => l.startsWith("lumen-locked:"))!;
  const b = line.slice("lumen-locked:".length).trim();
  return JSON.parse(atob(b.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b.length + 3) % 4)));
}
function withPayload(sealed: string, edit: (p: ReturnType<typeof payload>) => void): string {
  const p = payload(sealed);
  edit(p);
  const b = btoa(JSON.stringify(p)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return sealed.replace(/lumen-locked:[A-Za-z0-9_-]+/, `lumen-locked:${b}`);
}

/** A tiny disk: the sealer is the write hook, `disk` holds what reached it. */
function disk() {
  const files = new Map<string, string>();
  const read = async (p: string) => files.get(p) ?? null;
  const sealer = makeSealer(read);
  const write = async (p: string, text: string) => {
    const out = await sealer(p, text);
    files.set(p, out);
    return out;
  };
  return { files, read, write };
}

afterEach(() => __resetLockedNotes());

describe("blind: locked notes (W10.D19)", () => {
  it("L1 a locked note is a text file anyone can see is locked: the magic line, a notice, the payload; no plain text", async () => {
    const { sealed } = await lockNote(TEXT, PW, { pbkdf2Iterations: ITER });
    expect(LOCKED_NOTE_MAGIC).toBe("<!-- lumen-locked-note v1 -->");
    expect(sealed.startsWith(LOCKED_NOTE_MAGIC)).toBe(true);
    expect(sealed).toMatch(/\nlumen-locked:[A-Za-z0-9_-]+\s*$/);
    expect(sealed).not.toContain("witness");
    expect(sealed).not.toContain("Sources");
    expect(isSealedNote(sealed)).toBe(true);
    expect(isEnvelopeText(sealed)).toBe(true);
    const p = payload(sealed);
    expect(p.v).toBe(1);
    expect(p.kdf.alg).toBe("pbkdf2-sha256");
    // 96-bit nonce.
    expect(p.iv.replace(/=+$/, "").length).toBe(16);
  });

  it("L2 lock → unlock round-trips with the password; the key opens later saves", async () => {
    const { sealed, key } = await lockNote(TEXT, PW, { pbkdf2Iterations: ITER });
    const { plain, key: k2 } = await unlockNote(sealed, PW, POLICY);
    expect(plain).toBe(TEXT);
    const next = await sealNote(TEXT + "\nmore", k2);
    expect(await openSealed(next, key, POLICY)).toBe(TEXT + "\nmore");
  });

  it("L3 a wrong password is WrongNotePasswordError; text that is not a locked note is NotALockedNoteError", async () => {
    const { sealed } = await lockNote(TEXT, PW, { pbkdf2Iterations: ITER });
    expect(await caught(() => unlockNote(sealed, PW + "!", POLICY))).toBeInstanceOf(WrongNotePasswordError);
    expect(await caught(() => unlockNote("# just a note", PW, POLICY))).toBeInstanceOf(NotALockedNoteError);
  });

  it("L4 a password shorter than 8 characters is refused", async () => {
    expect(MIN_NOTE_PASSWORD).toBe(8);
    expect(await caught(() => lockNote(TEXT, "1234567", { pbkdf2Iterations: ITER }))).toBeInstanceOf(Error);
    await expect(lockNote(TEXT, "12345678", { pbkdf2Iterations: ITER })).resolves.toBeTruthy();
  });

  it("L5 every save is sealed under a fresh nonce", async () => {
    const { key } = await lockNote(TEXT, PW, { pbkdf2Iterations: ITER });
    const a = await sealNote(TEXT, key);
    const b = await sealNote(TEXT, key);
    expect(a).not.toBe(b);
    expect(payload(a).iv).not.toBe(payload(b).iv);
  });

  it("L6 the version and the KDF parameters are bound in: editing them (or the ciphertext) breaks the seal", async () => {
    const { sealed } = await lockNote(TEXT, PW, { pbkdf2Iterations: ITER });
    const edits = [
      (p: ReturnType<typeof payload>) => ((p.kdf as { iterations: number }).iterations = ITER + 1),
      (p: ReturnType<typeof payload>) => ((p.kdf as { salt: string }).salt = "AAAAAAAAAAAAAAAAAAAAAA"),
      (p: ReturnType<typeof payload>) => (p.ct = p.ct.slice(0, -2) + (p.ct.endsWith("A") ? "BB" : "AA")),
    ];
    for (const f of edits) {
      expect(await caught(() => unlockNote(withPayload(sealed, f), PW, { minPbkdf2Iterations: 1 }))).toBeInstanceOf(Error);
    }
    // A provider can't lower the KDF below the floor either.
    const weak = withPayload(sealed, (p) => ((p.kdf as { iterations: number }).iterations = 10));
    expect(await caught(() => unlockNote(weak, PW))).toBeInstanceOf(Error);
  });

  it("L7 a plain note that merely starts with the magic line is not an envelope", () => {
    expect(isEnvelopeText(`${LOCKED_NOTE_MAGIC}\nhello, I'm plain`)).toBe(false);
    expect(isEnvelopeText("lumen-locked:abc")).toBe(false);
  });

  it("L8 while open, a save of plain text reaches the disk sealed, and opens with the note's key", async () => {
    const d = disk();
    const { sealed, key } = await lockNote(TEXT, PW, { pbkdf2Iterations: ITER });
    d.files.set("s.md", sealed);
    rememberOpen("s.md", key, sealed, d.read);
    expect(isOpenLocked("s.md")).toBe(true);
    const out = await d.write("s.md", TEXT + "\nedited");
    expect(isEnvelopeText(out)).toBe(true);
    expect(out).not.toContain("edited");
    expect(await openSealed(out, key, POLICY)).toBe(TEXT + "\nedited");
  });

  it("L9 once locked again, plain text from a tool or an old tab is refused (LockedNoteOverwriteError)", async () => {
    const d = disk();
    const { sealed, key } = await lockNote(TEXT, PW, { pbkdf2Iterations: ITER });
    d.files.set("s.md", sealed);
    rememberOpen("s.md", key, sealed, d.read);
    forgetOpen("s.md");
    expect(isOpenLocked("s.md")).toBe(false);
    expect(await caught(() => d.write("s.md", "plain text from an old tab"))).toBeInstanceOf(LockedNoteOverwriteError);
    expect(d.files.get("s.md")).toBe(sealed);
  });

  it("L10 once locked, another envelope is refused — even one sealed with a copy of the note's salt and KDF", async () => {
    const d = disk();
    const { sealed, key } = await lockNote(TEXT, PW, { pbkdf2Iterations: ITER });
    d.files.set("s.md", sealed);
    rememberOpen("s.md", key, sealed, d.read);
    forgetOpen("s.md");
    const other = await lockNote("junk", "the attacker's password", { pbkdf2Iterations: ITER });
    expect(await caught(() => d.write("s.md", other.sealed))).toBeInstanceOf(LockedNoteOverwriteError);
    // Copy the note's kdf (salt included) into the attacker's envelope.
    const copied = withPayload(other.sealed, (p) => (p.kdf = payload(sealed).kdf));
    expect(await caught(() => d.write("s.md", copied))).toBeInstanceOf(LockedNoteOverwriteError);
    expect(d.files.get("s.md")).toBe(sealed);
  });

  it("L11 once locked, the very same envelope byte for byte is accepted", async () => {
    const d = disk();
    const { sealed, key } = await lockNote(TEXT, PW, { pbkdf2Iterations: ITER });
    d.files.set("s.md", sealed);
    rememberOpen("s.md", key, sealed, d.read);
    forgetOpen("s.md");
    await expect(d.write("s.md", sealed)).resolves.toBe(sealed);
  });

  it("L12 allowEnvelopeWrite lets one other envelope through (a sync pull), never plain text; allowPlainWrite lets plain text through", async () => {
    const d = disk();
    const { sealed, key } = await lockNote(TEXT, PW, { pbkdf2Iterations: ITER });
    d.files.set("s.md", sealed);
    rememberOpen("s.md", key, sealed, d.read);
    forgetOpen("s.md");
    const newer = await sealNote(TEXT + "\nfrom another device", key);
    allowEnvelopeWrite("s.md");
    expect(await caught(() => d.write("s.md", "plain"))).toBeInstanceOf(LockedNoteOverwriteError);
    allowEnvelopeWrite("s.md");
    await expect(d.write("s.md", newer)).resolves.toBe(newer);
    allowPlainWrite("s.md");
    await expect(d.write("s.md", "password removed")).resolves.toBe("password removed");
  });

  it("L13 while open, an envelope that opens with the note's key is written as it is", async () => {
    const d = disk();
    const { sealed, key } = await lockNote(TEXT, PW, { pbkdf2Iterations: ITER });
    d.files.set("s.md", sealed);
    rememberOpen("s.md", key, sealed, d.read);
    const resealed = await sealNote("v2", key);
    await expect(d.write("s.md", resealed)).resolves.toBe(resealed);
  });

  it("L14 an ordinary note is written as it is", async () => {
    const d = disk();
    await expect(d.write("plain.md", "# hello")).resolves.toBe("# hello");
  });
});
