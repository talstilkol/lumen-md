/**
 * Plan 6.12: scripts/lora/export.mjs, the command-line twin of the app's
 * "Export training data and script", writes the same dataset the app's
 * code builds from the same notes, and refuses a vault too small to train on.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildLoraDataset, macScript } from "../ai/localLora";
import { proseOfNote } from "../ai/styleProfiles";

const ROOT = process.cwd();
const VAULT = resolve(ROOT, "src/__tests__/fixtures/obsidian-corpus/awesome-test-vault/Vault");
const run = (...a: string[]) => spawnSync(process.execPath, [resolve(ROOT, "scripts/lora/export.mjs"), ...a], { encoding: "utf8", cwd: ROOT });

describe("scripts/lora/export.mjs (6.12)", () => {
  it("writes train/valid/heldout and the Mac script, equal to what the app builds from the same notes", async () => {
    const out = mkdtempSync(join(tmpdir(), "lora-"));
    const r = run("--vault", VAULT, "--out", out);
    expect(r.status, r.stderr).toBe(0);
    const report = JSON.parse(r.stdout);
    expect(report.ok).toBe(true);
    expect(readdirSync(out).sort()).toEqual(["heldout.json", "train-mac.sh", "train.jsonl", "valid.jsonl"]);
    // @ts-expect-error — plain .mjs module without type declarations (#1304)
    const { readNotes } = (await import("../../scripts/lora/readNotes.mjs")) as { readNotes(root: string): Array<{ path: string; text: string }> };
    const ds = buildLoraDataset(readNotes(VAULT), { prose: proseOfNote, profile: null });
    expect(readFileSync(join(out, "train.jsonl"), "utf8")).toBe(ds.train);
    expect(readFileSync(join(out, "valid.jsonl"), "utf8")).toBe(ds.valid);
    expect(JSON.parse(readFileSync(join(out, "heldout.json"), "utf8"))).toEqual(ds.heldOut);
    expect(readFileSync(join(out, "train-mac.sh"), "utf8")).toBe(macScript());
    expect(report).toMatchObject({ trainSamples: ds.stats.trainSamples, heldOut: ds.stats.heldOut });
    // No note text in what it prints.
    expect(r.stdout).not.toContain(ds.heldOut[0].text.slice(0, 40));
  });

  it("refuses a vault with too little prose (exit 1) and bad arguments (exit 2)", () => {
    const empty = mkdtempSync(join(tmpdir(), "lora-empty-"));
    const r = run("--vault", empty, "--out", join(empty, "out"));
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).ok).toBe(false);
    expect(run("--vault", empty).status).toBe(2);
  });
});
