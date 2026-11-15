/**
 * Plan W12.T4 — types over MCP and the CLI: `list_types`, `get_type` and
 * `create_object` (through the approval queue, inside the W11.I7 folder and
 * tag scope), and `lumen types` / `lumen new --type`.
 *
 * Acceptance: an outside agent that creates a ספר with a wrong field gets a
 * schema error, not a write; a write outside the scope is refused and
 * logged in the MCP ledger (W11.I9).
 *
 * The calls go through the real JSON-RPC endpoint (protocol.ts), as the
 * MCP Inspector would send them. MCP Inspector itself is W12.M2's run on
 * the Mac. The vault is SYNTHETIC (a few notes written here).
 * @vitest-environment node
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import * as typesApi from "../types/api";
import { setTypesEngine } from "../../mcp-server/src/vault/types";
import { TOOLS } from "../../mcp-server/src/vault/tools";
import { configPath, enableClient } from "../../mcp-server/src/vault/config";
import { listPending, approvePending } from "../../mcp-server/src/vault/pending";
import { readLedger } from "../../mcp-server/src/vault/ledger";
import { runVaultCli } from "../../mcp-server/src/cli";
import { McpEndpoint, META } from "../../mcp-server/src/protocol";
import { VaultIndex } from "../../mcp-server/src/vault/search";

let vault: string;
let seq = 0;
const write = (rel: string, text: string) => {
  mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
  writeFileSync(path.join(vault, rel), text);
};
const notesOnDisk = () => {
  const out: string[] = [];
  const walk = (dir: string, rel = "") => {
    for (const n of readdirSync(dir, { withFileTypes: true })) {
      if (n.name === ".lumen") continue;
      const r = rel ? `${rel}/${n.name}` : n.name;
      if (n.isDirectory()) walk(path.join(dir, n.name), r);
      else out.push(r);
    }
  };
  walk(vault);
  return out.sort();
};

type Out = { text: string; isError: boolean };
async function call(name: string, args: Record<string, unknown>, client = "claude-code"): Promise<Out> {
  const ep = new McpEndpoint({ vault, index: new VaultIndex(vault) });
  const r = (await ep.handle({ jsonrpc: "2.0", id: ++seq, method: "tools/call", params: { name, arguments: args, _meta: { [META.protocolVersion]: "2026-07-28", [META.clientInfo]: { name: client, version: "1" }, [META.clientCapabilities]: {} } } })) as { result: { content?: { text: string }[]; isError?: boolean; resultType?: string } };
  // A queued proposal answers "input_required" (the 2026 protocol): the client waits for the user's decision.
  if (r.result.resultType === "input_required") return { text: "input_required", isError: false };
  return { text: (r.result.content ?? []).map((c) => c.text).join("\n"), isError: !!r.result.isError };
}
function cli(args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  return runVaultCli([...args, "--vault", vault], { out: (l) => out.push(l), err: (l) => err.push(l), env: {}, cwd: vault }).then((code) => ({ code, out, err }));
}
const setScope = (s: unknown) => {
  const cfg = JSON.parse(readFileSync(configPath(vault), "utf8"));
  cfg.scope = s;
  writeFileSync(configPath(vault), JSON.stringify(cfg));
};

beforeAll(() => setTypesEngine(typesApi));
beforeEach(async () => {
  vault = mkdtempSync(path.join(tmpdir(), "lumen-t4-"));
  write(".lumen/types/work.yaml", "label: { he: יצירה, en: Work }\nfields:\n  title: { type: text, pinned: true }\n  year: number\n");
  write(".lumen/types/book.yaml", "label: { he: ספר, en: Book }\nextends: work\nfields:\n  author: { type: relation, to: person }\n  status: { type: select, options: [to-read, done], default: to-read }\n  pages: number\n  ppu: { type: formula, formula: 'price / pages' }\n");
  write(".lumen/types/person.yaml", "label: { he: אדם, en: Person }\nfields:\n  born: date\n");
  write("people/Ada.md", "---\ntype: person\n---\n# Ada\n");
  write("books/Old.md", "---\ntype: book\n---\n# Old\n");
  write("journal/day.md", "# Day\n");
  await enableClient(vault, "claude-code", ["search", "read", "propose"]);
});
afterEach(() => rmSync(vault, { recursive: true, force: true }));

describe("the three tools (W12.T4)", () => {
  it("are listed with their scopes, before the Bases tools", () => {
    const names = TOOLS.map((t) => t.name);
    expect(names.slice(-5)).toEqual(["list_types", "get_type", "create_object", "bases_query", "bases_update"]);
    expect(Object.fromEntries(TOOLS.filter((t) => /type|object/.test(t.name)).map((t) => [t.name, t.scope]))).toEqual({ list_types: "read", get_type: "read", create_object: "propose" });
  });
  it("list_types returns the vault's types", async () => {
    const r = await call("list_types", {});
    expect(r.isError).toBe(false);
    const j = JSON.parse(r.text);
    expect(j.types.map((t: { id: string }) => t.id)).toEqual(["book", "person", "work"]);
    expect(j.types.find((t: { id: string }) => t.id === "book")).toMatchObject({ label: { he: "ספר", en: "Book" }, extends: "work", fields: 6 });
  });
  it("get_type returns the schema with inherited fields first, by id or Hebrew label", async () => {
    for (const name of ["book", "ספר"]) {
      const j = JSON.parse((await call("get_type", { type: name })).text);
      expect(j.chain).toEqual(["book", "work"]);
      expect(j.schema.map((f: { name: string }) => f.name)).toEqual(["title", "year", "author", "status", "pages", "ppu"]);
      expect(j.schema.find((f: { name: string }) => f.name === "title").from).toBe("work");
      expect(j.schema.find((f: { name: string }) => f.name === "ppu").computed).toBe(true);
    }
    expect((await call("get_type", { type: "magazine" })).isError).toBe(true);
  });
  it("a client without the read scope gets no types", async () => {
    await enableClient(vault, "cursor", ["search"]);
    const r = await call("list_types", {}, "cursor");
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/needs the 'read' scope/);
  });
});

describe("create_object: a schema error is not a write (W12.T4 acceptance 1)", () => {
  it.each([
    ["a field of the wrong kind", { pages: "many" }, /pages is a number/],
    ["an option not in the list", { status: "lost" }, /'lost' is not one of to-read, done/],
    ["a field the type does not have", { colour: "red" }, /no field 'colour'/],
    ["a relation that is not a link", { author: "Ada" }, /\[\[link\]\] to person/],
    ["a relation to a note of another type", { author: "[[Old]]" }, /books\/Old\.md is a book, not a person/],
  ])("%s: an error naming the field, nothing queued, the ledger says denied", async (_why, values, msg) => {
    const before = notesOnDisk();
    const r = await call("create_object", { type: "ספר", title: "Dune", values });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/does not fit the type's schema; nothing was proposed/);
    expect(r.text).toMatch(msg);
    expect(await listPending(vault)).toEqual([]);
    expect(notesOnDisk()).toEqual(before);
    const last = (await readLedger(vault, 50)).filter((e) => e.tool === "create_object").pop()!;
    expect(last.decision).toBe("denied");
    expect(last.reason).toMatch(/^schema: /);
  });
  it("a valid object is one proposal; nothing is written until the user approves", async () => {
    const r = await call("create_object", { type: "book", title: "Dune", values: { author: "[[Ada]]", pages: 412, year: 1965 } });
    expect(r).toEqual({ text: "input_required", isError: false });
    expect(existsSync(path.join(vault, "Dune.md"))).toBe(false);
    const [p] = await listPending(vault);
    expect(p).toMatchObject({ tool: "create_object", path: "Dune.md", before: null });
    expect(p.after).toMatch(/^---\ntype: book\ntitle:\nyear: 1965\nauthor: "\[\[Ada\]\]"\nstatus: to-read\npages: 412\n---\n\n# Dune\n$/);
    expect((await approvePending(vault, p.id, "user")).status).toBe("applied");
    expect(readFileSync(path.join(vault, "Dune.md"), "utf8")).toBe(p.after);
  });
  it("a link to a note that does not exist yet is allowed, as in Obsidian", async () => {
    expect((await call("create_object", { type: "book", title: "X", values: { author: "[[Nobody Yet]]" } })).isError).toBe(false);
  });
  it("an existing path is refused", async () => {
    const r = await call("create_object", { type: "book", path: "books/Old.md" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/already exists/);
  });
});

describe("create_object respects the W11.I7 scope and is logged (W12.T4 acceptance 2)", () => {
  it("a folder outside the allow list is refused, logged as denied, and nothing is queued", async () => {
    setScope({ allow: { folders: ["books"] } });
    const r = await call("create_object", { type: "book", path: "journal/Dune.md", values: { pages: 1 } });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/outside what this client may change/);
    expect(await listPending(vault)).toEqual([]);
    const last = (await readLedger(vault, 50)).filter((e) => e.tool === "create_object").pop()!;
    expect(last).toMatchObject({ decision: "denied", path: "journal/Dune.md" });
    expect(last.reason).toMatch(/scope/);
  });
  it("inside the allow list it is proposed", async () => {
    setScope({ allow: { folders: ["books"] } });
    expect((await call("create_object", { type: "book", path: "books/Dune.md" })).isError).toBe(false);
    expect((await listPending(vault)).map((p) => p.path)).toEqual(["books/Dune.md"]);
  });
  it("a denied tag in the body makes the new note out of scope", async () => {
    setScope({ deny: { tags: ["private"] } });
    const r = await call("create_object", { type: "book", title: "Secret", body: "#private\n" });
    expect(r.isError).toBe(true);
    expect(await listPending(vault)).toEqual([]);
  });
});

describe("lumen types and lumen new --type (W12.T4)", () => {
  it("lumen types lists the types; show prints the fields with where they came from", async () => {
    const r = await cli(["types"]);
    expect(r.code).toBe(0);
    expect(r.out.map((l) => l.split("\t")[0])).toEqual(["book", "person", "work"]);
    const s = await cli(["types", "show", "book"]);
    expect(s.out[0]).toBe("title\ttext\t(from work)");
    expect(s.out).toContain("author\trelation\t→ person");
    expect(JSON.parse((await cli(["types", "show", "ספר", "--json"])).out[0]).id).toBe("book");
  });
  it("lumen new --type writes a checked note (you are at your terminal)", async () => {
    const r = await cli(["new", "books/Dune.md", "--type", "book", "--set", "pages=412", "--set", "author=[[Ada]]"]);
    expect(r).toMatchObject({ code: 0, out: ["books/Dune.md"] });
    const text = readFileSync(path.join(vault, "books/Dune.md"), "utf8");
    expect(text).toMatch(/^---\ntype: book\n[\s\S]*pages: 412\n[\s\S]*---\n\n# Dune\n$/);
    expect(text).toContain('author: "[[Ada]]"');
  });
  it("lumen new --type with a wrong value writes nothing", async () => {
    const before = notesOnDisk();
    const r = await cli(["new", "Dune", "--type", "book", "--set", "pages=lots"]);
    expect(r.code).toBe(1);
    expect(r.err.join("\n")).toMatch(/nothing written[\s\S]*pages is a number/);
    expect(notesOnDisk()).toEqual(before);
  });
  it("plain lumen new is unchanged", async () => {
    expect((await cli(["new", "plain.md", "hello"])).code).toBe(0);
    expect(readFileSync(path.join(vault, "plain.md"), "utf8")).toBe("hello\n");
  });
});
