/**
 * Plan W11.P14: the education kit. The teacher's page goes clause by clause
 * through the Ministry of Education circular of 5 January 2022 (12 clauses),
 * says plainly that Lumen is not on the approved list, and cites files that
 * exist. The offline pack takes only allowed models and builds from local
 * files. The installer and model files in the pack test are SYNTHETIC
 * stand-ins (bytes made up here); the real drive is W11.M13.
 * @vitest-environment node
 */
import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
// @ts-expect-error — plain .mjs helpers without types
import { citedPaths, markdownToHtml, packProblems } from "../../scripts/lib/eduKit.mjs";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const teacher = read("edu/teacher.he.md");
const pack = JSON.parse(read("edu/offline-pack.json"));
const registry = JSON.parse(read("models/registry.json"));

describe("the teacher's page (the circular of 5.1.2022)", () => {
  it("one row for each of the circular's 12 clauses, in order, each with what Lumen does", () => {
    const rows = [...teacher.matchAll(/^\| (\d+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gm)];
    expect(rows.map((r) => Number(r[1]))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    for (const r of rows) expect(r[3].trim().length, `clause ${r[1]}`).toBeGreaterThan(20);
    expect(teacher).toMatch(/circular: "שימוש בכלים דיגיטליים במוסדות חינוך, .*5 בינואר 2022"/);
  });

  it("says what is true even when it hurts: not on the approved list, the hosted service's age 13, the summaries are not quotes", () => {
    expect(teacher).toContain("‏Lumen **אינו** ברשימת הכלים שמשרד החינוך אישר");
    expect(teacher).toContain("**לשירות המתארח (‏lumen-md.vercel.app) יש גיל מינימום: 13**");
    expect(read("TERMS.md")).toContain("You must be at least 13 years old");
    expect(teacher).toContain("**במילים שלנו, לא ציטוט**");
    // "Approved by the Ministry" appears only negated.
    const approvals = [...teacher.matchAll(/(\S+)\s+(?:מאושר|אושר)\s+על ידי/g)].map((m) => m[1]);
    expect(approvals.length).toBeGreaterThanOrEqual(1);
    expect(approvals.every((w) => w === "לא")).toBe(true);
    expect(teacher).not.toMatch(/\blumen\.md\b/);
  });

  it("every file it cites exists", () => {
    const cited = [...citedPaths(teacher), ...citedPaths(read("edu/netfree-request.he.md"))];
    expect(cited.length).toBeGreaterThanOrEqual(10);
    for (const p of cited) expect(existsSync(join(ROOT, p)), p).toBe(true);
  });

  it("becomes an RTL A4 page with the table and the warning (what scripts/edu-pdf.mjs prints)", () => {
    const html = markdownToHtml(teacher, { lang: "he", title: "Lumen בכיתה" });
    expect(html).toMatch(/^<!doctype html><html lang="he" dir="rtl">/);
    expect(html).toContain("@page { size: A4;");
    expect((html.match(/<tr>/g) ?? []).length).toBe(13);
    expect(html).toContain("<blockquote><strong>חשוב:</strong>");
    expect(html).not.toMatch(/<script|https?:\/\/fonts\./);
  });
});

describe("the offline pack", () => {
  it("names only allowed models from the registry, and the installer is required", () => {
    expect(packProblems(pack, registry)).toEqual([]);
    const forbidden = structuredClone(pack);
    forbidden.components.push({ id: "tts-he", what: { he: "הקראה", en: "TTS" }, required: false, from: "models", dir: "mms", registry: ["mms-tts-heb"] });
    expect(packProblems(forbidden, registry)).toEqual(["tts-he: mms-tts-heb is forbidden in models/registry.json; only allowed models go on the drive"]);
    expect(packProblems({ ...pack, components: pack.components.filter((c: { id: string }) => c.id !== "installer") }, registry)).toContain("offline-pack.json: the installer must be required");
  });

  const tmp = mkdtempSync(join(tmpdir(), "lumen-edu-"));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));
  const run = (...a: string[]) => spawnSync(process.execPath, [join(ROOT, "scripts/edu-offline-pack.mjs"), ...a], { encoding: "utf8" });

  it("builds a drive from local files: the installer, the Hebrew OCR data, the optional models, SHA256SUMS and the Hebrew read-me", () => {
    const msix = join(tmp, "Lumen_0.1.0_x64.msix");
    writeFileSync(msix, "synthetic installer bytes");
    const models = join(tmp, "models");
    mkdirSync(join(models, "Xenova/multilingual-e5-small/onnx"), { recursive: true });
    writeFileSync(join(models, "Xenova/multilingual-e5-small/onnx/model_quantized.onnx"), "synthetic model");
    const out = join(tmp, "drive");
    const r = run("--installer", msix, "--out", out, "--models", models);
    expect([r.status, r.stderr]).toEqual([0, ""]);
    const sums = readFileSync(join(out, "SHA256SUMS"), "utf8").trim().split("\n");
    expect(sums.map((l) => l.split("  ")[1])).toEqual([
      "Lumen/Lumen_0.1.0_x64.msix",
      "models/ocr-he/LICENSE",
      "models/ocr-he/eng.traineddata.gz",
      "models/ocr-he/heb.traineddata.gz",
      "models/semantic-search/onnx/model_quantized.onnx",
    ]);
    for (const l of sums) {
      const [hash, f] = l.split("  ");
      expect(createHash("sha256").update(readFileSync(join(out, f))).digest("hex"), f).toBe(hash);
    }
    const readme = readFileSync(join(out, "קרא-אותי.txt"), "utf8");
    expect(readme).toContain("החיפוש בעברית וזיהוי הטקסט (OCR) עובדים בלי רשת");
    expect(readme).toContain("הכתבה בעברית (אופציונלי) — לא נכלל");
    expect(readme).toContain("חבילת השפה העברית");
  });

  it("refuses without an installer, and an installer of another kind", () => {
    const out = join(tmp, "drive2");
    expect(run("--out", out).stderr).toContain("installer: --installer is missing or not found");
    const zip = join(tmp, "Lumen.zip");
    writeFileSync(zip, "x");
    const r = run("--installer", zip, "--out", out);
    expect([r.status, r.stderr]).toEqual([1, "✗ installer: Lumen.zip is not an .msix, .msi or -setup.exe\n"]);
    expect(existsSync(join(out, "SHA256SUMS"))).toBe(false);
    expect(readdirSync(tmp)).toContain("drive2");
  });
});
