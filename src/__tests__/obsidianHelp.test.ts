/**
 * Plan W11.P3 (R1.8): Obsidian's own help vault as the compatibility corpus.
 * These are real files written in Obsidian by Obsidian's team, in English and
 * Hebrew, with the release notes and the Sandbox vault: 762 Markdown files at
 * the pinned commit.
 *
 * The repository states no licence, so its files are not copied here. The
 * manifest pins the commit and every file's sha256, and the tests read a local
 * download in .cache/obsidian-help (`node scripts/obsidian-help-corpus.mjs
 * --fetch`). Without the download only the manifest is checked, and the
 * corpus tests are skipped, saying so in their names.
 *
 * At this commit the vault has no .base or .canvas file. Its Bases are
 * documented in Markdown, with one ```base block. The .base and .canvas
 * round trips run on the vendored real vaults (obsidianCorpus.test.ts,
 * W4.30). Comparing with Obsidian 1.15.1's own file sets is W11.M12, on the
 * Mac.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { unified } from "unified";
import remarkParse from "remark-parse";
import type { Root } from "mdast";
import { decodeUtf8, joinTextEnvelope, readText, splitTextEnvelope } from "../storage/textCodec";
import { readProperties, setProperty, type PropertyValue } from "../properties/frontmatter";
import { parseBase } from "../views/bases/base";
import { rewriteLinks } from "../storage/linkRewrite";
import { remarkObsidian } from "../renderer/remarkObsidian";

interface Manifest {
  repo: string;
  commit: string;
  licence: string;
  redistributed: boolean;
  files: Array<{ path: string; sha256: string; bytes: number }>;
}

const ROOT = process.cwd();
const manifest = JSON.parse(readFileSync(join(ROOT, "src/__tests__/fixtures/obsidian-help.manifest.json"), "utf8")) as Manifest;
const CACHE = join(ROOT, ".cache", "obsidian-help");
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** The download, only when every file is there with its pinned hash. */
function loadCorpus(): { path: string; bytes: Uint8Array }[] | null {
  if (!existsSync(join(CACHE, ".commit")) || readFileSync(join(CACHE, ".commit"), "utf8").trim() !== manifest.commit) return null;
  const out: { path: string; bytes: Uint8Array }[] = [];
  for (const f of manifest.files) {
    const p = join(CACHE, f.path);
    if (!existsSync(p)) return null;
    const bytes = new Uint8Array(readFileSync(p));
    if (sha(bytes) !== f.sha256) return null;
    out.push({ path: f.path, bytes });
  }
  return out;
}

const corpus = loadCorpus();
const have = corpus !== null;
const when = have ? "" : " (skipped: corpus not downloaded, run node scripts/obsidian-help-corpus.mjs --fetch)";
const files = corpus ?? [];
const notes = files.filter((f) => f.path.endsWith(".md"));
const text = (f: { bytes: Uint8Array }) => decodeUtf8(f.bytes);
const enc = new TextEncoder();
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
/** What the editor does to a note: shows it (no BOM, LF), the user edits nothing, it is written back. */
const throughEditor = (t: string) => {
  const { body, envelope } = splitTextEnvelope(t);
  return joinTextEnvelope(body.replace(/\r\n|\r/g, "\n"), envelope);
};

describe("the obsidian-help manifest (W11.P3)", () => {
  it("pins a commit, lists every text file with its hash, and redistributes nothing", () => {
    expect(manifest.repo).toBe("https://github.com/obsidianmd/obsidian-help");
    expect(manifest.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(manifest.redistributed).toBe(false);
    expect(manifest.licence).toMatch(/^none stated/);
    expect(manifest.files.length).toBe(762);
    const sets = (p: string) => (p.includes("/") ? p.split("/")[0] : "/");
    const count = (s: string) => manifest.files.filter((f) => sets(f.path) === s).length;
    expect([count("en"), count("he"), count("Release notes"), count("Sandbox")]).toEqual([180, 180, 369, 31]);
    for (const f of manifest.files) {
      expect(f.sha256, f.path).toMatch(/^[0-9a-f]{64}$/);
      expect(f.path, f.path).toMatch(/\.(md|base|canvas)$/);
    }
    // None of its files is in the repository.
    const fixtures = readdirSync(join(ROOT, "src/__tests__/fixtures"));
    expect(fixtures.filter((f) => /obsidian-help/.test(f))).toEqual(["obsidian-help.manifest.json"]);
    expect(readFileSync(join(ROOT, ".gitignore"), "utf8")).toContain(".cache/obsidian-help/");
  });
});

describe(`open → save over obsidian-help (W11.P3)${when}`, () => {
  // skip-reason: the obsidian-help corpus is a checkout outside the repo (its own licence); without it the title says so | task: W11.P3 | until: 2027-05-16
  it.runIf(have)("every one of the 762 files is read and written back byte-identical", async () => {
    const differ: string[] = [];
    for (const f of notes) {
      const read = await readText(new Blob([f.bytes as BlobPart]));
      if (!sameBytes(enc.encode(throughEditor(read)), f.bytes)) differ.push(f.path);
    }
    expect(notes).toHaveLength(762);
    expect(differ).toEqual([]);
  });

  // skip-reason: the obsidian-help corpus is a checkout outside the repo (its own licence); without it the title says so | task: W11.P3 | until: 2027-05-16
  it.runIf(have)("the same files saved by Windows (CRLF, BOM) keep their CRLF and BOM", async () => {
    const differ: string[] = [];
    for (const f of notes) {
      const bytes = enc.encode("﻿" + text(f).replace(/\r?\n/g, "\r\n"));
      const read = await readText(new Blob([bytes as BlobPart]));
      if (!sameBytes(enc.encode(throughEditor(read)), bytes)) differ.push(f.path);
    }
    expect(differ).toEqual([]);
  });

  // skip-reason: the obsidian-help corpus is a checkout outside the repo (its own licence); without it the title says so | task: W11.P3 | until: 2027-05-16
  it.runIf(have)("0 parse errors: every frontmatter reads, and writing back a value it has changes nothing", () => {
    let withFm = 0;
    let props = 0;
    const changed: string[] = [];
    const errors: string[] = [];
    for (const f of notes) {
      const t = text(f);
      if (!/^﻿?---\r?\n/.test(t)) continue;
      withFm++;
      try {
        for (const p of readProperties(t)) {
          if (!p.editable) continue;
          props++;
          if (setProperty(t, p.key, p.value as PropertyValue) !== t) changed.push(`${f.path}: ${p.key}`);
        }
      } catch (e) {
        errors.push(`${f.path}: ${(e as Error).message}`);
      }
    }
    console.log(`obsidian-help: ${withFm} frontmatters, ${props} editable properties`);
    expect(errors).toEqual([]);
    expect(changed).toEqual([]);
    expect(withFm).toBeGreaterThanOrEqual(480);
    expect(props).toBeGreaterThanOrEqual(1000);
  });

  // skip-reason: the obsidian-help corpus is a checkout outside the repo (its own licence); without it the title says so | task: W11.P3 | until: 2027-05-16
  it.runIf(have)("the ```base block in the docs parses as a base", () => {
    const blocks = notes.flatMap((f) => [...text(f).matchAll(/^```base\r?\n([\s\S]*?)^```/gm)].map((m) => ({ path: f.path, src: m[1] })));
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    for (const b of blocks) expect(parseBase(b.src).ok, b.path).toBe(true);
  });

  // The Obsidian layer of the renderer (callouts, ==highlights==, embeds, %% comments) over remark's parse.
  // The full pipeline adds GFM, math and React, whose packages this offline runner stubs; the Mac runs it.
  const obsidianTree = (t: string) => {
    const proc = unified().use(remarkParse).use(remarkObsidian);
    return proc.runSync(proc.parse(t)) as Root;
  };
  type Node = { type: string; children?: Node[]; data?: { hName?: string; hProperties?: { className?: string[] } } };
  const walk = (n: Node, f: (n: Node) => void) => {
    f(n);
    for (const c of n.children ?? []) walk(c, f);
  };

  // skip-reason: the obsidian-help corpus is a checkout outside the repo (its own licence); without it the title says so | task: W11.P3 | until: 2027-05-16
  it.runIf(have)("renders every file through the Obsidian layer: callouts, highlights and embeds come out as Obsidian marks them", () => {
    const errors: string[] = [];
    let calloutsIn = 0;
    let calloutsOut = 0;
    let marksIn = 0;
    let marksOut = 0;
    let embedsIn = 0;
    let imagesOut = 0;
    let imageEmbedsIn = 0;
    for (const f of notes) {
      const t = text(f);
      const body = t.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
      // Outside code: fenced blocks and inline code don't render their syntax.
      const prose = body.replace(/^(```|~~~)[\s\S]*?^\1/gm, "").replace(/`[^`\n]*`/g, "");
      calloutsIn += (prose.match(/^>\s?\[![\w-]+\][+-]?/gm) ?? []).length;
      marksIn += (prose.match(/==[^=\s][^=\n]*?==/g) ?? []).length;
      embedsIn += (prose.match(/!\[\[[^\]]+\]\]/g) ?? []).length;
      imageEmbedsIn += (prose.match(/!\[\[[^\]|#]+\.(png|jpe?g|gif|svg|webp|avif|bmp)(\|[^\]]*)?\]\]/gi) ?? []).length;
      let tree: Root;
      try {
        tree = obsidianTree(t);
      } catch (e) {
        errors.push(`${f.path}: ${(e as Error).message}`);
        continue;
      }
      walk(tree as Node, (n) => {
        if (n.data?.hProperties?.className?.includes("callout")) calloutsOut++;
        if (n.data?.hName === "mark") marksOut++;
        if (n.type === "image") imagesOut++;
      });
    }
    console.log(`obsidian-help: callouts ${calloutsIn} → ${calloutsOut}, highlights ${marksIn} → ${marksOut}, embeds ${embedsIn} (images ${imageEmbedsIn}), images out ${imagesOut}`);
    expect(errors).toEqual([]);
    expect(calloutsIn).toBeGreaterThanOrEqual(300);
    // A callout inside a callout counts once in the source pattern but renders twice; never fewer.
    expect(calloutsOut).toBeGreaterThanOrEqual(calloutsIn);
    expect(marksIn).toBeGreaterThanOrEqual(5);
    expect(marksOut).toBeGreaterThanOrEqual(marksIn);
    expect(embedsIn).toBeGreaterThanOrEqual(300);
    // Image embeds (![[x.png]]) become images; note embeds are resolved later, by remarkEmbeds, against the vault.
    expect(imageEmbedsIn).toBeGreaterThanOrEqual(40);
    expect(imagesOut).toBeGreaterThanOrEqual(imageEmbedsIn);
  });

  // skip-reason: the obsidian-help corpus is a checkout outside the repo (its own licence); without it the title says so | task: W11.P3 | until: 2027-05-16
  it.runIf(have)("renaming a note and renaming it back leaves every linking note byte-identical, except where Obsidian also writes the note's own name", () => {
    let checks = 0;
    const changed: string[] = [];
    const caseOnly: string[] = [];
    for (const vault of ["en", "he"]) {
      const mine = notes.filter((f) => f.path.startsWith(`${vault}/`)).map((f) => ({ path: f.path.slice(vault.length + 1), t: text(f) }));
      const paths = mine.map((f) => f.path).sort();
      // Every 6th note as the renamed one keeps this well under a minute.
      for (const target of paths.filter((_, i) => i % 6 === 0)) {
        const renamed = target.replace(/\.md$/, " שונה.md");
        const after = paths.map((p) => (p === target ? renamed : p));
        for (const f of mine) {
          if (f.path === target) continue;
          const a = rewriteLinks(f.t, f.path, target, renamed, { vault: paths });
          if (a === f.t) continue;
          checks++;
          const back = rewriteLinks(a, f.path, renamed, target, { vault: after });
          if (back === f.t) continue;
          // `[[themes]]` comes back as `[[Themes]]`, the note's real name: what Obsidian writes too (as in W4.30).
          const name = target.split("/").pop()!.replace(/\.md$/, "");
          if (back.toLowerCase() === f.t.toLowerCase() && back.includes(`[[${name}`)) caseOnly.push(`${vault}/${f.path} ← ${target}`);
          else changed.push(`${vault}/${f.path} ← ${target}`);
        }
      }
    }
    console.log(`obsidian-help: ${checks} rename round trips, ${caseOnly.length} come back with the note's own capitalisation`);
    expect(checks).toBeGreaterThanOrEqual(100);
    expect(changed).toEqual([]);
    expect(caseOnly.length).toBeLessThanOrEqual(checks / 10);
  });
});
