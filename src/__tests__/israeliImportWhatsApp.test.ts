/**
 * Israeli import scorecard (lane T8), WhatsApp: 6 "Export chat" files of our
 * own (fixtures/israeli-import/whatsapp) — Android and iPhone, Hebrew and
 * English (US) phones, dd.mm.yyyy, dd/mm/yyyy and M/D/YY, 24- and 12-hour
 * clocks (AM/PM with the narrow no-break space, לפנה״צ / אחה״צ), direction
 * marks — each with the note a person expects (one note for the chat).
 * WhatsApp's own lists ("- ", "* ", "1. ") and quotes ("> ") are structure
 * and must survive as Markdown, like nikud and mixed-direction lines:
 * ./helpers/israeliImport.ts says what is checked. 6/6.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseWhatsApp } from "../capture/chats/whatsapp";
import { renderChat, type RenderStrings } from "../capture/chats/notes";
import { scoreLine, scoreNote } from "./helpers/israeliImport";

const DIR = join(__dirname, "fixtures/israeli-import/whatsapp");
const S: RenderStrings = { missing: "(not in the export)", omitted: "(media left out of the export)", forwarded: (n) => `forwarded from ${n}`, reply: (i) => `in reply to message ${i}` };
/** The name each app gives the file (Android names the chat; an iPhone writes _chat.txt). */
const FILE: Record<string, string> = {
  "wa-1-android-he-dots": "WhatsApp Chat with משפחה.txt",
  "wa-2-android-en-us": "WhatsApp Chat with Dana.txt",
  "wa-3-android-he-12h": "WhatsApp Chat with פסח.txt",
  "wa-4-ios-he": "_chat.txt",
  "wa-5-ios-en-us": "_chat.txt",
  "wa-6-ios-he-slashes": "_chat.txt",
};
const cases = readdirSync(DIR)
  .filter((f) => f.endsWith(".txt"))
  .sort()
  .map((f) => f.replace(/\.txt$/, ""));

describe("Israeli import: WhatsApp chat exports", () => {
  it("has 6 exports: 3 Android, 3 iPhone", () => {
    expect(cases).toEqual(Object.keys(FILE).sort());
  });

  const results = cases.map((c) => {
    const chat = parseWhatsApp(readFileSync(join(DIR, `${c}.txt`), "utf8"), FILE[c]);
    const [note] = renderChat(chat, { grouping: "chat", mediaPath: (n) => `media/${n}`, strings: S });
    const unread = chat.unreadable.length ? [`unreadable lines: ${chat.unreadable.join(" / ")}`] : [];
    const r = scoreNote(c, note.content, readFileSync(join(DIR, `${c}.md`), "utf8"));
    return { ...r, pass: r.pass && !unread.length, problems: [...unread, ...r.problems] };
  });
  for (const r of results) it(`${r.name} keeps everything`, () => expect(r.problems).toEqual([]));

  it("score: 6/6", () => {
    console.log(`israeli-import whatsapp ${scoreLine(results)}`);
    expect(results.filter((r) => r.pass).length).toBe(6);
  });
});
