/**
 * The local meeting flow (W11.I19, W11.I20): timed transcript, checked
 * summary and notes, tasks into the Today view and the meeting Base, and
 * the Rule of Two before anything from the transcript is written. The
 * engines are fakes (the acceptance's "mock engine / mock model"); the
 * flow, the checks, the note, the task parser, the Today query and the
 * Bases runner are the real ones.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { capSentences, checkNotes, longestLine, meetingNote, meetingSentences, segmentsOfFinals, sourceOf, STAMP_EVERY_SEC, type TimedFinal } from "../meetings/meetingFlowCore";
import { cachedWhisper, processMeeting, writerTranscript, TRANSCRIPT_SOURCE, type MeetingAvailability, type MeetingDeps } from "../meetings/meetingFlow";
import { checkedLectureSummarizer } from "../student/lectureSummarizer";
import { tasksInNote } from "../tasks/taskParser";
import { parseQuery, runQuery } from "../tasks/taskQuery";
import { TODAY_QUERY } from "../tasks/TasksPanel";
import { basesFileFromText, parseBase, runBase } from "../views/bases/base";

const LINES = [
  "Good morning everyone, let's start the weekly planning meeting.",
  "The budget for the spring campaign is ready.",
  "Dana will send the budget table to the committee by Thursday.",
  "We decided to move the launch to the second week of March.",
  "Yossi will check the legal opinion on the new contract.",
  "Who owns the website copy is still an open question.",
  "Thanks, that's all for today.",
];
// One final every 25 s: 7 sentences over 175 s.
const FINALS: TimedFinal[] = LINES.map((text, i) => ({ at: 25 * (i + 1), text }));
const DURATION_MS = 180_000;
const WHEN = new Date(2026, 10, 15, 9, 30);

const avail = (over: Partial<MeetingAvailability> = {}): MeetingAvailability => ({ live: true, zipformer: true, whisper: null, diarization: false, available: true, ...over });

function deps(over: Partial<MeetingDeps> = {}): MeetingDeps & { written: Array<{ path: string; md: string }>; asked: unknown[] } {
  const written: Array<{ path: string; md: string }> = [];
  const asked: unknown[] = [];
  return {
    written,
    asked,
    availability: async () => avail(),
    transcribe: async () => null,
    // The checked lecture summarizer (W10.C9) over a mock model: one sentence copied, one made up.
    summarize: (s, signal) => checkedLectureSummarizer(async () => "We decided to move the launch to the second week of March.\nThe board approved a bonus for everyone.", "English")(s, new Set(), signal),
    notes: async () => ({
      decisions: ["Move the launch to the second week of March", "Hire three new designers"],
      tasks: [
        { text: "Send the budget table to the committee", owner: "Dana", due: "2026-11-19" },
        { text: "Check the legal opinion on the contract", owner: "Yossi" },
        { text: "Book flights to the Paris trade fair" },
      ],
      questions: ["Who owns the website copy?"],
    }),
    speakers: async () => {
      throw new Error("no diarization in this test");
    },
    consent: async (req) => {
      asked.push(req);
      return true;
    },
    write: async (paths, _audio, md) => {
      written.push({ path: paths.note, md });
    },
    ...over,
  };
}

const audio = () => new Blob([new Uint8Array(16)], { type: "audio/webm" });
const run = (d: MeetingDeps, finals: TimedFinal[] = FINALS) => processMeeting(audio(), { durationMs: DURATION_MS, finals, title: "Weekly planning", when: WHEN }, d);

describe("W11.I19 — a timed transcript, a time at least every 60 s", () => {
  it("live finals become sentences timed from the previous final to their own", () => {
    const s = segmentsOfFinals([{ at: 4.2, text: "one." }, { at: 9, text: " two. " }], 10);
    expect(s).toEqual([{ start: 0, end: 4.2, text: "one." }, { start: 4.2, end: 9, text: "two." }]);
  });

  it("a ten-minute run of speech without punctuation is cut into lines of 60 s or less", () => {
    const words = Array.from({ length: 1200 }, (_, i) => `word${i}`).join(" ");
    const out = meetingSentences([{ start: 0, end: 600, text: words }]);
    expect(out.length).toBeGreaterThanOrEqual(10);
    expect(longestLine(out)).toBeLessThanOrEqual(STAMP_EVERY_SEC);
    expect(out.map((x) => x.text).join(" ")).toBe(words);
    expect(out[out.length - 1].end).toBe(600);
  });

  it("capSentences leaves short lines alone", () => {
    const s = [{ start: 0, end: 30, text: "a b c" }];
    expect(capSentences(s)).toEqual(s);
  });

  it("mock engine: the meeting note is written with a ▶ time on every line, none spanning more than 60 s", async () => {
    const d = deps();
    const res = await run(d);
    expect(res.saved).toBe(true);
    expect(d.written).toHaveLength(1);
    const md = d.written[0].md;
    expect(d.written[0].path).toBe("Meetings/2026-11-15 0930 Weekly planning.md");
    const transcript = md.slice(md.indexOf("## Transcript"));
    const lines = transcript.split("\n").filter((l) => l.startsWith("[▶"));
    expect(lines).toHaveLength(LINES.length);
    expect(lines[2]).toContain("(<audio/meeting-2026-11-15-0930.webm#t=50,75>)");
    const starts = lines.map((l) => /#t=(\d+),(\d+)/.exec(l)!).map((m) => [Number(m[1]), Number(m[2])]);
    for (const [a, b] of starts) expect(b - a).toBeLessThanOrEqual(STAMP_EVERY_SEC);
    expect(md).toMatch(/^---\ntype: meeting\ndate: 2026-11-15\n/);
    expect(md).toContain('meeting-transcript: "zipformer-live"');
  });

  it("a timed Whisper pass replaces the live text (the W1.17 correction); a file pass only fills in when nothing was heard live", async () => {
    const whisper = deps({ transcribe: async () => ({ segments: [{ start: 0, end: 20, text: "Corrected opening sentence." }], engine: "whisper" }) });
    expect((await run(whisper)).engine).toBe("whisper");
    const file = deps({ transcribe: async () => ({ segments: [{ start: 0, end: 20, text: "File pass." }], engine: "zipformer-file" }) });
    expect((await run(file)).engine).toBe("zipformer-live");
    expect((await run(file, [])).engine).toBe("zipformer-file");
  });

  it("nothing heard: no note, an error", async () => {
    const d = deps();
    await expect(run(d, [])).rejects.toThrow();
    expect(d.written).toEqual([]);
  });

  it("only a Whisper model already in the cache is used (none: null, so nothing downloads)", () => {
    const urls = ["https://huggingface.co/onnx-community/whisper-small/resolve/main/onnx/encoder_model.onnx", "https://huggingface.co/onnx-community/whisper-tiny/resolve/main/config.json"];
    expect(cachedWhisper(urls, "en")).toBe("onnx-community/whisper-small");
    expect(cachedWhisper(urls.slice(1), "he")).toBeNull();
    expect(cachedWhisper(["https://huggingface.co/itayinbar/Ozen-v1/resolve/main/onnx/decoder.onnx"], "en")).toBeNull();
    expect(cachedWhisper(["https://huggingface.co/itayinbar/Ozen-v1/resolve/main/onnx/decoder.onnx"], "he")).toBe("itayinbar/Ozen-v1");
  });
});

describe("W11.I19 — the Rule of Two before writing what the transcript produced", () => {
  it("asks once, as a write from outside content, before anything is written", async () => {
    const d = deps();
    await run(d);
    expect(d.asked).toEqual([{ tool: "meeting.save", scope: "write", args: { path: "Meetings/2026-11-15 0930 Weekly planning.md", tasks: 2, decisions: 1 }, sources: [TRANSCRIPT_SOURCE] }]);
  });

  it("declined: nothing is written, and the note comes back to copy", async () => {
    const d = deps({ consent: async () => false });
    const write = vi.fn(async () => {});
    const res = await run({ ...d, write });
    expect(write).not.toHaveBeenCalled();
    expect(res.saved).toBe(false);
    expect(res.markdown).toContain("## Tasks");
  });
});

describe("W11.I20 — summary, tasks and decisions checked against the transcript", () => {
  it("mock model: a task is linked to the moment it was said", async () => {
    const d = deps();
    await run(d);
    const md = d.written[0].md;
    // "Dana will send the budget table…" is the 3rd final: 50–75 s.
    expect(md).toContain("- [ ] Send the budget table to the committee [▶ 0:50](<audio/meeting-2026-11-15-0930.webm#t=50,75>) (@Dana) 📅 2026-11-19");
    expect(md).toContain("- [ ] Check the legal opinion on the contract [▶ 1:40](<audio/meeting-2026-11-15-0930.webm#t=100,125>) (@Yossi) ⏳ 2026-11-15");
  });

  it("a summary sentence with no source in the transcript is rejected; so are notes the transcript never said", async () => {
    const d = deps();
    const res = await run(d);
    const md = d.written[0].md;
    expect(res.summary).toBe("checked");
    const summary = md.slice(md.indexOf("## Summary"), md.indexOf("## Decisions"));
    expect(summary).toContain("We decided to move the launch to the second week of March.");
    expect(summary).not.toContain("bonus");
    expect(md).not.toContain("Paris");
    expect(md).not.toContain("designers");
    expect(res.rejected).toBe(2);
    expect(md).toContain("2 items the model wrote had no source in the transcript and were left out.");
  });

  it("sourceOf: half the item's words in one sentence, or two adjacent ones; nothing else", () => {
    const s = meetingSentences(segmentsOfFinals(FINALS, 180));
    expect(sourceOf("send budget table to committee", s)).toBe(2);
    expect(sourceOf("book flights to Paris", s)).toBe(-1);
    expect(sourceOf("", s)).toBe(-1);
    expect(checkNotes({ decisions: [], tasks: [{ text: "the a an" }], questions: [] }, s).rejected).toEqual(["the a an"]);
  });

  it("no local model: an extractive summary and no notes, and the note says so", async () => {
    const d = deps({ summarize: async () => Promise.reject(new Error("no local model")), notes: async () => Promise.reject(new Error("no local model")) });
    const res = await run(d);
    expect(res.summary).toBe("extractive");
    expect(res.tasks).toBe(0);
    expect(d.written[0].md).toContain("No local model was available to find these.");
  });

  it("the tasks reach the Today view (⏳ the meeting's day) and Upcoming keeps the dated one; the meeting Base lists the note", async () => {
    const d = deps();
    await run(d);
    const { path, md } = d.written[0];
    const tasks = tasksInNote(path, md);
    expect(tasks.map((x) => x.description)).toEqual([
      "Send the budget table to the committee [▶ 0:50](<audio/meeting-2026-11-15-0930.webm#t=50,75>) (@Dana)",
      "Check the legal opinion on the contract [▶ 1:40](<audio/meeting-2026-11-15-0930.webm#t=100,125>) (@Yossi)",
    ]);
    const today = runQuery(parseQuery(TODAY_QUERY, WHEN), tasks, WHEN);
    expect(today.groups.flatMap((g) => g.tasks).map((x) => x.description)).toEqual([tasks[1].description]);
    const base = parseBase(readFileSync("public/templates/bases/il-team-meeting.base", "utf8"));
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const note = basesFileFromText(path, md);
    const other = basesFileFromText("Notes/x.md", "---\ntype: lecture\n---\n");
    expect(runBase(base.base, [note, other]).rows.map((r) => r.file.path)).toEqual([path]);
  });

  it("the writer reads one sentence per line, with a speaker only when one was given", () => {
    const s = [{ start: 0, end: 1, text: "a." }, { start: 1, end: 2, text: "b." }];
    expect(writerTranscript(s)).toBe("a.\nb.");
    expect(writerTranscript(s, ["S1", null])).toBe("S1: a.\nb.");
  });
});

describe("W11.I21 — speaker labels only from real diarization", () => {
  it("without a diarization model the speakers seam is never called and the note has no label", async () => {
    const speakers = vi.fn(async () => ["S1", "S2", "S1", "S2", "S1", "S2", "S1"]);
    const d = deps({ speakers });
    const res = await run(d);
    expect(speakers).not.toHaveBeenCalled();
    expect(res.speakers).toBe(0);
    expect(d.written[0].md).not.toMatch(/\*\*S\d+:\*\*/);
    expect(d.written[0].md).not.toContain("participants:");
  });

  it("with it, the labels it gave are on their lines (none made up when it returns nothing)", async () => {
    const labels = ["S1", "S2", "S1", "S2", "S1", "S2", "S1"];
    const d = deps({ availability: async () => avail({ diarization: true }), speakers: async () => labels });
    const res = await run(d);
    expect(res.speakers).toBe(2);
    expect(d.written[0].md).toContain("[▶ 0:25](<audio/meeting-2026-11-15-0930.webm#t=25,50>) **S2:** The budget");
    const none = deps({ availability: async () => avail({ diarization: true }), speakers: async () => null });
    await run(none);
    expect(none.written[0].md).not.toMatch(/\*\*S\d+:\*\*/);
  });

  it("meetingNote alone adds no label without speakers", () => {
    const s = meetingSentences(segmentsOfFinals(FINALS, 180));
    const md = meetingNote(
      { title: "t", date: "2026-11-15", audioLink: null, durationSec: 180, sentences: s, summary: [], notes: { decisions: [], tasks: [], questions: [], rejected: [] }, engine: "zipformer-live" },
      { recording: "R", summary: "S", summaryKind: "k", decisions: "D", tasks: "T", questions: "Q", none: "-", transcript: "X", rejected: null },
    );
    expect(md).not.toContain("**");
    expect(md).toContain("`0:50` Dana will send");
  });
});
