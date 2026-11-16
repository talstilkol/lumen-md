/**
 * Codex P2 on #235 (comment 4575737192), audit r3 W10.G10: the preview's
 * blob URL cache was keyed by path and version only, so after a vault switch
 * an image at the same path showed the OTHER vault's picture. The cache is
 * now scoped by the open vault and emptied (URLs revoked) on a switch.
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Each vault's files: the same asset name, different pictures. */
const vaults: Record<string, Record<string, string>> = { A: { "lumen-asset-1.png": "picture-of-vault-A" }, B: { "lumen-asset-1.png": "picture-of-vault-B" } };
let open = "A";
const reads: string[] = [];

vi.mock("../lib/idle", () => ({ scheduleIdle: (cb: () => void) => (cb(), () => {}) }));
vi.mock("../storage/workspace", async (importOriginal) => {
  const real = await importOriginal<typeof import("../storage/workspace")>();
  return {
    ...real,
    readWorkspaceBlob: async (p: string) => {
      reads.push(`${open}:${p}`);
      const body = vaults[open][p];
      if (body === undefined) throw new Error("ENOENT");
      return new Blob([body], { type: "image/png" });
    },
  };
});

import { Preview } from "../renderer/Preview";
import { enterIdentity, __resetIdentity } from "../storage/vault/identity";
import { setVaultBackend } from "../storage/vault";

const revoked: string[] = [];
beforeEach(() => {
  reads.length = 0;
  revoked.length = 0;
  open = "A";
  enterIdentity("vault-A");
  let n = 0;
  // A blob URL that says which picture it holds.
  vi.stubGlobal("URL", Object.assign(class extends URL {}, {
    createObjectURL: (b: Blob) => `blob:${(b as Blob & { __text?: string }).__text ?? `n${++n}`}`,
    revokeObjectURL: (u: string) => void revoked.push(u),
  }));
  const RealBlob = Blob;
  vi.stubGlobal("Blob", class extends RealBlob {
    __text: string;
    constructor(parts: BlobPart[], opts?: BlobPropertyBag) {
      super(parts, opts);
      this.__text = parts.map((p) => (typeof p === "string" ? p : (p as Blob & { __text?: string }).__text ?? "")).join("");
    }
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  __resetIdentity();
});

const imgSrc = (c: HTMLElement) => c.querySelector("img")?.getAttribute("src") ?? null;
const NOTE = "![pic](lumen-asset-1.png)";

describe("blob URL cache is scoped by vault (#235 P2)", () => {
  it("after a vault switch the same path shows the open vault's image, not the old one", async () => {
    const first = render(<Preview markdownText={NOTE} docKey="ws:a.md" />);
    await waitFor(() => expect(imgSrc(first.container)).toBe("blob:picture-of-vault-A"));
    first.unmount();

    // Same vault, same file: served from the cache (one read).
    const again = render(<Preview markdownText={NOTE} docKey="ws:a.md" />);
    await waitFor(() => expect(imgSrc(again.container)).toBe("blob:picture-of-vault-A"));
    again.unmount();
    expect(reads).toEqual(["A:lumen-asset-1.png"]);

    // Switch to vault B (identity and backend), open a note with the same asset name.
    open = "B";
    setVaultBackend(null);
    enterIdentity("vault-B");
    const other = render(<Preview markdownText={NOTE} docKey="ws:a.md" />);
    await waitFor(() => expect(imgSrc(other.container)).toBe("blob:picture-of-vault-B"));
    expect(imgSrc(other.container)).not.toBe("blob:picture-of-vault-A");
    expect(reads).toEqual(["A:lumen-asset-1.png", "B:lumen-asset-1.png"]);
    // The old vault's URL was revoked on the switch.
    expect(revoked).toContain("blob:picture-of-vault-A");
  });

  it("two vaults whose identity can't be read are still kept apart (backend generation)", async () => {
    enterIdentity(null);
    const first = render(<Preview markdownText={NOTE} docKey="ws:a.md" />);
    await waitFor(() => expect(imgSrc(first.container)).toBe("blob:picture-of-vault-A"));
    first.unmount();
    open = "B";
    setVaultBackend(null);
    const other = render(<Preview markdownText={NOTE} docKey="ws:a.md" />);
    await waitFor(() => expect(imgSrc(other.container)).toBe("blob:picture-of-vault-B"));
  });

  it("a read that finishes after a switch is neither kept nor shown for the new vault", async () => {
    const { blobUrlScope, cachedBlobUrl, storeBlobUrl } = await import("../renderer/blobUrlCache");
    const was = blobUrlScope();
    enterIdentity("vault-C");
    expect(storeBlobUrl("late.png", "1", "blob:late", was)).toBe(false);
    expect(cachedBlobUrl("late.png", "1")).toBeUndefined();
    expect(revoked).toContain("blob:late");
  });
});
