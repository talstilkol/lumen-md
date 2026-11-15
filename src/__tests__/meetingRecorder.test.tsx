/**
 * The meeting recorder (W11.I19, W11.I21) end to end with a mock engine:
 * the recorder, the real flow (processMeeting), the real note and the real
 * privacy ledger in audit mode — every fetch the page makes is listed — so
 * "0 network calls" is read from the ledger the privacy panel shows.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { MeetingRecorder, type RecorderDeps } from "../meetings/MeetingRecorder";
import { processMeeting, type MeetingAvailability, type MeetingDeps } from "../meetings/meetingFlow";
import { AUDIT_MODE_KEY, __resetLedger, ledgerEntries, withLedger } from "../ai/privacyLedger";
import { buildVoiceCommands } from "../commands/domains/voice";
import { diarizationAvailable } from "../meetings/diarizePins";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const realFetch = globalThis.fetch;
let offDevice = 0;
beforeEach(() => {
  __resetLedger();
  localStorage.setItem(AUDIT_MODE_KEY, "1");
  offDevice = 0;
  globalThis.fetch = withLedger(async () => {
    offDevice++;
    throw new Error("no network in this test");
  });
});
afterEach(() => {
  globalThis.fetch = realFetch;
  localStorage.removeItem(AUDIT_MODE_KEY);
});

const avail = (over: Partial<MeetingAvailability> = {}): MeetingAvailability => ({ live: true, zipformer: true, whisper: null, diarization: false, available: true, ...over });

function setup(over: { availability?: MeetingAvailability; consent?: boolean } = {}) {
  let clock = 0;
  const written: string[] = [];
  const opened: string[] = [];
  let recorded = 0;
  let finalCb: ((text: string) => void) | null = null;
  let partialCb: ((text: string) => void) | null = null;
  const meeting: MeetingDeps = {
    availability: async () => over.availability ?? avail(),
    transcribe: async () => null,
    summarize: async () => Promise.reject(new Error("no local model")),
    notes: async () => ({ decisions: [], tasks: [{ text: "Send the minutes to the team", owner: "Noa" }], questions: [] }),
    speakers: async () => ["S1", "S2"],
    consent: async () => over.consent ?? true,
    write: async (_p, _a, md) => void written.push(md),
  };
  const deps: RecorderDeps = {
    meeting,
    record: async () => {
      recorded++;
      return { stop: async () => ({ audio: new Blob(["x"], { type: "audio/webm" }), durationMs: 70_000 }), cancel: () => {} };
    },
    live: async (o) => {
      finalCb = o.onFinal;
      partialCb = o.onPartial;
      return { stop: async () => "", cancel: () => {} };
    },
    process: processMeeting,
    open: (p) => void opened.push(p),
    now: () => clock,
    language: "en",
  };
  return {
    deps,
    written,
    opened,
    recorded: () => recorded,
    advance: (ms: number) => (clock += ms),
    say: (text: string) => {
      partialCb?.(text);
      finalCb?.(text);
    },
  };
}

async function mount(deps: RecorderDeps) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(MeetingRecorder, { onClose: () => {}, deps })));
  await act(async () => {});
  const q = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  return { host, root, q };
}

describe("meeting recorder", () => {
  it("no transcription model on this device: says unavailable, offers no start, records nothing", async () => {
    const s = setup({ availability: avail({ live: false, zipformer: false, whisper: null, available: false }) });
    const { host, root, q } = await mount(s.deps);
    expect(host.querySelector('[data-testid="meeting-recorder"]')!.getAttribute("data-phase")).toBe("unavailable");
    expect(q("meeting-unavailable")!.textContent).toMatch(/^Unavailable: no transcription model is on this device/);
    expect(q("meeting-start")).toBeNull();
    expect(s.recorded()).toBe(0);
    await act(async () => root.unmount());
  });

  it("mock engine: records, shows the live text, writes a timed note after approval, opens it — 0 network calls in the privacy ledger", async () => {
    const s = setup();
    const { root, q } = await mount(s.deps);
    await act(async () => q("meeting-start")!.click());
    expect(q("meeting-clock")).not.toBeNull();
    s.advance(20_000);
    await act(async () => s.say("Noa will send the minutes to the team tomorrow."));
    expect(q("meeting-live")!.textContent).toBe("Noa will send the minutes to the team tomorrow.");
    s.advance(45_000);
    await act(async () => s.say("We meet again next week."));
    await act(async () => q("meeting-stop")!.click());
    await act(async () => {});
    expect(s.written).toHaveLength(1);
    const md = s.written[0];
    expect(md).toContain("[▶ 0:00](<audio/");
    expect(md).toContain("[▶ 0:20](<audio/");
    expect(md).toMatch(/- \[ \] Send the minutes to the team \[▶ 0:00\]\(<audio\/[^>]+#t=0,20>\) \(@Noa\) ⏳ \d{4}-\d{2}-\d{2}/);
    expect(s.opened).toHaveLength(1);
    expect(q("meeting-message")!.textContent).toBe("Meeting note saved: 2 sentences, 1 tasks.");
    expect(ledgerEntries()).toEqual([]);
    expect(offDevice).toBe(0);
    await act(async () => root.unmount());
  });

  it("declined: nothing written, the note shown to copy", async () => {
    const s = setup({ consent: false });
    const { root, q } = await mount(s.deps);
    await act(async () => q("meeting-start")!.click());
    s.advance(10_000);
    await act(async () => s.say("One short sentence."));
    await act(async () => q("meeting-stop")!.click());
    await act(async () => {});
    expect(s.written).toEqual([]);
    expect(q("meeting-message")!.textContent).toBe("Not saved: you declined. The note is below, to copy.");
    expect((q("meeting-draft") as HTMLTextAreaElement).value).toContain("One short sentence.");
    await act(async () => root.unmount());
  });

  it("W11.I21: without a diarization model there is no speaker label in the recorder or the note", async () => {
    const s = setup();
    const { host, root, q } = await mount(s.deps);
    expect(q("meeting-engines")!.textContent).toContain("Speakers are not identified");
    await act(async () => q("meeting-start")!.click());
    s.advance(5_000);
    await act(async () => s.say("Hello there."));
    await act(async () => q("meeting-stop")!.click());
    await act(async () => {});
    expect(host.textContent).not.toMatch(/\bS\d+\b/);
    expect(s.written[0]).not.toMatch(/\*\*S\d+:\*\*/);
    await act(async () => root.unmount());
  });

  it("W11.I21: the speaker commands are not in the palette while the diarization models are not pinned", () => {
    expect(diarizationAvailable()).toBe(false);
    const ids = buildVoiceCommands().map((c) => c.id);
    expect(ids).toContain("voice.meeting");
    expect(ids).toContain("voice.meetingFile");
    expect(ids).not.toContain("speakers.rename");
  });
});
