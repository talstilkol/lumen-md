/**
 * W12.F8: transcript tracks for audio and video. WebVTT and SRT are written
 * from timed sentences, as the meeting flow has them (synthetic Hebrew
 * sentences here), and checked against the parts of the W3C WebVTT spec a
 * player relies on. `![[rec.m4a]]` becomes a player with its transcript, and
 * clicking a line moves the player there.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { cueAt, cuesFromSentences, parseTrack, sidecarPath, timestamp, toSrt, toWebVtt } from "../media/webvtt";
import { MediaEmbed, type MediaIo } from "../media/MediaEmbed";
import { embedImages } from "../renderer/remarkObsidian";
import { writeTranscriptTracks } from "../meetings/meetingTranscribe";

afterEach(cleanup);

const SENTENCES = [
  { start: 0.5, end: 3.2, text: "שלום לכולם, נתחיל בסיכום השבוע.", speaker: "דנה" },
  { start: 3.4, end: 7.05, text: "התקציב עבר <בקושי> & בזמן.", speaker: "יוסי" },
  { start: 7.1, end: 3725.25, text: "נקבע פגישה --> ביום ראשון.", speaker: null },
];

describe("writing WebVTT and SRT", () => {
  it("timestamps", () => {
    expect(timestamp(0)).toBe("00:00:00.000");
    expect(timestamp(3725.25)).toBe("01:02:05.250");
    expect(timestamp(7.05, ",")).toBe("00:00:07,050");
  });

  it("a Hebrew transcript becomes valid WebVTT: signature, timings, voices, escaped text", () => {
    const vtt = toWebVtt(cuesFromSentences(SENTENCES), { language: "he" });
    expect(vtt.startsWith("WEBVTT\nLanguage: he\n\n1\n00:00:00.500 --> 00:00:03.200\n<v דנה>שלום לכולם, נתחיל בסיכום השבוע.\n")).toBe(true);
    expect(vtt).toContain("<v יוסי>התקציב עבר &lt;בקושי&gt; &amp; בזמן.");
    expect(vtt).toContain("00:00:07.100 --> 01:02:05.250\nנקבע פגישה → ביום ראשון.");
    const back = parseTrack(vtt);
    expect(back.errors).toEqual([]);
    expect(back.cues).toEqual([
      { start: 0.5, end: 3.2, text: "שלום לכולם, נתחיל בסיכום השבוע.", voice: "דנה" },
      { start: 3.4, end: 7.05, text: "התקציב עבר <בקושי> & בזמן.", voice: "יוסי" },
      { start: 7.1, end: 3725.25, text: "נקבע פגישה → ביום ראשון.", voice: null },
    ]);
  });

  it("SRT: numbered cues with comma milliseconds, the speaker as a prefix, read back", () => {
    const srt = toSrt(cuesFromSentences(SENTENCES));
    expect(srt.split("\n").slice(0, 3)).toEqual(["1", "00:00:00,500 --> 00:00:03,200", "דנה: שלום לכולם, נתחיל בסיכום השבוע."]);
    const back = parseTrack(srt, "srt");
    expect(back.errors).toEqual([]);
    expect(back.cues.map((c) => c.voice)).toEqual(["דנה", "יוסי", null]);
  });

  it("the validator catches what breaks a player", () => {
    expect(parseTrack("00:00:01.000 --> 00:00:02.000\nx\n").errors[0]).toMatch(/WEBVTT/);
    expect(parseTrack("WEBVTT\n\n00:00:01,000 --> 00:00:02.000\nx\n").errors[0]).toMatch(/bad timestamp/);
    expect(parseTrack("WEBVTT\n\n00:00:05.000 --> 00:00:02.000\nx\n").errors[0]).toMatch(/ends before/);
    expect(parseTrack("WEBVTT\n\n00:00:05.000 --> 00:00:06.000\na\n\n00:00:01.000 --> 00:00:02.000\nb\n").errors[0]).toMatch(/in order/);
    expect(parseTrack("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\na --> b\n").errors[0]).toMatch(/"-->" in the text/);
    // NOTE blocks, identifiers, cue settings, hour-less times and markup are fine.
    const ok = parseTrack("WEBVTT - talk\n\nNOTE written by hand\n\nintro\n01:02.500 --> 01:04.000 align:start\n<i>שלום</i> <c.loud>עולם</c>\n");
    expect(ok.errors).toEqual([]);
    expect(ok.cues).toEqual([{ start: 62.5, end: 64, text: "שלום עולם", voice: null }]);
  });

  it("the cue at a time", () => {
    const cues = cuesFromSentences(SENTENCES);
    expect(cueAt(cues, 0.1)).toBe(-1);
    expect(cueAt(cues, 4)).toBe(1);
    expect(cueAt(cues, 7.1)).toBe(2);
  });

  it("the meeting flow proposes rec.m4a.vtt and rec.m4a.srt beside the audio, from its own sentences (Z7-M5)", async () => {
    const written = new Map<string, string>();
    const paths = await writeTranscriptTracks("attachments/פגישה.m4a", SENTENCES, { read: async () => null, propose: (c) => void written.set(c.path, c.after) });
    expect(paths).toEqual(["attachments/פגישה.m4a.vtt", "attachments/פגישה.m4a.srt"]);
    expect(parseTrack(written.get("attachments/פגישה.m4a.vtt")!).errors).toEqual([]);
    expect(written.get("attachments/פגישה.m4a.vtt")).toContain("Language: he");
    expect(sidecarPath("a/b.c/talk.mp4", "srt")).toBe("a/b.c/talk.srt");
  });
});

describe("![[rec.m4a]] in a note", () => {
  it("becomes a media element, not an image or a note embed", () => {
    const tree = { type: "root", children: [{ type: "paragraph", children: [{ type: "text", value: "הקלטה: ![[rec.m4a]] וגם ![[pic.png]]" }] }] };
    embedImages(tree as never);
    const kids = (tree.children[0] as { children: Array<{ type: string; data?: { hName?: string; hProperties?: Record<string, unknown> }; url?: string }> }).children;
    expect(kids.map((k) => k.type)).toEqual(["text", "mediaEmbed", "text", "image"]);
    expect(kids[1].data).toMatchObject({ hName: "lumen-mediaembed", hProperties: { target: "rec.m4a" } });
  });

  it("shows the transcript beside the player; clicking a line moves currentTime", async () => {
    const vtt = toWebVtt(cuesFromSentences(SENTENCES));
    const io: MediaIo = {
      resolve: async (t) => (t === "rec.m4a" ? "attachments/rec.m4a" : null),
      readBlob: async () => new Blob([new Uint8Array([0, 1, 2])], { type: "audio/mp4" }),
      readText: async (p) => (p === "attachments/rec.vtt" ? vtt : null),
    };
    const { container } = render(<MediaEmbed target="rec.m4a" io={io} />);
    const line = await screen.findByRole("button", { name: "Play from 0:03" });
    const audio = container.querySelector("audio") as HTMLAudioElement;
    expect(audio).toBeTruthy();
    expect(container.querySelectorAll(".media-transcript li")).toHaveLength(3);
    expect(container.textContent).toContain("התקציב עבר <בקושי> & בזמן.");
    fireEvent.click(line);
    expect(audio.currentTime).toBeCloseTo(3.4, 5);
    await waitFor(() => expect(container.querySelector('li[aria-current="true"]')?.textContent).toContain("התקציב"));
  });

  it("a video gets a <video> with a captions track; a missing file says so", async () => {
    const io: MediaIo = {
      resolve: async (t) => (t === "talk.mp4" ? "talk.mp4" : null),
      readBlob: async () => new Blob([new Uint8Array([0])], { type: "video/mp4" }),
      readText: async (p) => (p === "talk.srt" ? "1\n00:00:01,000 --> 00:00:02,000\nשלום\n" : null),
    };
    const { container } = render(<MediaEmbed target="talk.mp4" io={io} />);
    await screen.findByRole("button", { name: "Play from 0:01" });
    expect(container.querySelector("video track[kind=captions]")).toBeTruthy();
    cleanup();
    render(<MediaEmbed target="gone.mp3" io={io} />);
    expect(await screen.findByText("Not in the vault: gone.mp3")).toBeTruthy();
  });
});
