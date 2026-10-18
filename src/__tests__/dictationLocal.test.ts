/** 1.3 — dictation runs on this device; the browser speech service never runs under local-only. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { chooseDictationEngine, downsampleTo16k, Segmenter, SerialQueue, WEB_SPEECH_KEY } from "../ai/dictation";

vi.mock("../ui/AiToast", () => ({ showAiToast: vi.fn() }));
vi.mock("../ui/PromptDialog", () => ({ uiConfirm: vi.fn(async () => true) }));

describe("engine choice", () => {
  it("local-only always dictates on the device, even after an opt-in", () => {
    expect(chooseDictationEngine("local-only", true, true)).toBe("local");
  });
  it("elsewhere the browser service needs both availability and the opt-in", () => {
    expect(chooseDictationEngine("local-first", true, false)).toBe("local");
    expect(chooseDictationEngine("cloud", false, true)).toBe("local");
    expect(chooseDictationEngine("cloud", true, true)).toBe("webspeech");
  });
});

describe("audio pipeline", () => {
  it("resamples 48 kHz to 16 kHz by averaging", () => {
    const x = new Float32Array(48000).map((_, i) => (i % 3) - 1); // -1, 0, 1 repeating → mean 0
    const y = downsampleTo16k(x, 48000);
    expect(y.length).toBe(16000);
    expect(Math.max(...y.slice(0, 100).map(Math.abs))).toBeLessThan(1e-6);
  });

  it("emits fixed-length segments and drops silent ones", () => {
    const out: number[] = [];
    const seg = new Segmenter({ rate: 16000, seconds: 1, onSegment: (s) => out.push(s.length) });
    seg.push(new Float32Array(8000).fill(0.2));
    expect(out).toEqual([]);
    seg.push(new Float32Array(8000).fill(0.2)); // 1 s of sound → one segment
    seg.push(new Float32Array(16000)); // 1 s of silence → dropped
    seg.push(new Float32Array(4000).fill(0.3));
    seg.flush(); // the 0.25 s tail
    expect(out).toEqual([16000, 4000]);
  });

  it("transcribes segments one at a time, in order, past a failure", async () => {
    const q = new SerialQueue();
    const seen: number[] = [];
    void q.add(async () => {
      await new Promise((r) => setTimeout(r, 5));
      seen.push(1);
    });
    void q.add(async () => {
      throw new Error("segment failed");
    });
    void q.add(async () => {
      seen.push(3);
    });
    await q.idle();
    expect(seen).toEqual([1, 3]);
  });
});

describe("startVoiceRecording and the privacy policy", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("under local-only, with no on-device path, it never starts the browser service and logs the block", async () => {
    localStorage.setItem("lumen.ai.policy", "local-only");
    localStorage.setItem(WEB_SPEECH_KEY, "1");
    const ctor = vi.fn();
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = ctor;
    const { ledgerEntries } = await import("../ai/privacyLedger");
    const before = ledgerEntries().length;
    const { startVoiceRecording } = await import("../ui/VoiceDictation");
    startVoiceRecording("he-IL"); // jsdom has no getUserMedia → local path unavailable
    await new Promise((r) => setTimeout(r, 0));
    expect(ctor).not.toHaveBeenCalled();
    const added = ledgerEntries().slice(before);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ host: "browser speech recognition", decision: "blocked" });
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  });

  it("outside local-only it asks first, then uses the browser service and logs it", async () => {
    localStorage.setItem("lumen.ai.policy", "local-first");
    const started = vi.fn();
    class FakeSR {
      lang = "";
      interimResults = false;
      continuous = false;
      onresult = null;
      onerror = null;
      onend = null;
      start = started;
      stop() {}
    }
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeSR;
    const { ledgerEntries } = await import("../ai/privacyLedger");
    const before = ledgerEntries().length;
    const { startVoiceRecording } = await import("../ui/VoiceDictation");
    const { uiConfirm } = await import("../ui/PromptDialog");
    startVoiceRecording("en-US");
    await vi.waitFor(() => expect(started).toHaveBeenCalled());
    expect(uiConfirm).toHaveBeenCalled();
    expect(localStorage.getItem(WEB_SPEECH_KEY)).toBe("1");
    expect(ledgerEntries().slice(before)[0]).toMatchObject({ host: "browser speech recognition", decision: "allowed" });
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    document.getElementById("voice-recording-root")?.remove();
  });
});
