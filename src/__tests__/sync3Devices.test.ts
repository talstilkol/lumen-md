/**
 * Plan W13.S7 — the three-device sync drill, simulated: the same script the
 * owner runs on a Mac, an iPhone and an Android phone (scripts/drill/sync-3-devices.md),
 * on the real engine with three devices over one storage. 1,000 edits spread
 * over 20 notes, each edit a unique counter line; one device offline at a
 * time ("an hour" = 50 edits); the same note edited on two devices while one
 * is offline; a note deleted and restored; each device in its own
 * sync.conflictMode (W11.S6). At the end: no counter line lost anywhere, and
 * the same vault hash on all three.
 *
 * With DRILL_REPORT=<file> the counters and hashes are written there (the
 * format the real-device run fills in; `npm run drill:data-safety -- --report`).
 */
import { describe, expect, it, vi } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { memoryProvider } from "../sync/e2ee/provider";
import { fileModeResolver, keepBothResolver, mergeFirst, modeResolver } from "../sync/e2ee/conflict";
import { joinTrusted, mulberry32, newVault, type Device } from "./helpers/e2ee";

vi.mock("../lib/logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, swallowed: vi.fn() }));

const noKeep = async () => undefined;
const resolverFor = (mode: "merge" | "file") => modeResolver(() => mode, mergeFirst(keepBothResolver, noKeep), fileModeResolver(noKeep, noKeep));

async function vaultHash(d: Device): Promise<string> {
  const parts = [...d.files.files.keys()].sort().map((p) => `${p}\0${d.files.text(p)}`);
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts.join("\n"))));
  return [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("three-device sync drill (simulated)", () => {
  it("1,000 edits, an offline device every 50 edits, concurrent edits, a delete and restore: 0 lost, the same hash on 3 devices", async () => {
    const p = memoryProvider();
    const NAMES = ["mac", "iphone", "android"] as const;
    const MODES = { mac: "merge", iphone: "file", android: "merge" } as const;
    const mac = await newVault(p, resolverFor(MODES.mac));
    const iphone = await joinTrusted("iphone", p, resolverFor(MODES.iphone));
    const android = await joinTrusted("android", p, resolverFor(MODES.android));
    const devices: Record<(typeof NAMES)[number], Device> = { mac, iphone, android };
    const counters = { mac: { edits: 0, rounds: 0, offline: 0 }, iphone: { edits: 0, rounds: 0, offline: 0 }, android: { edits: 0, rounds: 0, offline: 0 } };
    const notes = Array.from({ length: 20 }, (_, i) => `drill/note-${String(i).padStart(2, "0")}.md`);
    for (const n of notes) mac.files.set(n, `# ${n}\n`);
    await mac.sync.sync();
    await iphone.sync.sync();
    await android.sync.sync();

    const rnd = mulberry32(13);
    const written: string[] = [];
    let offline: (typeof NAMES)[number] | null = null;
    let conflicts = 0;
    let deleted: { path: string; text: string } | null = null;
    let restored = false;
    const syncOne = async (n: (typeof NAMES)[number]) => {
      if (n === offline) return;
      const r = await devices[n].sync.sync();
      counters[n].rounds++;
      conflicts += r.conflicts.length;
    };

    for (let i = 0; i < 1000; i++) {
      // Every 50 edits ("an hour"), the next device goes offline for the next 50.
      if (i % 50 === 0) {
        offline = i % 100 === 0 ? NAMES[(i / 100) % 3] : null;
        if (offline) counters[offline].offline++;
      }
      const who = NAMES[Math.floor(rnd() * 3)];
      // Concurrency on purpose: a third of the edits go to note-00, which every device edits.
      const path = rnd() < 0.33 ? notes[0] : notes[1 + Math.floor(rnd() * 19)];
      const d = devices[who];
      const text = d.files.text(path);
      if (text === undefined) continue; // deleted on this device meanwhile
      const marker = `- ${who} edit ${i}`;
      const lines = text.split("\n");
      lines.splice(1 + Math.floor(rnd() * Math.max(1, lines.length - 1)), 0, marker);
      d.files.set(path, lines.join("\n"));
      written.push(marker);
      counters[who].edits++;
      if (rnd() < 0.5) await syncOne(who);
      // The delete and restore: note-05 deleted on the iPhone at edit 400, restored from the Mac's copy at edit 600.
      if (i >= 400 && !deleted && !restored && iphone.files.text(notes[5]) !== undefined && offline !== "iphone") {
        await syncOne("iphone");
        deleted = { path: notes[5], text: iphone.files.text(notes[5])! };
        iphone.files.delete(notes[5]);
        await syncOne("iphone");
      }
      if (i >= 600 && deleted && !restored && offline !== "mac") {
        await syncOne("mac");
        mac.files.set(deleted.path, deleted.text);
        await syncOne("mac");
        restored = true;
      }
    }
    offline = null;
    // Quiesce: everyone syncs until nothing changes.
    for (let k = 0; k < 4; k++) for (const n of NAMES) await syncOne(n);

    const hashes = await Promise.all(NAMES.map((n) => vaultHash(devices[n])));
    expect(new Set(hashes).size).toBe(1);
    // Every edit's line is still somewhere in the vault (the note, or a conflict file next to it).
    const all = [...mac.files.files.keys()].map((k) => mac.files.text(k) ?? "").join("\n");
    const lost = written.filter((m) => !all.includes(m));
    // The restore brought note-05 back with the text it had when deleted.
    expect(restored).toBe(true);
    for (const line of deleted!.text.split("\n")) expect(mac.files.text(notes[5])).toContain(line);
    expect(written.length).toBeGreaterThan(900);
    expect(lost).toEqual([]);
    expect(conflicts).toBeGreaterThan(0);

    const report = {
      drill: "sync-3-devices",
      simulated: true,
      note: "Simulated on one machine with the real engine; the owner's run on a Mac, an iPhone and an Android phone fills the same fields (scripts/drill/sync-3-devices.md).",
      devices: NAMES.map((n) => ({ name: n, conflictMode: MODES[n], ...counters[n] })),
      edits: written.length,
      lost: lost.length,
      conflicts,
      hashes: Object.fromEntries(NAMES.map((n, i) => [n, hashes[i]])),
      sameHash: new Set(hashes).size === 1,
    };
    const out = process.env.DRILL_REPORT;
    if (out) {
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
    }
  }, 300_000);
});
