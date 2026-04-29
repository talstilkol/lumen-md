import { describe, it, expect, vi } from "vitest";

vi.mock("../store/useStore", () => ({
  useAppStore: {
    getState: vi.fn().mockReturnValue({
      aiKey: null,
      useLocalAi: false,
      doc: { content: "" },
      setContent: vi.fn(),
    }),
  },
}));
vi.mock("./AiToast", () => ({
  showAiToast: vi.fn(),
}));
vi.mock("../ui/AiToast", () => ({
  showAiToast: vi.fn(),
}));
vi.mock("../i18n", () => ({ t: (k: string, p?: Record<string, string>) => {
  if (p) return Object.entries(p).reduce((s, [k2, v]) => s.replace(`{${k2}}`, v), k);
  return k;
}}));
vi.mock("../lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../ai/transcribe", () => ({
  transcribe: vi.fn().mockResolvedValue({ text: "hello", backend: "cloud", ms: 500 }),
  summarizeMemo: vi.fn().mockResolvedValue("• summary bullet"),
  formatVoiceMemo: vi.fn().mockReturnValue("> 🎙 Voice memo\n\n> Summary"),
}));

describe("VoiceDictation module exports", () => {
  it("exports startVoiceRecording function", async () => {
    const mod = await import("../ui/VoiceDictation");
    expect(typeof mod.startVoiceRecording).toBe("function");
  });

  it("exports startVoiceMemo function", async () => {
    const mod = await import("../ui/VoiceDictation");
    expect(typeof mod.startVoiceMemo).toBe("function");
  });

  it("startVoiceRecording shows error toast when SpeechRecognition unavailable", async () => {
    const { showAiToast } = await import("../ui/AiToast") as any;
    const { startVoiceRecording } = await import("../ui/VoiceDictation");
    // Remove SpeechRecognition from window to simulate unsupported browser
    const original = (window as any).SpeechRecognition;
    delete (window as any).SpeechRecognition;
    delete (window as any).webkitSpeechRecognition;
    startVoiceRecording("en");
    expect(showAiToast).toHaveBeenCalledWith(
      expect.stringContaining("not supported"),
      "error",
    );
    if (original) (window as any).SpeechRecognition = original;
  });

  it("startVoiceMemo shows error toast when MediaRecorder unavailable", async () => {
    const { showAiToast } = await import("../ui/AiToast") as any;
    const { startVoiceMemo } = await import("../ui/VoiceDictation");
    const original = (window as any).MediaRecorder;
    (window as any).MediaRecorder = undefined;
    await startVoiceMemo();
    expect(showAiToast).toHaveBeenCalledWith(
      expect.stringContaining("not supported"),
      "error",
    );
    if (original) (window as any).MediaRecorder = original;
  });
});
