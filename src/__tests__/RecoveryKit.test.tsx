/**
 * Plan W11.S9: the recovery kit's screens against a real E2eeSync on the
 * simulated provider. The key is committed only after three words are typed
 * back; the PDF is a download, never written to the vault or sent; the
 * restore screen turns the 24 words into the key.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RecoveryKitSetup, RecoveryRestore } from "../sync/e2ee/ui/RecoveryKit";
import { memoryProvider, type SyncProvider } from "../sync/e2ee/provider";
import { unlockWithRecoveryKey } from "../sync/e2ee/engine";
import { parseRecoveryWords } from "../sync/e2ee/bip39";
import { newVault } from "./helpers/e2ee";

/** The provider, with every write recorded. */
function recorded() {
  const inner = memoryProvider();
  const puts: string[] = [];
  const p: SyncProvider & { objects: typeof inner.objects } = Object.assign(Object.create(inner), { put: (n: string, d: Uint8Array, c?: never) => (puts.push(n), inner.put(n, d, c)), objects: inner.objects });
  return { p, puts };
}

const wordsOnScreen = () => [...screen.getByTestId("recovery-words").querySelectorAll("li")].map((li) => li.textContent ?? "");

describe("setting up the recovery kit", () => {
  it("shows 24 words, downloads the PDF without writing anything, and commits only after three right words", async () => {
    const { p, puts } = recorded();
    const a = await newVault(p);
    await a.sync.sync();
    const created: Blob[] = [];
    const urls = { create: vi.spyOn(URL, "createObjectURL").mockImplementation((b: Blob | MediaSource) => (created.push(b as Blob), "blob:kit")), revoke: vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined) };
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<RecoveryKitSetup engine={a.sync} positions={() => [2, 11, 20]} />);
    fireEvent.click(screen.getByText("Set up a recovery key"));
    await waitFor(() => expect(wordsOnScreen()).toHaveLength(24));
    const words = wordsOnScreen();

    const before = puts.length;
    fireEvent.click(screen.getByText("Download the printable kit (PDF)"));
    expect(created).toHaveLength(1);
    expect(created[0].type).toBe("application/pdf");
    expect(new TextDecoder().decode(new Uint8Array(await created[0].arrayBuffer()).subarray(0, 8))).toBe("%PDF-1.4");
    // Nothing was written to the vault's storage and nothing was fetched.
    expect(puts.length).toBe(before);
    expect(fetchSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(urls.revoke).toHaveBeenCalledWith("blob:kit"));

    fireEvent.click(screen.getByText("I wrote them down"));
    const inputs = () => [2, 11, 20].map((n) => screen.getByLabelText(`Word ${n}`) as HTMLInputElement);
    fireEvent.change(inputs()[0], { target: { value: words[1] } });
    fireEvent.change(inputs()[1], { target: { value: words[10] === "zoo" ? "abandon" : "zoo" } });
    fireEvent.change(inputs()[2], { target: { value: words[19].slice(0, 4).toUpperCase() } });
    fireEvent.click(screen.getByText("Turn on the recovery key"));
    expect((await screen.findByRole("alert")).textContent).toContain("11");
    // Not committed: no key change, no recovery in the keyring.
    expect(a.sync.keys().epoch).toBe(0);

    fireEvent.change(inputs()[1], { target: { value: words[10] } });
    fireEvent.click(screen.getByText("Turn on the recovery key"));
    await screen.findByTestId("recovery-done");
    expect(a.sync.keys().epoch).toBe(1);
    expect(a.sync.keys().ring?.recovery).toMatch(/^age1/);

    // The words on screen are the key: they open the vault alone.
    const parsed = await parseRecoveryWords(words.join(" "));
    if (!parsed.ok) throw new Error("the words on screen don't parse");
    expect((await unlockWithRecoveryKey(p, parsed.key)).keys.epoch).toBe(1);
    // The device's own state never holds the words.
    expect(JSON.stringify(a.store.state)).not.toContain(words.slice(0, 4).join(" "));
    urls.create.mockRestore();
    urls.revoke.mockRestore();
    fetchSpy.mockRestore();
  });

  it("a vault that has one offers a new one (which replaces it)", async () => {
    const p = memoryProvider();
    const a = await newVault(p);
    const { setUpRecovery } = await import("../sync/e2ee/engine");
    await setUpRecovery(a.sync);
    render(<RecoveryKitSetup engine={a.sync} />);
    expect(screen.getByText("Make a new recovery key")).toBeTruthy();
  });
});

describe("restoring with the words", () => {
  it("turns the 24 words into the key and asks for a new passphrase", async () => {
    const onRestore = vi.fn(async (_key: Uint8Array, _pass: string) => undefined);
    render(<RecoveryRestore onRestore={onRestore} />);
    const words = "legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title";
    fireEvent.change(screen.getByLabelText("The 24 recovery words"), { target: { value: words.split(" ").slice(0, 20).join(" ") } });
    fireEvent.change(screen.getByLabelText("New passphrase"), { target: { value: "a long new passphrase" } });
    fireEvent.change(screen.getByLabelText("Repeat the passphrase"), { target: { value: "a long new passphrase" } });
    fireEvent.click(screen.getByText("Restore"));
    expect((await screen.findByRole("alert")).textContent).toBe("24 words are needed; there are 20.");
    fireEvent.change(screen.getByLabelText("The 24 recovery words"), { target: { value: words } });
    let key = "";
    onRestore.mockImplementation(async (k: Uint8Array) => void (key = Buffer.from(k).toString("hex")));
    fireEvent.click(screen.getByText("Restore"));
    await waitFor(() => expect(onRestore).toHaveBeenCalledTimes(1));
    expect(key).toBe("7f".repeat(32));
    expect(onRestore.mock.calls[0][1]).toBe("a long new passphrase");
  });
});
