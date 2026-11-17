/**
 * W2.12 acceptance "20 common Dataview blocks from real vaults rendered" and
 * "update after a save < 100 ms", on real vaults: every ```dataview block in
 * the pinned Obsidian corpus (fixtures/obsidian-corpus, byte-for-byte copies
 * of public vaults, plan W4.30), run over the notes of the vault it is in.
 *
 * - Every block outside a template renders, except CALENDAR (said plainly).
 * - Dataview's own test vault gives the rows Dataview documents, checked
 *   here by hand against the notes (tasks/checklist.md, books/, recipes/).
 * - Templater templates (`<% … %>`, a Templates folder) are not queries
 *   until Templater fills them in; they are counted, not required.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { parseDataview, runDataview, show, type DvNote, type DvResult } from "../search/dataview";

const CORPUS = join(__dirname, "fixtures/obsidian-corpus");
const NOW = Date.UTC(2026, 10, 16, 12);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".md") ? [p] : [];
  });
}

/** The vault in a corpus folder: the sub-folder with .obsidian when there is one. */
function vaultRoot(dir: string): string {
  const inner = readdirSync(dir).find((c) => existsSync(join(dir, c, ".obsidian")));
  return inner ? join(dir, inner) : dir;
}

/** ```dataview blocks of a note, also inside callouts (> ```dataview). */
function blocksOf(content: string): string[] {
  const out: string[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const open = /^((?:[ \t]*>)*[ \t]*)```dataview[ \t]*$/.exec(lines[i]);
    if (!open) continue;
    const prefix = open[1].replace(/\s/g, "");
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const m = /^((?:[ \t]*>)*[ \t]*)(.*)$/.exec(lines[j])!;
      if (m[1].replace(/\s/g, "") === prefix && /^```\s*$/.test(m[2])) break;
      body.push(prefix ? lines[j].replace(/^(?:[ \t]*>)+[ \t]?/, "") : lines[j]);
    }
    if (j < lines.length) out.push(body.join("\n").trim());
    i = j;
  }
  return out;
}

interface Block {
  vault: string;
  note: DvNote;
  notes: DvNote[];
  src: string;
  template: boolean;
}

function corpus(): Block[] {
  const out: Block[] = [];
  for (const vault of readdirSync(CORPUS).filter((f) => statSync(join(CORPUS, f)).isDirectory()).sort()) {
    const root = vaultRoot(join(CORPUS, vault));
    const notes: DvNote[] = walk(root)
      .sort()
      .map((p, i) => ({ path: relative(root, p), name: p.split("/").pop()!, content: readFileSync(p, "utf8"), modified: NOW - i * 60_000 }));
    const seen = new Set<string>();
    for (const note of notes) {
      for (const src of blocksOf(note.content)) {
        if (seen.has(src)) continue;
        seen.add(src);
        out.push({ vault, note, notes, src, template: /<%/.test(src) || /(^|\/)Templates?\//i.test(note.path) });
      }
    }
  }
  return out;
}

const BLOCKS = corpus();
const real = BLOCKS.filter((b) => !b.template);
const run = (b: Block, notes = b.notes): DvResult => runDataview(parseDataview(b.src), notes, NOW, notes.find((n) => n.path === b.note.path));
const ids = (r: DvResult) => r.rows.map((x) => (x.task ? `${x.path}:${x.task.line}${x.group !== undefined ? "@" + x.group : ""}` : x.name));

describe("```dataview blocks of real vaults (W2.12)", () => {
  it("the corpus holds at least 20 distinct blocks outside templates, from at least 4 vaults", () => {
    expect(real.length).toBeGreaterThanOrEqual(20);
    expect(new Set(real.map((b) => b.vault)).size).toBeGreaterThanOrEqual(4);
  });

  it("every one renders, except CALENDAR, which says it is not supported", () => {
    const failed: string[] = [];
    let rendered = 0;
    for (const b of real) {
      try {
        run(b);
        rendered++;
      } catch (e) {
        failed.push(`${b.vault}/${b.note.path}: ${(e as Error).message}`);
      }
    }
    expect(failed.every((f) => /CALENDAR queries are not supported/.test(f))).toBe(true);
    expect(failed.length).toBeLessThanOrEqual(2);
    expect(rendered).toBeGreaterThanOrEqual(20);
  });

  it("LIST, TABLE and TASK, GROUP BY, FLATTEN and (x) => … all occur among them", () => {
    const text = real.map((b) => b.src.toLowerCase()).join("\n");
    for (const word of ["list", "table", "task", "group by", "=>", "this.file"]) expect(text).toContain(word);
    expect(BLOCKS.some((b) => /\bflatten\b/i.test(b.src))).toBe(true);
  });
});

describe("Dataview's own test vault: the documented rows", () => {
  const dv = (src: string) => {
    const b = real.find((x) => x.vault === "obsidian-dataview" && x.src === src);
    if (!b) throw new Error(`block not in the corpus: ${src}`);
    return run(b);
  };
  const CL = "tasks/checklist.md";

  it("list from [[Fiction]] / [[Non-Fiction]]: the books that link there", () => {
    expect(ids(dv("list from [[Fiction]]"))).toEqual(["Catcher in the Rye", "The Great Gatsby"]);
    expect(ids(dv("list from [[Non-Fiction]]"))).toEqual(["Origin of Species"]);
  });

  it('table … from "recipes": front matter per note', () => {
    const r = dv('table cuisine as Cuisine, needsStove as "Needs Stove"\nfrom "recipes"');
    expect(r.headers).toEqual(["File", "Cuisine", "Needs Stove"]);
    expect(r.rows.map((x) => [x.name, ...x.cells.map(show)])).toEqual([
      ["pbj", "American", "false"],
      ["toast", "British", "true"],
    ]);
  });

  it("TABLE … WHERE file = this.file: the note the block is in", () => {
    const b = real.find((x) => x.vault === "obsidian-dataview" && /WHERE file = this.file/.test(x.src) && x.note.path === "example tables.md")!;
    expect(run(b).rows.map((x) => x.name)).toEqual(["example tables"]);
  });

  it("task WHERE completed: the four [x] tasks", () => {
    expect(ids(dv("task WHERE completed"))).toEqual([0, 3, 4, 10].map((l) => `${CL}:${l}`));
  });

  it('task from -"recipes" WHERE !completed: the open tasks outside the recipes', () => {
    expect(ids(dv('task from -"recipes"\nWHERE !completed'))).toEqual([1, 2, 5, 6, 7, 8, 9, 11, 16, 17].map((l) => `${CL}:${l}`));
  });

  it("completion = date(2021-08-06): from ✅ 2021-08-06 and from [completion::2021-08-06]", () => {
    expect(ids(dv('task from "tasks" where\ncompletion = date(2021-08-06)'))).toEqual([`${CL}:3`, `${CL}:4`]);
  });

  it("where p, sort p, group by p: the tasks with their own [p::], by p", () => {
    expect(ids(dv("task\nwhere p\nsort p asc"))).toEqual([`${CL}:9`, `${CL}:11`, `${CL}:10`]);
    expect(ids(dv("task\nwhere p\nsort p asc\ngroup by p"))).toEqual([`${CL}:9@1`, `${CL}:11@1`, `${CL}:10@2`]);
  });

  it("meta(section).subpath: the tasks under ## Section", () => {
    expect(ids(dv('task\nwhere meta(section).subpath = "Section"\ngroup by section'))).toEqual([`${CL}:16@Section`, `${CL}:17@Section`]);
  });

  it("task where annotated: the tasks with a [field::] or an emoji date", () => {
    expect(ids(dv("task where annotated"))).toEqual([0, 3, 4, 5, 6, 7, 9, 10, 11].map((l) => `${CL}:${l}`));
  });
});

describe("update after a save, in a real vault", () => {
  it("re-runs every block of the vault after a save in under 100 ms, and the saved change shows", () => {
    const blocks = real.filter((b) => b.vault === "obsidian-dataview" && !/^calendar\b/i.test(b.src));
    const queries = blocks.map((b) => ({ b, q: parseDataview(b.src) }));
    let notes = blocks[0].notes.slice();
    const runAll = () => queries.map(({ b, q }) => runDataview(q, notes, NOW, notes.find((n) => n.path === b.note.path)));
    runAll(); // the blocks have run before the save
    const completedOf = () => ids(runAll()[blocks.findIndex((b) => b.src === "task WHERE completed")]);
    const times: number[] = [];
    // Five saves of checklist.md, each ticking one more open task.
    for (const line of [1, 5, 6, 7, 8]) {
      const i = notes.findIndex((n) => n.path === "tasks/checklist.md");
      const lines = notes[i].content.split("\n");
      lines[line] = lines[line].replace("[ ]", "[x]");
      notes = notes.slice();
      notes[i] = { ...notes[i], content: lines.join("\n"), modified: notes[i].modified + 1000 };
      const t0 = performance.now();
      const after = completedOf();
      times.push(performance.now() - t0);
      expect(after).toContain(`tasks/checklist.md:${line}`);
    }
    times.sort((a, b) => a - b);
    expect(times[2]).toBeLessThan(100);
  });
});
