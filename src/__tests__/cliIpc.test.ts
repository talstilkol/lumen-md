// @vitest-environment node
/**
 * W13.K1: `lumen` talks to the running app over a per-user socket — 40
 * commands in 8 categories, no eval, writes proposed for review by default,
 * JSON for every command, help in Hebrew and English, and `move` updates
 * every link in the vault (compared byte for byte with a hand-edited gold
 * vault, src/__tests__/fixtures/cli-gold-vault).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { promises as fs, statSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as net from "node:net";
import { CATEGORIES, SPECS, helpText, REFUSED } from "../../mcp-server/src/ipc/specs";
import { runCommand, type VaultPort } from "../../mcp-server/src/ipc/commands";
import { applyChangeSet, listChangeSets } from "../../mcp-server/src/ipc/changeset";
import { diskHost, diskPort } from "../../mcp-server/src/ipc/host";
import { serveIpc, type IpcServer } from "../../mcp-server/src/ipc/server";
import { callApp, runIpcCli } from "../../mcp-server/src/ipc/client";
import { endpointFor, readEndpointFile, SETTINGS_FILE } from "../../mcp-server/src/ipc/endpoint";
import { setLinksEngine } from "../../mcp-server/src/ipc/links";
import { renameTag, removeTag, setProperty, tagsOf, linksOf, blankCode } from "../../mcp-server/src/ipc/analyze";
import * as links from "../cli/linksEngine";

const GOLD = path.resolve("src/__tests__/fixtures/cli-gold-vault");
const MOVE_FROM = "מתכונים/עוגה.md";
const MOVE_TO = "אפייה/לחם/עוגת שמרים.md";

async function copyDir(from: string, to: string): Promise<void> {
  await fs.mkdir(to, { recursive: true });
  for (const e of await fs.readdir(from, { withFileTypes: true })) {
    if (e.isDirectory()) await copyDir(path.join(from, e.name), path.join(to, e.name));
    else await fs.copyFile(path.join(from, e.name), path.join(to, e.name));
  }
}

async function tree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const files = await diskPort(dir).files();
  for (const f of files) out[f] = await fs.readFile(path.join(dir, ...f.split("/")), "utf8");
  return out;
}

let tmp: string;
let vault: string;
let cfg: string;
let env: Record<string, string>;

beforeAll(() => setLinksEngine(links));
afterAll(() => setLinksEngine(null));
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lumen-k1-"));
  vault = path.join(tmp, "vault");
  cfg = path.join(tmp, "cfg");
  env = { LUMEN_CONFIG_DIR: cfg, LUMEN_VAULT: vault, LANG: "en_US.UTF-8" };
  await copyDir(path.join(GOLD, "vault"), vault);
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

function io(extra: Partial<Parameters<typeof runIpcCli>[1]> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l), env, cwd: tmp, now: () => new Date(2026, 10, 17, 9, 30), launchWaitMs: 300, launch: () => {}, ...extra } };
}

const run = async (argv: string[], extra: Partial<Parameters<typeof runIpcCli>[1]> = {}) => {
  const t = io(extra);
  const code = await runIpcCli(argv, t.io);
  return { code, out: t.out, err: t.err, json: argv.includes("--json") ? JSON.parse(t.out.join("\n")) : null };
};

describe("the command set", () => {
  it("has 40 commands in 8 categories, each with English and Hebrew help, and no eval", () => {
    expect(SPECS).toHaveLength(40);
    expect(new Set(SPECS.map((s) => s.name)).size).toBe(40);
    expect(Object.keys(CATEGORIES)).toHaveLength(8);
    for (const cat of Object.keys(CATEGORIES)) expect(SPECS.some((s) => s.category === cat), cat).toBe(true);
    for (const s of SPECS) {
      expect(s.en.length, s.name).toBeGreaterThan(8);
      expect(s.he, s.name).toMatch(/[א-ת]/);
    }
    expect(SPECS.map((s) => s.name)).not.toContain("eval");
    expect(REFUSED.eval.he).toMatch(/eval/);
  });

  it("lumen help <cmd> in Hebrew and English", async () => {
    const he = await run(["help", "move", "--lang", "he"]);
    expect(he.code).toBe(0);
    expect(he.out.join("\n")).toContain("העברת פתק ועדכון כל הקישורים");
    const en = await run(["help", "move"]);
    expect(en.out.join("\n")).toContain("Move a note and update every link");
    const all = helpText("he")!;
    for (const c of Object.values(CATEGORIES)) expect(all).toContain(`${c.he}:`);
    expect((await run(["help", "nope"])).code).toBe(3);
  });

  it("eval is refused, in both languages, and nothing runs", async () => {
    const r = await run(["eval", "app.vault.delete()"]);
    expect(r.code).toBe(2);
    expect(r.err.join("\n")).toMatch(/no eval/);
    const he = await run(["eval", "1", "--lang", "he"]);
    expect(he.err.join("\n")).toMatch(/אין eval/);
  });
});

describe("the socket", () => {
  let srv: IpcServer;
  beforeEach(async () => {
    srv = await serveIpc({ host: { ...diskHost(vault, cfg), port: { ...diskPort(vault), mode: "app" } }, configDir: cfg, endpoint: endpointFor({ env }) });
  });
  afterEach(async () => {
    await srv.close();
  });

  it("is a 0600 Unix socket with a 0600 token file of 256 bits, never TCP", async () => {
    expect(srv.endpoint.startsWith("/")).toBe(true);
    expect(statSync(srv.endpoint).isSocket()).toBe(true);
    expect(statSync(srv.endpoint).mode & 0o077).toBe(0);
    const f = path.join(cfg, "cli-ipc.json");
    expect(statSync(f).mode & 0o077).toBe(0);
    const ep = (await readEndpointFile(cfg))!;
    expect(Buffer.from(ep.token, "base64url")).toHaveLength(32);
    expect(ep.vault).toBe(vault);
  });

  it("refuses a wrong or missing token and runs nothing", async () => {
    const ep = (await readEndpointFile(cfg))!;
    const r = await callApp({ ...ep, token: "x".repeat(43) }, { cmd: "create", args: ["new.md", "hi"], flags: {}, yes: false });
    expect(r!.exit).toBe(77);
    const raw = await new Promise<string>((resolve) => {
      const s = net.connect(ep.endpoint, () => s.write(JSON.stringify({ v: 1, cmd: "files", args: [], flags: {} }) + "\n"));
      let b = "";
      s.on("data", (c) => (b += c));
      s.on("end", () => resolve(b));
    });
    expect(JSON.parse(raw).exit).toBe(77);
    expect(await listChangeSets(vault)).toHaveLength(0);
  });

  it("answers through the app when it is running (via: app)", async () => {
    const r = await run(["backlinks", "projects/plan.md", "--json"]);
    expect(r.code).toBe(0);
    expect(r.json.via).toBe("app");
    expect(r.json.data.map((h: { path: string }) => h.path).sort()).toEqual(["My Note.md", "מתכונים/עוגה.md"]);
  });

  it("a write through the app is proposed, not written", async () => {
    const before = await tree(vault);
    const r = await run(["move", MOVE_FROM, MOVE_TO, "--json"]);
    expect(r.code).toBe(0);
    expect(r.json.proposed.id).toMatch(/^[a-z0-9]+$/);
    expect(await tree(vault)).toEqual(before);
    expect(await listChangeSets(vault)).toHaveLength(1);
  });
});

describe("move updates every link in the vault (gold vault)", () => {
  it("the approved move gives the hand-edited vault, byte for byte", async () => {
    const r = await run(["move", MOVE_FROM, MOVE_TO, "--offline", "--json"]);
    expect(r.code).toBe(0);
    expect(r.json.data).toMatchObject({ from: MOVE_FROM, to: MOVE_TO, linksUpdated: 2 });
    const [cs] = await listChangeSets(vault);
    expect((await applyChangeSet(vault, cs)).status).toBe("applied");
    const expected = await tree(path.join(GOLD, "expected-after-move"));
    expect(await tree(vault)).toEqual(expected);
    expect(await listChangeSets(vault)).toHaveLength(0);
  });

  it("move into a folder keeps the name; rename keeps the folder", async () => {
    const m = await run(["move", "orphan.md", "projects/", "--json", "--offline"]);
    expect(m.json.data.to).toBe("projects/orphan.md");
    const n = await run(["rename", "projects/plan.md", "תוכנית", "--json", "--offline"]);
    expect(n.json.data.to).toBe("projects/תוכנית.md");
    const ops = (await listChangeSets(vault))[1].ops;
    const myNote = ops.find((o) => o.op === "write" && o.path === "My Note.md");
    expect(myNote && myNote.op === "write" && myNote.after).toContain("[[projects/תוכנית]]");
  });

  it("refuses to move onto an existing note, and a conflict writes nothing", async () => {
    expect((await run(["move", "orphan.md", "בית.md", "--offline"])).code).toBe(2);
    await run(["move", MOVE_FROM, MOVE_TO, "--offline"]);
    await fs.appendFile(path.join(vault, "projects/plan.md"), "edited\n");
    const before = await tree(vault);
    const [cs] = await listChangeSets(vault);
    const res = await applyChangeSet(vault, cs);
    expect(res).toMatchObject({ status: "conflict", path: "projects/plan.md" });
    expect(await tree(vault)).toEqual(before);
  });
});

describe("app closed", () => {
  it("read commands work against the disk", async () => {
    const r = await run(["orphans", "--json"]);
    expect(r.json.via).toBe("disk");
    expect(r.json.data).toEqual(["journal/2026-11-16.md", "orphan.md"]);
  });

  it("a write starts the app and, when it does not come up, writes nothing (exit 4)", async () => {
    let launched = 0;
    const r = await run(["create", "new.md", "hello"], { launch: () => launched++ });
    expect(launched).toBe(1);
    expect(r.code).toBe(4);
    expect(await listChangeSets(vault)).toHaveLength(0);
  });

  it("a write waits for the app it started", async () => {
    let srv: IpcServer | null = null;
    const r = await run(["create", "new.md", "hello", "--json"], {
      launchWaitMs: 5000,
      launch: () => void serveIpc({ host: diskHost(vault, cfg), configDir: cfg, endpoint: endpointFor({ env }) }).then((s) => (srv = s)),
    });
    expect(r.code).toBe(0);
    expect(r.json.proposed).toBeTruthy();
    await (srv as IpcServer | null)?.close();
  });
});

describe("lumen approve", () => {
  it("shows the change and writes only after a typed yes at a terminal", async () => {
    await run(["move", MOVE_FROM, MOVE_TO, "--offline"]);
    const [cs] = await listChangeSets(vault);
    const before = await tree(vault);
    const piped = await run(["approve", cs.id]);
    expect(piped.code).toBe(2);
    expect(piped.out.join("\n")).toContain(`→ ${MOVE_FROM} ⇒ ${MOVE_TO}`);
    expect(await tree(vault)).toEqual(before);
    expect((await run(["approve", cs.id], { tty: true, ask: async () => "no" })).code).toBe(1);
    expect(await tree(vault)).toEqual(before);
    expect((await run(["approve", cs.id], { tty: true, ask: async () => "yes" })).code).toBe(0);
    expect(await tree(vault)).toEqual(await tree(path.join(GOLD, "expected-after-move")));
  });
});

describe("--yes", () => {
  it("is refused unless the user turned it on in the app, then applies", async () => {
    const before = await tree(vault);
    const no = await run(["task:done", "בית.md", "18", "--yes", "--offline"]);
    expect(no.code).toBe(2);
    expect(no.err.join(" ")).toMatch(/--yes is off/);
    expect(await tree(vault)).toEqual(before);
    await fs.mkdir(cfg, { recursive: true });
    await fs.writeFile(path.join(cfg, SETTINGS_FILE), JSON.stringify({ allowYes: true }));
    const yes = await run(["task:done", "בית.md", "18", "--yes", "--offline", "--json"]);
    expect(yes.code).toBe(0);
    expect(yes.json.applied).toEqual(["בית.md"]);
    expect(await fs.readFile(path.join(vault, "בית.md"), "utf8")).toContain("- [x] לאפות");
  });
});

/** Every one of the 40 commands, with --json, against the gold vault. */
describe("40/40 commands", () => {
  const port = (): VaultPort => diskPort(vault);
  const cmd = async (name: string, args: string[] = [], flags: Record<string, string> = {}) => runCommand(port(), { cmd: name, args, flags }, { now: new Date(2026, 10, 16, 8, 5) });
  const changed = (o: Awaited<ReturnType<typeof cmd>>, p: string) => {
    const op = o.change?.ops.find((x) => x.op === "write" && x.path === p);
    return op && op.op === "write" ? op.after : null;
  };
  const tested = new Set<string>();
  const t = (name: string, fn: () => Promise<void>) =>
    it(name, async () => {
      tested.add(name);
      await fn();
    });

  t("files", async () => expect((await cmd("files", [], { folder: "projects" })).data).toEqual(["projects/plan.md"]));
  t("folders", async () => expect((await cmd("folders")).data).toEqual(["archive", "journal", "projects", "מתכונים"]));
  t("read", async () => expect(((await cmd("read", ["My Note"])).data as { text: string }).text).toContain("[[projects/plan]]"));
  t("create", async () => {
    const o = await cmd("create", ["רעיונות/חדש", "שורה"]);
    expect(o.change!.ops).toEqual([{ op: "write", path: "רעיונות/חדש.md", before: null, after: "שורה\n" }]);
    expect((await cmd("create", ["בית"])).exit).toBe(2);
  });
  t("insert", async () => {
    expect(changed(await cmd("insert", ["orphan", "סוף"]), "orphan.md")).toMatch(/#project\nסוף\n$/);
    expect(changed(await cmd("insert", ["בית", "ראש"], { at: "start" }), "בית.md")).toMatch(/^---\ntitle: בית\ntags: \[מטבח, home\]\n---\nראש\n# בית/);
  });
  t("move", async () => expect((await cmd("move", [MOVE_FROM, MOVE_TO])).change!.ops[0]).toMatchObject({ op: "move", from: MOVE_FROM, to: MOVE_TO }));
  t("rename", async () => expect((await cmd("rename", ["orphan", "יתום"])).change!.ops[0]).toMatchObject({ op: "move", to: "יתום.md" }));
  t("delete", async () => {
    const o = await cmd("delete", ["projects/plan.md"]);
    expect(o.change!.ops).toHaveLength(1);
    expect((o.data as { breaksLinks: unknown[] }).breaksLinks).toHaveLength(2);
  });
  t("backlinks", async () => {
    const o = await cmd("backlinks", [MOVE_FROM]);
    // בית: 2 wiki, 2 Markdown, 1 embed (code ignored, the short [[עוגה]] is the archive's); plan: wiki + reference.
    expect((o.data as Array<{ path: string }>).map((h) => h.path)).toEqual(["projects/plan.md", "projects/plan.md", "בית.md", "בית.md", "בית.md", "בית.md", "בית.md"].sort((a, b) => a.localeCompare(b)).sort());
  });
  t("links", async () => {
    const l = (await cmd("links", ["projects/plan.md"])).data as Array<{ target: string; path: string | null }>;
    expect(l.find((x) => x.target === "../My Note.md")?.path).toBe("My Note.md");
    expect(l.find((x) => x.target === "לא קיים")?.path).toBeNull();
  });
  t("orphans", async () => expect((await cmd("orphans")).data).toEqual(["journal/2026-11-16.md", "orphan.md"]));
  t("unresolved", async () => expect((await cmd("unresolved")).data).toEqual([{ target: "לא קיים", from: [{ path: "My Note.md", line: 3 }, { path: "projects/plan.md", line: 7 }] }, { target: "Nowhere", from: [{ path: "projects/plan.md", line: 7 }] }]));
  t("deadends", async () => expect((await cmd("deadends")).data).toEqual(["archive/עוגה.md", "journal/2026-11-16.md", "orphan.md"]));
  t("embeds", async () => expect((await cmd("embeds")).data).toEqual([{ from: "בית.md", line: 9, target: "מתכונים/עוגה", path: MOVE_FROM }]));
  t("tags", async () => {
    const tags = (await cmd("tags")).data as Array<{ tag: string; count: number }>;
    expect(tags.find((x) => x.tag === "מטבח")?.count).toBe(2);
    expect(tags.find((x) => x.tag === "project")?.count).toBe(2);
    expect(tags.find((x) => x.tag === "מטבח/אפייה")?.count).toBe(1);
  });
  t("tag:notes", async () => expect((await cmd("tag:notes", ["#מטבח"])).data).toEqual(["בית.md", MOVE_FROM]));
  t("tags:rename", async () => {
    const o = await cmd("tags:rename", ["מטבח", "בישול"]);
    expect(o.change!.ops).toHaveLength(2);
    expect(changed(o, "בית.md")).toContain("tags: [בישול, home]");
    expect(changed(o, "בית.md")).toContain("#בישול/אפייה");
    expect(changed(o, MOVE_FROM)).toContain("  - בישול\n");
  });
  t("tag:remove", async () => {
    const o = await cmd("tag:remove", ["project"], { note: "orphan" });
    expect(changed(o, "orphan.md")).toBe("# Orphan\n\nNobody links here. \n");
  });
  t("properties", async () => {
    expect((await cmd("properties", [MOVE_FROM])).data).toMatchObject({ title: "עוגת שמרים", servings: "8", tags: ["מטבח", "מתוק"] });
    expect((await cmd("properties")).data).toContainEqual({ name: "title", count: 2 });
  });
  t("property:get", async () => {
    expect((await cmd("property:get", ["projects/plan", "status"])).data).toBe("draft");
    expect((await cmd("property:get", ["projects/plan", "nope"])).exit).toBe(3);
  });
  t("property:set", async () => {
    expect(changed(await cmd("property:set", ["projects/plan", "status", "done"]), "projects/plan.md")).toMatch(/^---\nstatus: done\n---\n# Plan/);
    expect(changed(await cmd("property:set", ["orphan", "aliases", "a, ב"], { list: "1" }), "orphan.md")).toMatch(/^---\naliases: \["a", "ב"\]\n---\n# Orphan/);
  });
  t("property:remove", async () => expect(changed(await cmd("property:remove", [MOVE_FROM, "tags"]), MOVE_FROM)).toMatch(/^---\ntitle: עוגת שמרים\nservings: 8\n---\n/));
  t("property:rename", async () => {
    const o = await cmd("property:rename", ["title", "כותרת"]);
    expect(o.change!.ops).toHaveLength(2);
    expect(changed(o, "בית.md")).toContain("כותרת: בית");
  });
  t("find", async () => {
    // Niqqud and the prefix letter ignored: "וּשְׁמָרִים" finds "שמרים".
    const hits = (await cmd("find", ["וּשְׁמָרִים"])).data as Array<{ path: string; line: number }>;
    expect(hits[0]).toMatchObject({ path: MOVE_FROM, line: 16, snippet: "- שמרים" });
    expect((await cmd("find", ["zzzz"])).exit).toBe(3);
  });
  t("outline", async () => expect((await cmd("outline", [MOVE_FROM])).data).toEqual([{ level: 1, text: "עוגה", line: 8 }, { level: 2, text: "מצרכים", line: 13 }, { level: 2, text: "שלבים", line: 18 }]));
  t("wordcount", async () => expect((await cmd("wordcount", ["orphan"])).data).toMatchObject({ words: 5 }));
  t("recent", async () => {
    await fs.utimes(path.join(vault, "orphan.md"), new Date(), new Date(Date.now() + 60_000));
    expect(((await cmd("recent", [], { limit: "1" })).data as Array<{ path: string }>)[0].path).toBe("orphan.md");
  });
  t("tasks", async () => {
    expect(((await cmd("tasks", [], { open: "1" })).data as unknown[]).length).toBe(3);
    expect((await cmd("tasks", ["בית"], { done: "1" })).data).toEqual([{ path: "בית.md", line: 19, done: true, text: "לקנות קמח" }]);
  });
  t("task:done", async () => {
    expect(changed(await cmd("task:done", ["בית", "18"]), "בית.md")).toContain("- [x] לאפות #מטבח/אפייה");
    expect((await cmd("task:done", ["בית", "7"])).exit).toBe(1);
  });
  t("task:undone", async () => expect(changed(await cmd("task:undone", ["בית", "19"]), "בית.md")).toContain("- [ ] לקנות קמח"));
  t("task:add", async () => expect(changed(await cmd("task:add", ["orphan", "לבדוק"]), "orphan.md")).toMatch(/- \[ \] לבדוק\n$/));
  t("daily:path", async () => expect((await cmd("daily:path")).data).toEqual({ path: "journal/2026-11-16.md", exists: true }));
  t("daily:read", async () => {
    expect(((await cmd("daily:read")).data as { text: string }).text).toContain("09:00 התחלה");
    expect((await cmd("daily:read", [], { date: "2020-01-01" })).exit).toBe(3);
  });
  t("daily:append", async () => expect(changed(await cmd("daily:append", ["עוד", "שורה"]), "journal/2026-11-16.md")).toBe("# 2026-11-16\n- 09:00 התחלה\n- 08:05 עוד שורה\n"));
  t("vault", async () => expect((await cmd("vault")).data).toMatchObject({ root: vault, mode: "disk", notes: 7, files: 7 }));
  t("version", async () => expect((await cmd("version")).data).toMatchObject({ protocol: 1 }));
  t("help", async () => expect(((await cmd("help", ["tags:rename"])).data as { lines: string[] }).lines[0]).toBe("lumen tags:rename <from> <to>"));
  t("stats", async () => expect((await cmd("stats")).data).toMatchObject({ notes: 7, unresolved: 3, tasksOpen: 3, tasksDone: 1 }));
  t("changes", async () => {
    await run(["create", "x.md", "--offline"]);
    const r = await run(["changes", "--json"]);
    expect(r.json.data).toHaveLength(1);
    expect(r.json.data[0].summary).toBe("Create x.md");
  });
  t("discard", async () => {
    await run(["create", "x.md", "--offline"]);
    const [cs] = await listChangeSets(vault);
    expect((await run(["discard", cs.id])).code).toBe(0);
    expect(await listChangeSets(vault)).toHaveLength(0);
    expect((await run(["discard", cs.id])).code).toBe(3);
  });

  it("covers every command, and every command answers --json", async () => {
    expect([...tested].sort()).toEqual(SPECS.map((s) => s.name).sort());
    for (const s of SPECS) {
      const args = s.min ? ["projects/plan.md", "status", "x"].slice(0, s.min) : [];
      const r = await run([s.name, ...args, "--json", "--offline"]);
      expect(r.json, s.name).toMatchObject({ v: 1, via: "disk" });
      expect(typeof r.json.exit, s.name).toBe("number");
    }
  });
});

describe("the analyzers", () => {
  it("code is never a link or a tag", () => {
    expect(linksOf("`[[a]]` and\n```\n[[b]]\n```\n[[c]]").map((l) => l.target)).toEqual(["c"]);
    expect(tagsOf("`#no`\n```\n#no\n```\n#yes")).toEqual(["yes"]);
    expect(blankCode("a `b` c")).toBe("a     c");
  });
  it("tag renames match whole tags and nested ones, not prefixes", () => {
    expect(renameTag("#work #workshop #work/a", "work", "job")).toBe("#job #workshop #job/a");
    expect(removeTag("x #a y", "a")).toBe("x y");
  });
  it("property edits keep the other lines byte for byte", () => {
    const t = "---\nb: 1\nlist:\n  - x\n  - y\nc: \"q\"\n---\nbody\n";
    expect(setProperty(t, "list", "z")).toBe("---\nb: 1\nlist: z\nc: \"q\"\n---\nbody\n");
    expect(() => setProperty(t, "bad key", "1")).toThrow(/not a property/);
  });
});

describe("10k notes", () => {
  it("backlinks, unresolved and a link-aware move over 10,000 notes (in memory, as in the app) take under 2 s each", async () => {
    const N = 10_000;
    const notes = new Map<string, string>();
    for (let i = 0; i < N; i++) notes.set(`n/פתק ${i}.md`, `# ${i}\n[[פתק ${(i + 1) % N}]] [[hub]] #t${i % 50}\n`);
    notes.set("hub.md", "# hub\n");
    const mem: VaultPort = { root: "/mem", mode: "app", files: async () => [...notes.keys()].sort(), read: async (p) => notes.get(p) ?? null };
    const t0 = Date.now();
    const r = await runCommand(mem, { cmd: "backlinks", args: ["hub"], flags: {} });
    expect((r.data as unknown[]).length).toBe(N);
    expect((await runCommand(mem, { cmd: "unresolved", args: [], flags: {} })).data).toEqual([]);
    const mv = await runCommand(mem, { cmd: "move", args: ["hub", "core/מרכז.md"], flags: {} });
    expect(mv.change!.ops).toHaveLength(N + 1);
    expect(Date.now() - t0).toBeLessThan(6000);
  }, 60_000);

  it("the same on disk, read once", async () => {
    const big = path.join(tmp, "big");
    await fs.mkdir(path.join(big, "n"), { recursive: true });
    const N = 10_000;
    await Promise.all(Array.from({ length: N }, (_, i) => fs.writeFile(path.join(big, "n", `פתק ${i}.md`), `# ${i}\n[[hub]]\n`)));
    await fs.writeFile(path.join(big, "hub.md"), "# hub\n");
    const r = await runCommand(diskPort(big), { cmd: "backlinks", args: ["hub"], flags: {} });
    expect((r.data as unknown[]).length).toBe(N);
  }, 60_000);
});
