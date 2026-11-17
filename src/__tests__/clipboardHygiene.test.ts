/**
 * Plan W13.P5 — clipboard hygiene for secrets: a recovery / sync key or a
 * pairing code copied from Lumen is marked sensitive where the platform can,
 * and cleared after 60 seconds if it is still on the clipboard; Lumen never
 * reads the clipboard without the user's own paste command.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { copySecret, SECRET_CLEAR_MS, __resetSecretClipboard, type SecretClipboardDeps } from "../privacy/secretClipboard";

const ROOT = join(__dirname, "../..");

function fakes(o: { canRead?: boolean } = {}) {
  let board = "earlier";
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const listeners: Record<string, Array<() => void>> = {};
  const deps: SecretClipboardDeps = {
    native: null,
    clipboard: { writeText: vi.fn(async (t: string) => void (board = t)), readText: vi.fn(async () => board) },
    canRead: async () => o.canRead ?? true,
    setTimeout: (fn, ms) => timers.push({ fn, ms }),
    clearTimeout: () => undefined,
    doc: { addEventListener: (k: string, f: () => void) => void (listeners[k] ??= []).push(f), removeEventListener: () => undefined } as unknown as SecretClipboardDeps["doc"],
  };
  return { deps, timers, board: () => board, setBoard: (t: string) => void (board = t), fire: (k: string) => listeners[k]?.forEach((f) => f()) };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => __resetSecretClipboard());

describe("the clipboard is cleared after 60 seconds (acceptance)", () => {
  it("copies, then clears at 60 s when the secret is still there", async () => {
    const f = fakes();
    expect(await copySecret("alpha bravo charlie", f.deps)).toBe(true);
    expect(f.board()).toBe("alpha bravo charlie");
    expect(f.timers.map((t) => t.ms)).toEqual([SECRET_CLEAR_MS]);
    expect(SECRET_CLEAR_MS).toBe(60_000);
    f.timers[0].fn();
    await flush();
    expect(f.board()).toBe("");
  });

  it("leaves a newer copy alone: the user copied something else meanwhile", async () => {
    const f = fakes();
    await copySecret("secret", f.deps);
    f.setBoard("my own text");
    f.timers[0].fn();
    await flush();
    expect(f.board()).toBe("my own text");
  });

  it("without permission to read, clears only if nothing was copied in the app since", async () => {
    const a = fakes({ canRead: false });
    await copySecret("secret", a.deps);
    a.timers[0].fn();
    await flush();
    expect(a.board()).toBe("");
    __resetSecretClipboard();
    const b = fakes({ canRead: false });
    await copySecret("secret", b.deps);
    b.setBoard("copied in the app");
    b.fire("copy");
    b.timers[0].fn();
    await flush();
    expect(b.board()).toBe("copied in the app");
  });

  it("a refused clipboard says so and schedules nothing", async () => {
    const f = fakes();
    f.deps.clipboard = { writeText: async () => Promise.reject(new Error("denied")) };
    expect(await copySecret("x", f.deps)).toBe(false);
    expect(f.timers).toEqual([]);
  });
});

describe("marked sensitive on the phone (native)", () => {
  it("goes through LumenPrivacy.copySensitive with the expiry, and clearIfEquals compares natively", async () => {
    const f = fakes();
    const native = { copySensitive: vi.fn(async () => undefined), clearIfEquals: vi.fn(async () => ({ cleared: true })) };
    await copySecret("words", { ...f.deps, native });
    expect(native.copySensitive).toHaveBeenCalledWith({ text: "words", expiresInMs: 60_000 });
    expect(f.deps.clipboard!.writeText).not.toHaveBeenCalled();
    f.timers[0].fn();
    await flush();
    expect(native.clearIfEquals).toHaveBeenCalledWith({ text: "words" });
  });

  it("the Android plugin sets ClipDescription.EXTRA_IS_SENSITIVE and clears only an unchanged clip", () => {
    const java = readFileSync(join(ROOT, "android/app/src/main/java/com/lumen/editor/LumenPrivacyPlugin.java"), "utf8");
    expect(java).toContain("extras.putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true)");
    expect(java).toContain('extras.putBoolean("android.content.extra.IS_SENSITIVE", true)');
    expect(java).toMatch(/now\.toString\(\)\.equals\(text\)[\s\S]*clearPrimaryClip\(\)/);
  });
});

describe("where secrets are copied", () => {
  it("the sync words and the pairing code go through copySecret", () => {
    for (const f of ["src/sync/e2ee/ui/SetupWizard.tsx", "src/sync/e2ee/ui/LanPairing.tsx"]) {
      const src = readFileSync(join(ROOT, f), "utf8");
      expect(src, f).toContain("copySecret(");
    }
    expect(readFileSync(join(ROOT, "src/sync/e2ee/ui/SetupWizard.tsx"), "utf8")).not.toMatch(/clipboard\?\.writeText\(words/);
  });

  it("no silent paste: the only clipboard reads in the app are user commands", () => {
    const hits = execSync("git grep -nE 'clipboard\\??\\.read(Text)?\\(' -- 'src/*.ts' 'src/*.tsx'", { cwd: ROOT }).toString().trim().split("\n").filter((l) => !l.includes("__tests__"));
    const files = [...new Set(hits.map((l) => l.split(":")[0]))].sort();
    // researchActions: the "Clip from clipboard" command; secretClipboard: the 60-second check, only when reading is already allowed.
    expect(files).toEqual(["src/commands/domains/researchActions.ts", "src/privacy/secretClipboard.ts"]);
  });
});
