/**
 * Plan W4.33 / W10.E40 — the data-safety drill runs the shipped save code,
 * not copies of it: the OPFS path is the app's OPFS backend with
 * opfsSyncWrite.ts's own worker source (only OPFS and Worker stood in for,
 * at the API level), the desktop path is the Rust vault's Vault::write.
 * The drill itself (kills, a full disk, permissions, an external editor,
 * the combined scenario) is `node scripts/data-safety-drill.mjs`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
// @ts-expect-error — plain .mjs module without type declarations
import { installOpfs } from "../../scripts/drill/opfs.mjs";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const dirs: string[] = [];
const folder = () => {
  const d = mkdtempSync(join(tmpdir(), "drill-test-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("no reimplementation in the drill", () => {
  it("the drill and its drivers port nothing: the paths load src/ and src-tauri/ code", () => {
    const drill = read("scripts/data-safety-drill.mjs");
    const drivers = ["opfs.mjs", "tauri.mjs", "combined.mjs"].map((f) => read(`scripts/drill/${f}`)).join("\n");
    expect(drill + drivers).not.toMatch(/\bported\b|line for line/);
    expect(drill).toMatch(/bundle\("src\/storage\/vault\/opfs\.ts"/);
    expect(drill).toMatch(/bundle\("src\/sync\/gitPull\.ts"/);
    expect(read("scripts/drill/tauri-writer/Cargo.toml")).toMatch(/lumen-vault = \{ path = "\.\.\/\.\.\/\.\.\/src-tauri\/vault" \}/);
    expect(read("scripts/drill/tauri-writer/src/main.rs")).toMatch(/vault\.write\(path, &data\)/);
    // The report the task asks for.
    expect(drill).toMatch(/`drill-\$\{commit\.slice\(0, 12\)\}`/);
  });
});

describe("the OPFS path is the app's backend and worker over a real folder", () => {
  it("a save lands whole through opfsSyncWrite's worker source, with no leftover", async () => {
    const root = folder();
    installOpfs(root);
    const { createOpfsBackend } = await import("../storage/vault/opfs");
    const backend = createOpfsBackend();
    await backend.write("notes/a.md", new TextEncoder().encode("שלום עולם"));
    expect(readFileSync(join(root, "notes/a.md"), "utf8")).toBe("שלום עולם");
    await backend.write("notes/a.md", new TextEncoder().encode("second"));
    expect(readFileSync(join(root, "notes/a.md"), "utf8")).toBe("second");
    expect(readdirSync(join(root, "notes"))).toEqual(["a.md"]);
  });

  it("a save cut off after the new version was written is put right by the app's own recovery on listing", async () => {
    const root = folder();
    installOpfs(root);
    const { createOpfsBackend } = await import("../storage/vault/opfs");
    const { tempNameFor, oldNameFor, saveId } = await import("../storage/vault/atomic");
    const backend = createOpfsBackend();
    await backend.write("b.md", new TextEncoder().encode("old"));
    // The worker's steps up to a crash: the new version complete, the note moved aside, not yet renamed back.
    const id = saveId();
    writeFileSync(join(root, tempNameFor("b.md", id)), "new");
    writeFileSync(join(root, oldNameFor("b.md", id)), "old");
    rmSync(join(root, "b.md"));
    const names = (await createOpfsBackend().list("")).map((e) => e.name);
    expect(names).toEqual(["b.md"]);
    expect(["old", "new"]).toContain(readFileSync(join(root, "b.md"), "utf8"));
    expect(readdirSync(root).filter((n) => n !== "b.md")).toEqual([]);
    expect(existsSync(join(root, "b.md"))).toBe(true);
  });
});
