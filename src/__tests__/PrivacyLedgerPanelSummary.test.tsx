/** The ledger header counts tldraw's fonts and icons as static files, never as model downloads (review: #198). */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { PrivacyLedgerPanel } from "../ui/PrivacyLedgerPanel";
import { __resetLedger, withLedger } from "../ai/privacyLedger";
import { setAiPolicy } from "../ai/policy";

describe("privacy ledger header", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetLedger();
    setAiPolicy("local-only");
  });

  it("shows canvas assets as static files and keeps the model-download count at 0", async () => {
    const f = withLedger((async () => new Response("x", { status: 200 })) as unknown as typeof fetch);
    await f("https://cdn.tldraw.com/4.5.10/fonts/IBMPlexSans-Medium.woff2");
    await f("https://cdn.tldraw.com/4.5.10/translations/he.json");
    render(<PrivacyLedgerPanel open onClose={() => {}} />);
    const header = screen.getByTestId("privacy-summary").textContent ?? "";
    expect(header).toContain("Model downloads: 0");
    expect(header).toContain("Static files: 2");
  });

  it("leaves the static-file count out when there are none", async () => {
    const f = withLedger((async () => new Response("x", { status: 200 })) as unknown as typeof fetch);
    await f("https://huggingface.co/x/resolve/main/model.onnx");
    render(<PrivacyLedgerPanel open onClose={() => {}} />);
    const header = screen.getByTestId("privacy-summary").textContent ?? "";
    expect(header).toContain("Model downloads: 1");
    expect(header).not.toContain("Static files");
  });
});
