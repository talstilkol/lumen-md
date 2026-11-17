/**
 * Plan W13.F5 — the Pandoc bridge: formats Lumen does not import itself,
 * converted by the user's own Pandoc on the desktop
 * (src/storage/import/pandocBridge.ts; the process side is
 * src-tauri/src/pandoc.rs, tested with rustc --test against a fake pandoc).
 *
 * Here Pandoc is mocked at the Tauri boundary: five formats (DocBook,
 * MediaWiki, Jira, OPML, txt2tags) come in as notes; every run is in the
 * privacy ledger as a local process; without Pandoc the source is hidden;
 * no GPL code is in the bundle (the licence list has no pandoc).
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { convertWithPandoc, pandocStatus, readerFor, type Invoke, type PandocStatus } from "../storage/import/pandocBridge";
import { IMPORT_SOURCES, SOURCE_ACCEPT } from "../storage/import/convert";
import { linkStats } from "../storage/import/links";

const enc = new TextEncoder();
const READY: PandocStatus = { kind: "ready", version: "pandoc 3.8.2", readers: ["docbook", "mediawiki", "jira", "opml", "t2t", "markdown"] };

/** A stand-in for the desktop's commands: what pandoc would answer per reader (the Rust side checks the real argv). */
function fakeInvoke(calls: Array<Record<string, unknown>>): Invoke {
  return (async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "pandoc_status") return { version: "pandoc 3.8.2", readers: READY.kind === "ready" ? READY.readers : [] };
    if (cmd !== "pandoc_convert") throw new Error(`unknown command ${cmd}`);
    calls.push(args ?? {});
    const input = new TextDecoder().decode(Uint8Array.from(args!.data as number[]));
    switch (args!.format) {
      case "docbook":
        return `# ${/<title>([^<]*)<\/title>/.exec(input)?.[1] ?? ""}\n\nמתוך DocBook. ראו [[ויקי]].\n`;
      case "mediawiki":
        return "## פרק\n\n[[DocBook מאמר|קישור]]\n";
      case "jira":
        return "- [ ] משימה\n- [x] בוצע\n";
      case "opml":
        return "- נושא\n    - תת־נושא\n";
      case "t2t":
        return "**מודגש**\n";
      default:
        throw { message: `pandoc failed: ${String(args!.format)}` };
    }
  }) as Invoke;
}

describe("which files go to Pandoc", () => {
  it("by extension, only readers this Pandoc lists; .xml only when it is DocBook", () => {
    const r = READY.kind === "ready" ? READY.readers : [];
    expect(readerFor("a.dbk", "", r)).toBe("docbook");
    expect(readerFor("a.xml", '<?xml version="1.0"?><article xmlns="http://docbook.org/ns/docbook" version="5.0">', r)).toBe("docbook");
    expect(readerFor("a.xml", "<rss/>", r)).toBeNull();
    expect(readerFor("Page.wiki", "", r)).toBe("mediawiki");
    expect(readerFor("x.textile", "", r)).toBeNull(); // this Pandoc did not list textile
    expect(readerFor("note.md", "", r)).toBeNull(); // Lumen reads Markdown itself
  });
});

describe("five formats through the user's Pandoc (mocked)", () => {
  it("DocBook, MediaWiki, Jira, OPML and txt2tags become notes; each run is listed in the privacy ledger as a local process", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const record = vi.fn();
    const files = new Map<string, Uint8Array>([
      ["docs/מאמר.dbk", enc.encode('<article><title>מאמר</title><para>טקסט</para></article>')],
      ["ויקי.wiki", enc.encode("== פרק ==\n[[DocBook מאמר|קישור]]")],
      ["tasks.jira", enc.encode("* משימה")],
      ["outline.opml", enc.encode("<opml><body><outline text='נושא'/></body></opml>")],
      ["notes.t2t", enc.encode("**מודגש**")],
      ["readme.md", enc.encode("# not for pandoc")],
    ]);
    const v = await convertWithPandoc(files, { invoke: fakeInvoke(calls), status: READY, record });
    expect([...v.notes.keys()].sort()).toEqual(["docs/מאמר.md", "notes.md", "outline.md", "tasks.md", "ויקי.md"]);
    expect(v.notes.get("docs/מאמר.md")).toBe("# מאמר\n\nמתוך DocBook. ראו [[ויקי]].\n");
    expect(v.notes.get("tasks.md")).toContain("- [x] בוצע");
    expect(calls.map((c) => c.format)).toEqual(["docbook", "mediawiki", "jira", "opml", "t2t"]);
    expect(calls[0]).toMatchObject({ ext: "dbk" });
    expect(record).toHaveBeenCalledTimes(5);
    expect(record.mock.calls[0][0]).toBe("pandoc");
    expect(record.mock.calls[0][1]).toMatch(/^Pandoc 3\.8\.2 \(installed by you\): docbook → Markdown, sandboxed, no network$/);
    expect(v.skipped).toEqual([{ path: "readme.md", reason: "unsupported" }]);
    expect(linkStats(v).total).toBe(2);
  });

  it("a Pandoc failure is reported with its message, and the other files still come in", async () => {
    const files = new Map([
      ["a.jira", enc.encode("x")],
      ["b.t2t", enc.encode("y")],
    ]);
    const invoke = (async (cmd: string, args?: Record<string, unknown>) => {
      if (args?.format === "jira") throw { message: "Error at line 1: unexpected" };
      return fakeInvoke([])(cmd, args);
    }) as Invoke;
    const v = await convertWithPandoc(files, { invoke, status: READY, record: () => {} });
    expect(v.skipped).toEqual([{ path: "a.jira", reason: "unreadable", detail: "Error at line 1: unexpected" }]);
    expect([...v.notes.keys()]).toEqual(["b.md"]);
  });

  it("without a ready Pandoc nothing is run: every file is reported", async () => {
    const invoke = vi.fn();
    const v = await convertWithPandoc(new Map([["a.jira", enc.encode("x")]]), { invoke: invoke as unknown as Invoke, status: { kind: "missing" }, record: () => {} });
    expect(invoke).not.toHaveBeenCalled();
    expect(v.skipped).toEqual([{ path: "a.jira", reason: "unsupported", detail: "Pandoc" }]);
  });
});

describe("the source is offered only with Pandoc", () => {
  it("browser: web; desktop without the command or the binary: missing; too old: old; installed: ready", async () => {
    expect(await pandocStatus({ desktop: false })).toEqual({ kind: "web" });
    expect(await pandocStatus({ desktop: true, invoke: (async () => Promise.reject(new Error("unknown command"))) as Invoke })).toEqual({ kind: "missing" });
    expect(await pandocStatus({ desktop: true, invoke: (async () => ({ version: null, readers: [] })) as Invoke })).toEqual({ kind: "missing" });
    expect(await pandocStatus({ desktop: true, invoke: (async () => ({ version: "pandoc 2.11", readers: [], tooOld: true })) as Invoke })).toEqual({ kind: "old", version: "pandoc 2.11" });
    expect((await pandocStatus({ desktop: true, invoke: fakeInvoke([]) })).kind).toBe("ready");
  });

  it("the wizard lists Pandoc only when it is ready, and picks the formats it reads", () => {
    expect(IMPORT_SOURCES).toContain("pandoc");
    const wizard = readFileSync("src/storage/import/ImportWizard.tsx", "utf8");
    expect(wizard).toContain('IMPORT_SOURCES.filter((s) => s !== "pandoc" || pandocReady)');
    for (const ext of [".dbk", ".wiki", ".jira", ".opml", ".t2t"]) expect(SOURCE_ACCEPT.pandoc.split(",")).toContain(ext);
  });
});

describe("licences", () => {
  it("no Pandoc (GPL) in the dependencies: it is the user's program, not part of Lumen", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as Record<string, Record<string, string>>;
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps.filter((d) => /pandoc/i.test(d))).toEqual([]);
    expect(readFileSync("src-tauri/Cargo.toml", "utf8")).not.toMatch(/pandoc/i);
  });

  it("npm run licenses is green", () => {
    const r = spawnSync(process.execPath, [join(process.cwd(), "scripts/licenses.mjs")], { encoding: "utf8" });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
});
