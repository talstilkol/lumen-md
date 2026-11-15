/**
 * Plan W11.S10: the passkey options appear only where the browser reports
 * WebAuthn PRF support. A simulated WebAuthn object stands in for the
 * browser's (see e2eePasskey.test.ts for the authenticator itself).
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { PasskeySetup, PasskeyUnlockButton } from "../sync/e2ee/ui/PasskeyUnlock";
import type { WebAuthnApi } from "../sync/e2ee/passkey";
import { memoryProvider } from "../sync/e2ee/provider";
import { newVault } from "./helpers/e2ee";

const api = (prf: boolean | "missing"): WebAuthnApi => ({
  ...(prf === "missing" ? {} : { getClientCapabilities: async () => ({ "extension:prf": prf }) }),
  create: vi.fn(async () => null),
  get: vi.fn(async () => null),
});

describe("passkey options", () => {
  it("are not shown when the browser doesn't report PRF, nor without WebAuthn", async () => {
    const p = memoryProvider();
    const a = await newVault(p);
    for (const x of [api(false), api("missing"), null]) {
      const { container, unmount } = render(
        <>
          <PasskeySetup engine={a.sync} api={x} />
          <PasskeyUnlockButton onUnlock={async () => undefined} api={x} />
        </>,
      );
      await new Promise((r) => setTimeout(r, 20));
      expect(container.textContent).toBe("");
      unmount();
    }
  });

  it("are shown when it does; the unlock button hands the browser's WebAuthn to the session", async () => {
    const p = memoryProvider();
    const a = await newVault(p);
    const yes = api(true);
    const onUnlock = vi.fn(async () => undefined);
    render(
      <>
        <PasskeySetup engine={a.sync} api={yes} />
        <PasskeyUnlockButton onUnlock={onUnlock} api={yes} />
      </>,
    );
    await waitFor(() => expect(screen.getByText("Add a passkey")).toBeTruthy());
    fireEvent.click(screen.getByText("Unlock with a passkey"));
    await waitFor(() => expect(onUnlock).toHaveBeenCalledWith(yes));
  });
});
