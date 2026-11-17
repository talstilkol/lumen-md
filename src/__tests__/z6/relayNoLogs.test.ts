// @vitest-environment node
/**
 * Review Z6-L5 (#927, decision 2.46 "no IP addresses in logs"): the guard in singleVaultRelay.test.ts is a text
 * check of one line of the collab Worker (`console.*(…cf-connecting-ip…)`), so `const ip = …; console.log(ip)`
 * passed it, and the vault-relay Worker was not checked at all. This one is structural:
 *
 *   1. it parses each Worker and every module it imports (relative `import`, `export … from`, `require`), and finds
 *      every use of `console` (any access, alias or destructuring), not a text pattern. The only uses allowed are
 *      outside the request path, named here with why;
 *   2. it runs the vault-relay Worker (as vaultRelayWorker.test.ts does) through accepted and refused requests
 *      with every console method spied on, and checks no call came and the client address is in no stored key
 *      or value.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import ts from "typescript";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
// @ts-expect-error — plain .mjs module without type declarations (#1304)
import worker, { VaultRelay } from "../../../edge-workers/vault-relay/worker.mjs";
import { FakeStorage, fakeState } from "../helpers/durableObject";

const ROOT = resolve(__dirname, "..", "..", "..");
const WORKERS = ["edge-workers/collab/worker.mjs", "edge-workers/vault-relay/worker.mjs"];
/**
 * `console` uses outside a Worker's request path: [file, enclosing function or block, why].
 * Anything else that touches `console` in a Worker's module graph fails.
 */
const ALLOWED: Array<[string, string, string]> = [
  ["sync-server/vault-relay.js", "function cidrList", "VAULT_RELAY_TRUST_PROXY parsing at start-up: names a configured proxy range, never a client"],
  ["sync-server/vault-relay.js", "if (require.main === module)", "the Node server's own start-up line (the port); the Worker never runs it"],
];

/** Every module a Worker loads from this repository (relative specifiers only; packages are not ours). */
function moduleGraph(entry: string): string[] {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const sf = ts.createSourceFile(file, readFileSync(join(ROOT, file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const specs: string[] = [];
    const walk = (n: ts.Node) => {
      if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) specs.push(n.moduleSpecifier.text);
      if (ts.isCallExpression(n) && n.arguments.length === 1 && ts.isStringLiteral(n.arguments[0]) && ((ts.isIdentifier(n.expression) && n.expression.text === "require") || n.expression.kind === ts.SyntaxKind.ImportKeyword)) specs.push(n.arguments[0].text);
      ts.forEachChild(n, walk);
    };
    walk(sf);
    for (const s of specs.filter((x) => x.startsWith("."))) {
      const base = join(dirname(file), s);
      const hit = [base, `${base}.mjs`, `${base}.js`, join(base, "index.mjs"), join(base, "index.js")].find((p) => existsSync(join(ROOT, p)));
      expect(hit, `${file} imports ${s}`).toBeTruthy();
      visit(relative(ROOT, join(ROOT, hit!)));
    }
  };
  visit(entry);
  return [...seen];
}

/** Every use of `console` in a source: its line and the nearest enclosing function or `if` it sits in. */
function consoleUses(file: string, text: string): Array<{ file: string; line: number; within: string }> {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const out: Array<{ file: string; line: number; within: string }> = [];
  const within = (n: ts.Node): string => {
    for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
      if (ts.isFunctionDeclaration(p) && p.name) return `function ${p.name.text}`;
      if (ts.isIfStatement(p) && /^require\.main\s*===\s*module$/.test(p.expression.getText(sf))) return "if (require.main === module)";
    }
    return "module";
  };
  const walk = (n: ts.Node) => {
    // `console` as a value: `console.x`, `console[x]`, `const c = console`, `{ log } = console`, `globalThis.console`.
    const isConsole = (ts.isIdentifier(n) && n.text === "console" && !(n.parent && ts.isPropertyAccessExpression(n.parent) && n.parent.name === n) && !(n.parent && ts.isPropertyAssignment(n.parent) && n.parent.name === n)) || (ts.isPropertyAccessExpression(n) && n.name.text === "console") || (ts.isElementAccessExpression(n) && ts.isStringLiteral(n.argumentExpression) && n.argumentExpression.text === "console");
    if (isConsole) out.push({ file, line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, within: within(n) });
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return out;
}

describe("no console in either relay Worker's request path (Z6-L5)", () => {
  it.each(WORKERS)("%s and every module it loads", (entry: string) => {
    const graph = moduleGraph(entry);
    expect(graph.length).toBeGreaterThan(1);
    const uses = graph.flatMap((f) => consoleUses(f, readFileSync(join(ROOT, f), "utf8")));
    const bad = uses.filter((u) => !ALLOWED.some(([f, w]) => f === u.file && w === u.within));
    expect(bad).toEqual([]);
  });

  it("finds what the old text check missed", () => {
    const leaks = [
      'const ip = request.headers.get("cf-connecting-ip");\nconsole.log(ip);',
      "const { warn } = console;\nwarn(request.headers.get('cf-connecting-ip'));",
      "const c = globalThis.console; c.info(addr);",
      'console["error"](\n  request.headers.get("cf-connecting-ip"),\n);',
    ];
    const old = /console\.(log|info|warn|error)\([^)]*(cf-connecting-ip|remoteAddress)/i;
    for (const src of leaks) {
      expect(consoleUses("x.mjs", `export default { async fetch(request) { ${src} } };`).length, src).toBeGreaterThan(0);
    }
    // The first three pass the old guard.
    expect(leaks.filter((s) => !old.test(s)).length).toBeGreaterThanOrEqual(3);
    // A key named console is not a use; any `.console` read counts (globalThis.console, self.console).
    expect(consoleUses("y.mjs", "const o = { console: 1 }; o.console;")).toHaveLength(1);
  });
});

describe("the vault-relay Worker, run: no console call, no client address stored (Z6-L5)", () => {
  afterEach(() => vi.restoreAllMocks());
  it("through stores, reads, lists, deletes, refusals and the alarm", async () => {
    const spies = (["log", "info", "warn", "error", "debug", "trace"] as const).map((m) => vi.spyOn(console, m));
    const storage = new FakeStorage();
    let obj: VaultRelay | null = null;
    const state = fakeState(storage);
    const env: Record<string, unknown> = {
      VAULT_RELAY_RATE: "5",
      RELAY: { idFromName: (n: string) => n, get: () => ({ fetch: async (r: Request) => ((obj ??= new VaultRelay(state, env)), await state.ready, obj.fetch(r)) }) },
    };
    const IP = "203.0.113.77";
    const tok = `tok-0001-${"x".repeat(32)}`;
    const call = (method: string, name: string, init: { body?: Uint8Array; auth?: string } = {}) =>
      (worker as { fetch(r: Request, e: unknown): Promise<Response> }).fetch(new Request(`https://relay.example.com/v1/vault/o/${name}`, { method, body: init.body as BodyInit | undefined, headers: { Authorization: init.auth ?? `Bearer ${tok}`, "cf-connecting-ip": IP } }), env);
    const statuses: number[] = [];
    for (const r of [
      await call("PUT", "a", { body: new Uint8Array(64).fill(1) }),
      await call("GET", "a"),
      await call("GET", ""),
      await call("GET", "missing"),
      await call("PUT", "a", { body: new Uint8Array(8), auth: "Bearer short" }),
      await call("DELETE", "a"),
      ...(await Promise.all(Array.from({ length: 8 }, () => call("GET", "a")))),
    ])
      statuses.push(r.status);
    await state.ready;
    await obj?.alarm();
    // Accepted and refused requests both ran (so the spies saw the request path), and the rate limit answered.
    expect(statuses).toContain(200);
    expect(statuses.some((s) => s >= 400)).toBe(true);
    for (const s of spies) expect(s, s.getMockName()).not.toHaveBeenCalled();
    expect(storage.data.size).toBeGreaterThan(0);
    const stored = JSON.stringify([...storage.data], (_k, v) => (v instanceof Uint8Array ? `bytes:${v.length}` : v));
    expect(stored).not.toContain(IP);
  });
});
