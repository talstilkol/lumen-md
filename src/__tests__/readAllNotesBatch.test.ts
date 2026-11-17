/**
 * The #856 follow-up: readAllNotes asks for up to READ_AT_ONCE notes at a
 * time, so the OPFS backend can send them to its worker as one batch instead
 * of one message (and one main-thread read) per note. Over the real memory
 * backend: every note comes back, in the listing's order, an unreadable one
 * is skipped, and the reads overlap (one by one before the change).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryBackend, setVaultBackend, type VaultBackend } from "../storage/vault";
import { listWorkspace } from "../storage/workspace";
import { readAllNotes, READ_AT_ONCE } from "../storage/workspaceNotes";

let previous: VaultBackend | null;
let mem: VaultBackend;
let inFlight = 0;
let maxInFlight = 0;

beforeEach(() => {
  mem = createMemoryBackend();
  const read = mem.read.bind(mem);
  // The real memory backend, with its reads counted while they run.
  mem.read = async (path: string) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await new Promise((r) => setTimeout(r, 0));
      if (path === "f3/broken.md") throw new Error("unreadable");
      return await read(path);
    } finally {
      inFlight--;
    }
  };
  previous = setVaultBackend(mem);
  inFlight = 0;
  maxInFlight = 0;
});
afterEach(() => {
  setVaultBackend(previous);
});

describe("readAllNotes reads in batches (#856 follow-up)", () => {
  it("returns every readable note in the listing's order, with up to READ_AT_ONCE reads in flight", async () => {
    const N = 600;
    for (let i = 0; i < N; i++) await mem.write(`f${i % 10}/note-${i}.md`, `שלום ${i}`);
    await mem.write("f3/broken.md", "x");
    await mem.write("f1/image.png", "not a note");
    const order = (await listWorkspace({ includeAssets: false })).map((f) => f.path).filter((p) => p.endsWith(".md") && p !== "f3/broken.md");

    const notes = await readAllNotes();
    expect(notes.map((n) => n.path)).toEqual(order);
    expect(notes).toHaveLength(N);
    for (const n of notes) expect(n.text).toBe(`שלום ${n.path.match(/note-(\d+)/)![1]}`);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(READ_AT_ONCE);
    expect(READ_AT_ONCE).toBe(256);
  });
});
