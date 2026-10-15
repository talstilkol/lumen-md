/**
 * Trusted plugin-signing keys panel + key parsing (PRODUCT_IMPROVEMENT 1.3).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("idb-keyval", () => {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn(async (key: string) => store.get(key)),
    set: vi.fn(async (key: string, val: unknown) => {
      store.set(key, val);
    }),
    __store: store,
  };
});
vi.mock("../ui/AiToast", () => ({ showAiToast: vi.fn() }));
vi.mock("../ui/PromptDialog", () => ({ uiConfirm: vi.fn(async () => true) }));

import * as idb from "idb-keyval";
import {
  parseEd25519PublicKey,
  fingerprintOf,
  formatFingerprint,
  listTrustedKeys,
  trustPublicKey,
} from "../plugins/signing";
import { TrustedKeysSettings } from "../ui/TrustedKeysSettings";
import { uiConfirm } from "../ui/PromptDialog";

const store = (idb as unknown as { __store: Map<string, unknown> }).__store;

async function newEd25519Spki(): Promise<string> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  return btoa(String.fromCharCode(...spki));
}

function toPem(b64: string): string {
  return `-----BEGIN PUBLIC KEY-----\n${b64}\n-----END PUBLIC KEY-----\n`;
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("parseEd25519PublicKey", () => {
  it("accepts base64 SPKI and PEM, normalising to base64", async () => {
    const spki = await newEd25519Spki();
    expect(parseEd25519PublicKey(spki)).toEqual({ ok: true, spkiBase64: spki });
    expect(parseEd25519PublicKey(toPem(spki))).toEqual({ ok: true, spkiBase64: spki });
    const url = spki.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(parseEd25519PublicKey(url)).toEqual({ ok: true, spkiBase64: spki });
  });

  it("rejects empty, non-base64 and non-Ed25519 input", async () => {
    expect(parseEd25519PublicKey("   ")).toEqual({ ok: false, error: "empty" });
    expect(parseEd25519PublicKey("not a key!")).toEqual({ ok: false, error: "notBase64" });
    expect(parseEd25519PublicKey(btoa("too short"))).toEqual({ ok: false, error: "notEd25519" });
    // ECDSA P-256 SPKI is valid base64 but the wrong algorithm.
    const ec = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const ecSpki = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey("spki", ec.publicKey))));
    expect(parseEd25519PublicKey(ecSpki)).toEqual({ ok: false, error: "notEd25519" });
  });

  it("formats fingerprints in groups of four", () => {
    expect(formatFingerprint("abcd1234ef")).toBe("abcd 1234 ef");
  });
});

describe("trustPublicKey", () => {
  it("stores the key under its SHA-256 fingerprint and detects duplicates", async () => {
    const spki = await newEd25519Spki();
    const fp = await fingerprintOf(spki);
    expect(await trustPublicKey(toPem(spki))).toEqual({ ok: true, fingerprint: fp, alreadyTrusted: false });
    expect(await trustPublicKey(spki)).toEqual({ ok: true, fingerprint: fp, alreadyTrusted: true });
    expect(await listTrustedKeys()).toEqual([{ fingerprint: fp, source: "user" }]);
  });
});

describe("<TrustedKeysSettings />", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<TrustedKeysSettings open={false} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the empty state and a docs link", async () => {
    render(<TrustedKeysSettings open onClose={() => {}} />);
    expect(await screen.findByTestId("trusted-keys-empty")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Trusted signing keys" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Learn more" }).getAttribute("href")).toContain("/plugins/signing/");
  });

  it("validates pasted input before storing", async () => {
    render(<TrustedKeysSettings open onClose={() => {}} />);
    await screen.findByTestId("trusted-keys-empty");
    fireEvent.change(screen.getByLabelText("Add a public key"), { target: { value: btoa("nope") } });
    fireEvent.click(screen.getByRole("button", { name: "Trust key" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Not an Ed25519 public key/);
    expect(store.size).toBe(0);
  });

  it("adds a key, lists its fingerprint and removes it", async () => {
    const spki = await newEd25519Spki();
    const fp = await fingerprintOf(spki);
    render(<TrustedKeysSettings open onClose={() => {}} />);
    await screen.findByTestId("trusted-keys-empty");

    fireEvent.change(screen.getByLabelText("Add a public key"), { target: { value: toPem(spki) } });
    fireEvent.click(screen.getByRole("button", { name: "Trust key" }));
    expect(await screen.findByText(formatFingerprint(fp))).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: `Remove key ${fp.slice(0, 16)}` }));
    await waitFor(() => expect(screen.getByTestId("trusted-keys-empty")).toBeTruthy());
    expect(uiConfirm).toHaveBeenCalledTimes(1);
    expect(await listTrustedKeys()).toEqual([]);
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<TrustedKeysSettings open onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
