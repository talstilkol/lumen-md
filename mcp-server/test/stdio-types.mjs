#!/usr/bin/env node
/**
 * Plan W12.T4, acceptance 1 and 2, from OUTSIDE the server: a separate
 * process speaks raw JSON-RPC lines to the built server over stdio, the way
 * an external agent (or MCP Inspector, which is the Mac run W11.M6/W12.M2)
 * does. No SDK, so it runs from `dist/` alone:
 *   npm run build && node test/stdio-types.mjs
 *   LUMEN_MCP_DIST=<dir> node test/stdio-types.mjs   (a dist built elsewhere)
 *
 * 1. tools/list carries list_types, get_type and create_object.
 * 2. create_object for a ספר with a wrong field answers a schema error: no
 *    proposal, no file, and the ledger row says denied (schema: …).
 * 3. create_object into a folder outside the client's scope is refused and
 *    logged as denied (scope); nothing is queued.
 * 4. A valid ספר is a proposal only; the note is on disk after approval.
 * 5. The same over the 2026-07-28 protocol: a schema error is a tool error,
 *    never input_required.
 * Exits non-zero on any failure.
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = process.env.LUMEN_MCP_DIST ? path.resolve(process.env.LUMEN_MCP_DIST) : path.join(here, "../dist");
const { enableClient, configPath } = await import(path.join(dist, "vault/config.js"));
const { approvePending, listPending } = await import(path.join(dist, "vault/pending.js"));
const { readLedger } = await import(path.join(dist, "vault/ledger.js"));

let failed = 0;
const check = (ok, msg) => {
  if (!ok) {
    failed++;
    console.error(`FAIL ${msg}`);
  } else console.log(`ok   ${msg}`);
};

const vault = mkdtempSync(path.join(tmpdir(), "lumen-stdio-types-"));
const put = (rel, text) => {
  mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true });
  writeFileSync(path.join(vault, rel), text);
};
const notesOnDisk = () => {
  const out = [];
  const walk = (dir, rel = "") => {
    for (const n of readdirSync(dir, { withFileTypes: true })) {
      if (n.name === ".lumen") continue;
      const r = rel ? `${rel}/${n.name}` : n.name;
      if (n.isDirectory()) walk(path.join(dir, n.name), r);
      else out.push(r);
    }
  };
  walk(vault);
  return out.sort().join(",");
};
put(".lumen/types/work.yaml", "label: { he: יצירה, en: Work }\nfields:\n  title: { type: text, pinned: true }\n  year: number\n");
put(".lumen/types/book.yaml", "label: { he: ספר, en: Book }\nextends: work\nfields:\n  author: { type: relation, to: person }\n  status: { type: select, options: [to-read, done], default: to-read }\n  pages: number\n");
put(".lumen/types/person.yaml", "label: { he: אדם, en: Person }\nfields:\n  born: date\n");
put("people/Ada.md", "---\ntype: person\n---\n# Ada\n");
put("journal/day.md", "# Day\n");

function start(client) {
  const child = spawn(process.execPath, [path.join(dist, "index.js"), "--vault", vault, "--client", client], { stdio: ["pipe", "pipe", "pipe"] });
  const waiting = new Map();
  createInterface({ input: child.stdout }).on("line", (line) => {
    const msg = JSON.parse(line);
    const w = waiting.get(msg.id);
    if (w) {
      waiting.delete(msg.id);
      w(msg);
    }
  });
  let id = 0;
  const send = (method, params) =>
    new Promise((resolve) => {
      const rid = ++id;
      waiting.set(rid, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: rid, method, params }) + "\n");
    });
  return { child, send };
}
const text = (r) => (r.result?.content ?? []).map((c) => c.text).join("\n");
const lastLedger = async (tool) => (await readLedger(vault, 200)).filter((e) => e.tool === tool).pop();

try {
  await enableClient(vault, "inspector", ["search", "read", "propose"]);

  // An Inspector-style session: legacy initialize, then plain calls.
  const s = start("inspector");
  const init = await s.send("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "inspector", version: "1" } });
  check(init.result?.protocolVersion === "2025-11-25", "initialize");
  const l = await s.send("tools/list", {});
  const names = (l.result?.tools ?? []).map((t) => t.name);
  check(["list_types", "get_type", "create_object"].every((n) => names.includes(n)), "tools/list carries list_types, get_type, create_object");
  const create = l.result?.tools?.find((t) => t.name === "create_object");
  check(create?.inputSchema?.required?.includes("type"), "create_object declares a required type");

  const lt = await s.send("tools/call", { name: "list_types", arguments: {} });
  check(!lt.result?.isError && text(lt).includes("ספר"), "list_types names ספר (Hebrew intact over stdio)");
  const gt = await s.send("tools/call", { name: "get_type", arguments: { type: "ספר" } });
  check(!gt.result?.isError && /pages/.test(text(gt)) && /title/.test(text(gt)), "get_type ספר has its own and inherited fields");

  const cases = [
    ["a number field given a word", { pages: "many" }, /pages is a number/],
    ["an option not in the list", { status: "lost" }, /'lost' is not one of to-read, done/],
    ["a field the type does not have", { colour: "red" }, /no field 'colour'/],
    ["a relation that is not a link", { author: "Ada" }, /\[\[link\]\] to person/],
  ];
  for (const [why, values, msg] of cases) {
    const before = notesOnDisk();
    const r = await s.send("tools/call", { name: "create_object", arguments: { type: "ספר", title: "Dune", values } });
    check(r.result?.isError === true && /does not fit the type's schema; nothing was proposed/.test(text(r)) && msg.test(text(r)), `${why}: a schema error naming the field`);
    check((await listPending(vault)).length === 0 && notesOnDisk() === before, `${why}: nothing queued, nothing on disk`);
    const e = await lastLedger("create_object");
    check(e?.decision === "denied" && /^schema: /.test(e.reason ?? "") && e.client === "inspector", `${why}: the ledger says denied (schema)`);
  }

  // Scope: only books/ may be changed by this client.
  const cfg = JSON.parse(readFileSync(configPath(vault), "utf8"));
  cfg.scope = { allow: { folders: ["books"] } };
  writeFileSync(configPath(vault), JSON.stringify(cfg));
  const out = await s.send("tools/call", { name: "create_object", arguments: { type: "book", path: "journal/Dune.md", values: { pages: 1 } } });
  check(out.result?.isError === true && /outside what this client may change/.test(text(out)), "a folder outside the scope is refused");
  check((await listPending(vault)).length === 0 && !existsSync(path.join(vault, "journal/Dune.md")), "out of scope: nothing queued, nothing on disk");
  const se = await lastLedger("create_object");
  check(se?.decision === "denied" && se.path === "journal/Dune.md" && /scope/.test(se.reason ?? ""), "out of scope: the ledger says denied (scope)");

  const ok = await s.send("tools/call", { name: "create_object", arguments: { type: "ספר", path: "books/Dune.md", values: { author: "[[Ada]]", pages: 412 } } });
  check(!ok.result?.isError, "a valid ספר inside the scope is accepted");
  check(!existsSync(path.join(vault, "books/Dune.md")), "a valid ספר is not written before approval");
  const [p] = await listPending(vault);
  check(p?.tool === "create_object" && p.path === "books/Dune.md", "it is one proposal");
  if (p) {
    check((await approvePending(vault, p.id, "user")).status === "applied", "the user approves it");
    const onDisk = existsSync(path.join(vault, "books/Dune.md")) ? readFileSync(path.join(vault, "books/Dune.md"), "utf8") : "";
    check(onDisk === p.after && /^---\ntype: book\n/.test(onDisk) && /pages: 412\n/.test(onDisk), "the approved note is exactly the proposal, fields in frontmatter");
  }
  s.child.stdin.end();

  // The 2026-07-28 protocol: a schema error must not turn into input_required.
  const m = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientInfo": { name: "inspector", version: "1" }, "io.modelcontextprotocol/clientCapabilities": {} };
  const s2 = start("inspector");
  const bad = await s2.send("tools/call", { name: "create_object", arguments: { type: "book", path: "books/Bad.md", values: { pages: "many" } }, _meta: m });
  check(bad.result?.resultType !== "input_required" && bad.result?.isError === true && /pages is a number/.test(text(bad)), "2026-07-28: a schema error is a tool error, not input_required");
  check(!existsSync(path.join(vault, "books/Bad.md")) && (await listPending(vault)).length === 0, "2026-07-28: nothing queued, nothing on disk");
  s2.child.stdin.end();
} finally {
  rmSync(vault, { recursive: true, force: true });
}
if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log("stdio types (W12.T4): all passed");
