/**
 * The Mac pack's model wrappers (tools/models): each Python wrapper's
 * contract with stand-ins for its model (`--selftest`), and the Nakdimon
 * wrapper's bridge from onnxruntime-node to the app's addNikud engine.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
// @ts-expect-error — a plain .mjs tool
import { nakdimonRun } from "../../tools/models/nakdimon_dot.mjs";

const root = join(__dirname, "..", "..");

describe("python wrappers", () => {
  for (const f of ["sherpa_asr.py", "chatterbox_say.py", "phonikud_g2p.py"]) {
    it(`${f} keeps the cmd-engine contract (selftest)`, () => {
      const r = spawnSync("python3", [join(root, "tools/models", f), "--selftest"], { encoding: "utf8" });
      expect(r.stderr).toBe("");
      expect(r.stdout.trim()).toBe("selftest ok");
      expect(r.status).toBe(0);
    });
  }
  it("a wrapper without its model path stops with usage, not a traceback", () => {
    const r = spawnSync("python3", [join(root, "tools/models/sherpa_asr.py"), "x.wav"], { encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/--dir/);
  });
});

describe("nakdimon wrapper", () => {
  it("feeds int32 ids [rows, length] to the session's first input and returns N, D, S", async () => {
    const seen: unknown[] = [];
    class Tensor {
      constructor(
        readonly type: string,
        readonly data: Int32Array,
        readonly dims: number[],
      ) {}
    }
    const session = { inputNames: ["input_1"], run: async (feeds: Record<string, Tensor>) => (seen.push(feeds), { N: { data: [1] }, D: { data: [2] }, S: { data: [3] } }) };
    const run = nakdimonRun(session, Tensor);
    expect(await run(new Int32Array([5, 6]), 1, 2)).toEqual({ N: [1], D: [2], S: [3] });
    const feed = (seen[0] as Record<string, Tensor>).input_1!;
    expect(feed).toMatchObject({ type: "int32", dims: [1, 2] });
  });
});
