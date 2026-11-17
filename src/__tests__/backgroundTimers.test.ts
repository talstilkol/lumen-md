/**
 * Plan W13.V4 — battery: no wake lock, and no timer that runs while the app
 * is in the background unless it has a reason to (src/lib/backgroundTimers.json);
 * the rest use setVisibleInterval, which sleeps while the page is hidden and
 * catches up once on return. The energy report itself is measured on real
 * phones (docs/perf/mobile-energy.md, `npm run mobile:check`).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { setVisibleInterval } from "../lib/visibleInterval";
import allow from "../lib/backgroundTimers.json";

const ROOT = resolve(__dirname, "..", "..");

function sources(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) {
      if (n !== "__tests__") sources(p, out);
    } else if (/\.tsx?$/.test(n) && !/\.(test|spec)\.tsx?$|\.d\.ts$/.test(n)) out.push(p);
  }
  return out;
}
/** Code without comments and string contents (a timer named in a comment is not a timer). */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "").replace(/(["'`])(?:\\.|(?!\1)[^\\\n])*\1/g, '""');

describe("background timers in the app", () => {
  const files = sources(join(ROOT, "src")).map((f) => ({ rel: relative(ROOT, f).split("\\").join("/"), text: code(readFileSync(f, "utf8")) }));

  it("every plain setInterval is listed with its reason; nothing listed is gone", () => {
    const using = files.filter((f) => /\bsetInterval\s*\(/.test(f.text) && f.rel !== "src/lib/visibleInterval.ts").map((f) => f.rel).sort();
    const allowed = Object.keys(allow.allowed).sort();
    expect(using.filter((f) => !allowed.includes(f)), "new background timers: use setVisibleInterval or list them with a reason").toEqual([]);
    expect(allowed.filter((f) => !using.includes(f)), "listed but no longer there").toEqual([]);
    for (const [f, why] of Object.entries(allow.allowed)) expect((why as string).length, f).toBeGreaterThan(20);
  });

  it("the polls that only matter on screen sleep in the background", () => {
    for (const f of ["src/storage/vault/watcher.ts", "src/agents/mcpInbox.ts", "src/ui/RelatedPanel.tsx", "src/plugins/useFetchSource.ts"]) {
      const t = files.find((x) => x.rel === f)!.text;
      expect(t, f).toMatch(/setVisibleInterval\(/);
      expect(t, f).not.toMatch(/\bsetInterval\s*\(/);
    }
  });

  it("no wake lock anywhere", () => {
    expect(files.filter((f) => /\bwakeLock\b/.test(f.text)).map((f) => f.rel)).toEqual([]);
  });
});

describe("setVisibleInterval", () => {
  afterEach(() => vi.useRealTimers());

  it("skips ticks while hidden and runs once on return", () => {
    vi.useFakeTimers();
    let hidden = false;
    const listeners: Array<() => void> = [];
    const doc = { get hidden() { return hidden; }, addEventListener: (_: string, f: () => void) => listeners.push(f), removeEventListener: () => undefined } as unknown as Document;
    const fn = vi.fn();
    const stop = setVisibleInterval(fn, 1000, doc);
    vi.advanceTimersByTime(3000);
    expect(fn).toHaveBeenCalledTimes(3);
    hidden = true;
    vi.advanceTimersByTime(60_000);
    expect(fn).toHaveBeenCalledTimes(3);
    hidden = false;
    for (const l of listeners) l();
    expect(fn).toHaveBeenCalledTimes(4);
    for (const l of listeners) l();
    expect(fn).toHaveBeenCalledTimes(4);
    stop();
    vi.advanceTimersByTime(5000);
    expect(fn).toHaveBeenCalledTimes(4);
  });
});
