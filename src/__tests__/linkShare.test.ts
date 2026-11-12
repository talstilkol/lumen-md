// @vitest-environment node
/**
 * Plan W5.10 — an encrypted share link with no server (src/share/linkShare.ts).
 *
 * The acceptance "the server log holds no byte of the content or of the
 * key": everything a server can ever receive from a link is the part before
 * the #fragment (the request line; the Referer never carries a fragment).
 * These tests take that part from every link the module makes and check that
 * no byte of the note, of the data or of the key is in it. e2e/share-link.spec.ts
 * checks the same against every request a browser really sends.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createShareLink,
  fromBase64Url,
  isShareHash,
  MAX_LINK_DATA,
  openNote,
  parseShareHash,
  sealNote,
  shareFileData,
  ShareLinkError,
  toBase64Url,
  type SharedNote,
} from "../share/linkShare";

const ORIGIN = "https://lumen-md.vercel.app";

/** A 20 KB note in Hebrew and English (the acceptance's size). */
function note20k(): string {
  const para = "# סיכום פגישה\n\nשלום, זה פתק בעברית עם **הדגשה** ו-English words, רשימה:\n\n- פריט אחד\n- item two\n\n";
  let s = "";
  for (let i = 0; s.length < 20 * 1024; i++) s += `${para}שורה ${i}: ${"מידע ".repeat(i % 7)}${i * 7919}\n\n`;
  return s.slice(0, 20 * 1024);
}

/** What a server can receive from a link: everything before the fragment. */
const serverSide = (url: string) => url.split("#")[0];

async function expectThrows(p: Promise<unknown>, code: string) {
  let err: unknown = null;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  expect(err instanceof ShareLinkError ? err.code : String(err)).toBe(code);
}

describe("share link: the note and the key stay in the fragment", () => {
  it("a 20 KB note round-trips, and fits in a link", async () => {
    const markdown = note20k();
    const created = Date.UTC(2026, 10, 12);
    const link = await createShareLink({ title: "פגישה.md", markdown, created }, ORIGIN);
    expect(link.url).not.toBeNull();
    expect(link.dataChars).toBeLessThanOrEqual(MAX_LINK_DATA);
    const parsed = parseShareHash(new URL(link.url!).hash)!;
    const opened = await openNote(fromBase64Url(parsed.data!), fromBase64Url(parsed.key!));
    expect(opened).toEqual({ title: "פגישה.md", markdown, created });
  });

  it("no byte of the note, the data or the key is in the part a server receives", async () => {
    const markdown = note20k();
    const link = await createShareLink({ title: "secret title", markdown, created: 1 }, ORIGIN);
    const parsed = parseShareHash(new URL(link.url!).hash)!;
    for (const url of [link.url!, link.urlWithoutKey!, link.fileUrl]) {
      const sent = serverSide(url);
      // The request line is the app's page itself: no path, no query.
      expect(sent).toBe(`${ORIGIN}/`);
      const u = new URL(url);
      expect(u.pathname).toBe("/");
      expect(u.search).toBe("");
      for (const secret of [parsed.data!, parsed.key!, link.key, "secret title", markdown.slice(0, 40), "סיכום"]) {
        expect(sent.includes(secret), secret.slice(0, 20)).toBe(false);
        expect(sent.includes(encodeURIComponent(secret)), secret.slice(0, 20)).toBe(false);
      }
    }
    // And the fragment itself holds the key and the data only as base64url, never the text.
    expect(link.url!.includes("secret")).toBe(false);
    expect(decodeURIComponent(link.url!).includes("סיכום")).toBe(false);
  });

  it("every link gets a fresh key and IV: the same note twice gives unrelated links", async () => {
    const n: SharedNote = { title: "a", markdown: "same text", created: 5 };
    const [a, b] = await Promise.all([sealNote(n), sealNote(n)]);
    expect(toBase64Url(a.key)).not.toBe(toBase64Url(b.key));
    expect(toBase64Url(a.data.subarray(1, 13))).not.toBe(toBase64Url(b.data.subarray(1, 13)));
    expect(toBase64Url(a.data)).not.toBe(toBase64Url(b.data));
    expect(a.key.length).toBe(32);
    expect(toBase64Url(a.key)).toHaveLength(43);
  });
});

describe("share link: opening refuses anything but the real note", () => {
  const note: SharedNote = { title: "t", markdown: "hello **world**", created: 1000 };

  it("a changed byte, a wrong key and a cut link do not open", async () => {
    const { data, key } = await sealNote(note);
    const flipped = data.slice();
    flipped[flipped.length - 5] ^= 1;
    await expectThrows(openNote(flipped, key), "key");
    const other = await sealNote(note);
    await expectThrows(openNote(data, other.key), "key");
    await expectThrows(openNote(data.subarray(0, 20), key), "malformed");
    await expectThrows(openNote(data, key.subarray(0, 16)), "key");
    const v2 = data.slice();
    v2[0] = 2;
    await expectThrows(openNote(v2, key), "malformed");
    expect(() => fromBase64Url("not base64!")).toThrow(ShareLinkError);
  });

  it("the expiry inside the payload: open before it, refused after it", async () => {
    const { data, key } = await sealNote({ ...note, expires: 2000 });
    expect((await openNote(data, key, 1999)).expires).toBe(2000);
    await expectThrows(openNote(data, key, 2001), "expired");
  });
});

describe("share link: too large for a link → an encrypted file", () => {
  it("offers the file and a key-only link; the file opens with that key", async () => {
    // Random text does not compress: well over the cap.
    const s = Array.from(crypto.getRandomValues(new Uint8Array(40_000)), (b) => String.fromCharCode(33 + (b % 90))).join("");
    const link = await createShareLink({ title: "big", markdown: s, created: 1 }, ORIGIN);
    expect(link.dataChars).toBeGreaterThan(MAX_LINK_DATA);
    expect(link.url).toBeNull();
    expect(link.urlWithoutKey).toBeNull();
    expect(link.fileUrl).toBe(`${ORIGIN}/#view-file&key=${link.key}`);
    const data = shareFileData(link.file)!;
    expect(data).not.toBeNull();
    expect((await openNote(data, fromBase64Url(link.key))).markdown).toBe(s);
    expect(shareFileData(new TextEncoder().encode("not a share file"))).toBeNull();
  });
});

describe("share link: the fragment", () => {
  it("parses the full link, the key-less link and the file link", () => {
    expect(parseShareHash("#view=abc&key=def")).toEqual({ data: "abc", key: "def" });
    expect(parseShareHash("#view=abc")).toEqual({ data: "abc", key: null });
    expect(parseShareHash("#view-file&key=def")).toEqual({ data: null, key: "def" });
    expect(parseShareHash("#room=abc")).toBeNull();
    expect(parseShareHash("#viewer")).toBeNull();
    expect(parseShareHash("")).toBeNull();
    expect(isShareHash("#view")).toBe(true);
    expect(isShareHash("#views=1")).toBe(false);
  });

  it("the boot path (src/main.tsx) recognises the same fragments", () => {
    const main = readFileSync(join(__dirname, "..", "main.tsx"), "utf8");
    const src = /const SHARE_HASH = (\/.+\/);/.exec(main)![1];
    const re = new RegExp(src.slice(1, -1));
    for (const h of ["#view=abc&key=def", "#view=abc", "#view-file&key=x", "#view", "#room=a", "#viewer", "#views=1", ""]) {
      expect(re.test(h), h).toBe(isShareHash(h));
    }
  });
});
