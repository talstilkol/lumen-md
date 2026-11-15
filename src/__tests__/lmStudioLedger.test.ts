/**
 * W11.I17 + W10.D17 on train 6: LM Studio's calls are in the privacy ledger.
 * The executor (#724) reaches LM Studio at a configured address, and the
 * ledger gate (#733) wants every network call named. The ledger classifies
 * that address like Ollama's: local-ai on this machine or the LAN, cloud-ai
 * on a remote server — so a local-only policy blocks a remote LM Studio.
 */
import { afterEach, describe, expect, it } from "vitest";
import { blockedByPolicy, classify } from "../ai/privacyLedger";
import { LMSTUDIO_URL_KEY, lmStudioUrl } from "../ai/lmStudioEndpoint";
import { lmStudioUrl as executorUrl } from "../agents/executors/lmstudio";

afterEach(() => localStorage.removeItem(LMSTUDIO_URL_KEY));

describe("LM Studio in the privacy ledger", () => {
  it("the default address (localhost:1234) is local AI", () => {
    expect(classify("http://localhost:1234/v1/chat/completions")).toMatchObject({ category: "local-ai", reason: "LM Studio (this machine / LAN)" });
  });

  it("a configured remote address is cloud AI, which local-only blocks", () => {
    localStorage.setItem(LMSTUDIO_URL_KEY, "https://lm.example.org:8443/");
    const c = classify("https://lm.example.org:8443/api/v1/chat");
    expect(c).toMatchObject({ host: "lm.example.org", category: "cloud-ai", reason: "LM Studio on a remote server" });
    expect(blockedByPolicy(c!.category, "local-only")).toBe(true);
  });

  it("the executor and the ledger read one setting", () => {
    localStorage.setItem(LMSTUDIO_URL_KEY, "http://192.168.1.5:1234//");
    expect(lmStudioUrl()).toBe("http://192.168.1.5:1234");
    expect(executorUrl()).toBe(lmStudioUrl());
  });
});
