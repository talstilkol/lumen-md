/** 1.5 — read-aloud uses on-device voices only under local-only; network voices need an opt-in and are logged. */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { voiceFor, networkVoicesAllowed, allowNetworkVoices, hasLocalVoiceFor, offersNetworkVoices, speak, NETWORK_VOICES_KEY } from "../ai/tts";
import { ledgerEntries } from "../ai/privacyLedger";

type V = Pick<SpeechSynthesisVoice, "name" | "lang" | "localService">;
const voices: V[] = [
  { name: "Google עברית", lang: "he-IL", localService: false },
  { name: "Samantha", lang: "en-US", localService: true },
];
const spoken: string[] = [];

beforeEach(() => {
  localStorage.clear();
  spoken.length = 0;
  vi.stubGlobal("SpeechSynthesisUtterance", class {
    text: string;
    lang = "";
    voice: V | null = null;
    rate = 1;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(text: string) {
      this.text = text;
    }
  });
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: {
      getVoices: () => voices,
      cancel: () => {},
      speak: (u: { text: string; onend: () => void }) => {
        spoken.push(u.text);
        u.onend();
      },
    },
  });
});

describe("read-aloud voices and the AI policy", () => {
  it("local-only never picks a network voice, even after an opt-in", () => {
    localStorage.setItem("lumen.ai.policy", "local-only");
    localStorage.setItem(NETWORK_VOICES_KEY, "1");
    expect(networkVoicesAllowed()).toBe(false);
    expect(voiceFor("he-IL")).toBeUndefined();
    expect(voiceFor("en-US")?.name).toBe("Samantha");
  });

  it("other policies use a network voice only after the opt-in", () => {
    localStorage.setItem("lumen.ai.policy", "local-first");
    expect(voiceFor("he-IL")).toBeUndefined();
    allowNetworkVoices();
    expect(networkVoicesAllowed()).toBe(true);
    expect(voiceFor("he-IL")?.name).toBe("Google עברית");
  });

  it("reports what is missing so the command can ask", () => {
    expect(offersNetworkVoices()).toBe(true);
    expect(hasLocalVoiceFor("Hello there.", "en")).toBe(true);
    expect(hasLocalVoiceFor("שלום לכולם.", "he")).toBe(false);
  });

  it("under local-only a Hebrew note is not sent to a network voice and nothing is logged", async () => {
    localStorage.setItem("lumen.ai.policy", "local-only");
    const before = ledgerEntries().length;
    const ok = await speak("שלום לכולם. Hello there.", { uiLang: "en" });
    expect(ok).toBe(false);
    expect(spoken).toEqual(["Hello there."]);
    expect(ledgerEntries().length).toBe(before);
  });

  it("an allowed network voice is recorded in the privacy ledger once per voice", async () => {
    localStorage.setItem("lumen.ai.policy", "local-first");
    allowNetworkVoices();
    const before = ledgerEntries().length;
    const ok = await speak("שלום לכולם. מה שלומכם היום.", { uiLang: "he" });
    expect(ok).toBe(true);
    expect(spoken).toHaveLength(2);
    const added = ledgerEntries().slice(before);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ host: "speech voice: Google עברית", category: "cloud-text", decision: "allowed" });
  });
});
