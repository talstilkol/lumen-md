// @vitest-environment node
/**
 * W3.10 acceptance, timed (audit r2: "'< 5 min to a running plugin' and
 * '< 1 s reload' not timed"). The README's walk-through, as a new developer
 * runs it, in separate processes and a fresh folder:
 *
 *   1. `create-lumen-plugin my-first-plugin`  (what `npx create-lumen-plugin` runs; nothing to install)
 *   2. `npm test` in it                        (`node --test`: the template's own tests, the test kit)
 *   3. `npm run dev`                           (the dev server, as its own process)
 *   4. the app connects (Developer mode → Connect) and gets the plugin's files
 *   5. a save to main.js → the change event the app reloads on
 *
 * The machine time is measured; the human part (reading the README, typing)
 * is not, and is the rest of the five minutes. Step 5 is the "< 1 s reload".
 */
import { describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { get } from "node:http";

const ROOT = resolve(__dirname, "..", "..");
const BIN = join(ROOT, "packages/create-lumen-plugin/bin.js");

describe("create-lumen-plugin → a running plugin, timed (W3.10)", () => {
  it("scaffold, test, serve, connect and hot-reload: machine time far under 5 minutes; a save reaches the app in under 1 s", async () => {
    const work = mkdtempSync(join(tmpdir(), "lumen-dx-"));
    const times: Record<string, number> = {};
    const t = (k: string, t0: number) => (times[k] = Math.round(performance.now() - t0));
    let dev: ReturnType<typeof spawn> | null = null;
    try {
      let t0 = performance.now();
      const made = spawnSync(process.execPath, [BIN, "my-first-plugin"], { cwd: work, encoding: "utf8" });
      t("scaffold", t0);
      expect(made.status, made.stderr).toBe(0);
      const dir = join(work, "my-first-plugin");
      expect(JSON.parse(readFileSync(join(dir, "lumen-plugin.json"), "utf8")).id).toMatch(/my-first-plugin/);

      t0 = performance.now();
      const test = spawnSync(process.execPath, ["--test"], { cwd: dir, encoding: "utf8" });
      t("npm test", t0);
      expect(test.status, test.stdout + test.stderr).toBe(0);
      expect(test.stdout).toMatch(/# pass [1-9]/);
      expect(test.stdout).toMatch(/# fail 0/);

      t0 = performance.now();
      dev = spawn(process.execPath, ["tools/dev-server.mjs"], { cwd: dir, env: { ...process.env, PORT: String(40_000 + Math.floor(Math.random() * 20_000)) }, stdio: ["ignore", "pipe", "pipe"] });
      const url = await new Promise<string>((ok, fail) => {
        const timer = setTimeout(() => fail(new Error("dev server did not start")), 10_000);
        dev!.stdout!.on("data", (b: Buffer) => {
          const m = /(http:\/\/127\.0\.0\.1:\d+)/.exec(String(b));
          if (m) {
            clearTimeout(timer);
            ok(m[1]);
          }
        });
      });
      t("npm run dev", t0);

      // The app connects: the manifest and main.js, then the event stream.
      t0 = performance.now();
      const fetchText = async (u: string) => (await fetch(u)).text();
      const manifest = JSON.parse(await fetchText(`${url}/lumen-plugin.json`));
      expect(await fetchText(`${url}/${manifest.main ?? "main.js"}`)).toContain("lumen");
      const events: string[] = [];
      const stream = await new Promise<import("node:http").IncomingMessage>((ok) => get(`${url}/events`, ok));
      stream.setEncoding("utf8");
      stream.on("data", (d: string) => events.push(d));
      await new Promise((r) => setTimeout(r, 100));
      t("connect", t0);

      // Save main.js: the change event the app reloads on.
      const main = join(dir, manifest.main ?? "main.js");
      const saved = performance.now();
      writeFileSync(main, readFileSync(main, "utf8") + "\n// edited\n");
      await new Promise<void>((ok, fail) => {
        const timer = setTimeout(() => fail(new Error(`no change event; got ${JSON.stringify(events)}`)), 5_000);
        const poll = setInterval(() => {
          if (events.some((e) => e.includes("event: change") && e.includes("main.js"))) {
            clearInterval(poll);
            clearTimeout(timer);
            ok();
          }
        }, 5);
      });
      t("save → change event", saved);
      stream.destroy();

      const machine = times.scaffold + times["npm test"] + times["npm run dev"] + times.connect;
      console.log(`[W3.10] ${JSON.stringify(times)}; machine time to a connected plugin ${machine} ms`);
      expect(times["save → change event"]).toBeLessThan(1000);
      expect(machine).toBeLessThan(60_000);
    } finally {
      dev?.kill("SIGTERM");
      rmSync(work, { recursive: true, force: true });
    }
  }, 120_000);
});
