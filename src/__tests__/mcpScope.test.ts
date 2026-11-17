// @vitest-environment node
/**
 * Plan W11.I7 — the vault's MCP server in scope: allow / deny by folder and
 * tag apply to every tool, 20 hostile calls are refused without leaking a
 * word of a note out of scope, and every answer from a note carries an
 * anchor to its heading or line.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { McpEndpoint, META } from "../../mcp-server/src/protocol";
import { enableClient, readConfig, configPath } from "../../mcp-server/src/vault/config";
import { listPending } from "../../mcp-server/src/vault/pending";
import { readLedger } from "../../mcp-server/src/vault/ledger";
import { anchorAt, inScope, noteTags, readScope } from "../../mcp-server/src/vault/scope";

let vault: string;
let seq = 0;
const SECRETS = ["KIWI", "MANGO", "PAPAYA", "diary", "health", "inline"];
const write = (rel: string, text: string) => {
  mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
  writeFileSync(path.join(vault, rel), text);
};
type Out = { text: string; isError: boolean; anchors?: string[] };
async function call(ep: McpEndpoint, name: string, args: Record<string, unknown>, client = "claude-code"): Promise<Out> {
  const res = await ep.handle({ jsonrpc: "2.0", id: ++seq, method: "tools/call", params: { name, arguments: args, _meta: { [META.protocolVersion]: "2026-07-28", [META.clientInfo]: { name: client, version: "1" }, [META.clientCapabilities]: {} } } });
  if (!res || !("result" in res)) throw new Error(`tools/call ${name}: ${JSON.stringify(res)}`);
  const result = res.result as { content: { text: string }[]; isError?: boolean; _meta?: Record<string, unknown> };
  return { text: result.content.map((c) => c.text).join("\n"), isError: !!result.isError, anchors: result._meta?.["io.lumen/anchors"] as string[] | undefined };
}
const setScope = (vaultScope: unknown, clientScopes: Record<string, unknown> = {}) => {
  const cfg = JSON.parse(readFileSync(configPath(vault), "utf8"));
  cfg.scope = vaultScope;
  for (const [c, s] of Object.entries(clientScopes)) cfg.clients[c].scope = s;
  writeFileSync(configPath(vault), JSON.stringify(cfg));
};

beforeEach(async () => {
  vault = mkdtempSync(path.join(tmpdir(), "lumen-i7-"));
  write("work/plan.md", "---\ntags: [work]\n---\n# Plan\n\n## Budget\n\nThe budget is ready.\n");
  write("journal/diary.md", "# Diary\n\nmy thoughts KIWI\n");
  write("work/health.md", "---\ntags: [private/health]\n---\n# Results\n\nblood test MANGO\n");
  write("notes/inline.md", "# Inline\n\nA #private note PAPAYA\n");
  write("notes/public.md", "# Public\n\n## Ideas\n\nA shareable idea, see [[health]] and [[diary]] and [[plan]].\n\n```\n#private in code is not a tag\n```\n");
  await enableClient(vault, "claude-code", ["search", "read", "propose"]);
  await enableClient(vault, "cursor", ["search", "read"]);
  setScope({ deny: { folders: ["journal"], tags: ["private"] } });
});
afterEach(() => rmSync(vault, { recursive: true, force: true }));

describe("scope rules", () => {
  it("tags come from frontmatter and inline #tags, not code; a rule covers nested tags; deny wins over allow", () => {
    expect(noteTags("---\ntags: [a, B/c]\n---\nx #d and `#e`\n```\n#f\n```")).toEqual(["a", "b/c", "d"]);
    const rules = [readScope({ allow: { folders: ["work"], tags: ["shareable"] }, deny: { tags: ["private"] } })];
    expect(inScope("work/plan.md", "x", rules)).toBe(true);
    expect(inScope("notes/x.md", "#shareable", rules)).toBe(true);
    expect(inScope("notes/x.md", "nothing", rules)).toBe(false);
    expect(inScope("work/h.md", "#private/health", rules)).toBe(false);
    expect(inScope("Work/Plan.md", "x", rules)).toBe(true);
  });

  it("enable keeps a client's scope; malformed scope entries are dropped", async () => {
    setScope({ deny: { folders: ["journal", 3, ""] } }, { cursor: { allow: { folders: ["work"] } } });
    await enableClient(vault, "cursor", ["search"]);
    const cfg = await readConfig(vault);
    expect(cfg.scope).toEqual({ deny: { folders: ["journal"] } });
    expect(cfg.clients.cursor.scope).toEqual({ allow: { folders: ["work"] } });
  });
});

describe("20 hostile calls against notes out of scope", () => {
  const hostile: [string, Record<string, unknown>][] = [
    ["read_note", { path: "journal/diary.md" }],
    ["read_note", { path: "journal//diary.md" }],
    ["read_note", { path: "work/../journal/diary.md" }],
    ["read_note", { path: "work/health.md" }],
    ["read_note", { path: "notes/inline.md" }],
    ["search_notes", { query: "KIWI" }],
    ["search_notes", { query: "MANGO blood" }],
    ["search_notes", { query: "PAPAYA" }],
    ["list_notes", {}],
    ["list_tags", {}],
    ["get_backlinks", { path: "work/health.md" }],
    ["get_backlinks", { path: "journal/diary.md" }],
    ["write_note", { path: "journal/diary.md", content: "overwrite" }],
    ["append_note", { path: "work/health.md", content: "more" }],
    ["update_frontmatter", { path: "work/health.md", set: { tags: ["work"] } }],
    ["create_note", { path: "journal/new.md", content: "hello" }],
    ["create_note", { path: "notes/new.md", content: "a #private/x note" }],
    ["write_note", { path: "notes/public.md", content: "---\ntags: [private]\n---\nnow hidden" }],
    ["bases_query", { base: "journal/all.base" }],
    ["bases_update", { edits: [{ path: "work/health.md", set: { status: "x" } }] }],
  ];

  it("20/20 refused: no word of a hidden note, nothing proposed, and every refusal is in the ledger", async () => {
    expect(hostile).toHaveLength(20);
    const ep = new McpEndpoint({ vault });
    let refused = 0;
    for (const [tool, args] of hostile) {
      const r = await call(ep, tool, args);
      const leaked = SECRETS.filter((s) => r.text.includes(s) && !String(args.path ?? args.query ?? "").includes(s));
      expect(leaked, `${tool} ${JSON.stringify(args)} → ${r.text}`).toEqual([]);
      if (r.isError || tool === "search_notes" || tool === "list_notes" || tool === "list_tags" || tool === "get_backlinks") refused++;
    }
    expect(refused).toBe(20);
    expect(await listPending(vault)).toHaveLength(0);
    const denied = (await readLedger(vault, 500)).filter((e) => e.decision === "denied" && /scope/.test(e.reason ?? ""));
    expect(denied.length).toBeGreaterThanOrEqual(8);
    // list_tags shows the visible tags only.
    const tags = await call(ep, "list_tags", {});
    expect(tags.text).toContain("work");
    expect(tags.text).not.toMatch(/private/);
  });

  it("a hidden note answers like a missing one", async () => {
    const ep = new McpEndpoint({ vault });
    expect((await call(ep, "read_note", { path: "journal/diary.md" })).text).toBe((await call(ep, "read_note", { path: "journal/nothing.md" })).text.replace("nothing", "diary"));
  });

  it("a client's own allow list narrows further: cursor sees only work/, and not the private note in it", async () => {
    setScope({ deny: { folders: ["journal"], tags: ["private"] } }, { cursor: { allow: { folders: ["work"] } } });
    const ep = new McpEndpoint({ vault });
    expect((await call(ep, "list_notes", {}, "cursor")).text).toBe("work/plan.md");
    expect((await call(ep, "read_note", { path: "notes/public.md" }, "cursor")).isError).toBe(true);
    expect((await call(ep, "list_notes", {})).text.split("\n").sort()).toEqual(["notes/public.md", "work/plan.md"]);
  });
});

describe("citations: every answer from a note has an anchor", () => {
  it("search hits carry [[note#Heading]], read_note its headings, backlinks the line's heading", async () => {
    const ep = new McpEndpoint({ vault });
    const s = await call(ep, "search_notes", { query: "budget" });
    expect(s.text.split("\t")[3]).toBe("[[work/plan#Budget]]");
    expect(s.anchors).toEqual(["[[work/plan#Budget]]"]);
    const r = await call(ep, "read_note", { path: "work/plan.md" });
    expect(r.text).toBe("---\ntags: [work]\n---\n# Plan\n\n## Budget\n\nThe budget is ready.\n");
    expect(r.anchors).toEqual(["[[work/plan#Plan]]", "[[work/plan#Budget]]"]);
    const b = await call(ep, "get_backlinks", { path: "work/plan.md" });
    expect(b.text).toBe("notes/public.md");
    expect(b.anchors).toEqual(["[[notes/public#Ideas]]"]);
    expect(anchorAt("a.md", "no heading\nline two", 2)).toBe("[[a#L2]]");
  });
});
