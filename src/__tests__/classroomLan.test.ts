// @vitest-environment node
/**
 * W5.21 on a school network (audit r2: "the 30-student simulation is
 * unit-level; no real classroom/school network test"). Here the relay is the
 * real server a school runs (`node sync-server/server.js` with
 * VAULT_RELAY_DIR: its own process, its own disk), reached over the
 * machine's network address rather than loopback when it has one, and the
 * whole class sits behind one address (a school NAT) — so the relay's
 * per-address limit (600 a minute by default, unchanged) is part of the
 * test. 30 students join and submit at once; the teacher reads all 30 and
 * comments; nobody reads anyone else's; nothing on the server's disk or on
 * the wire holds plaintext. The data is SYNTHETIC.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer, request, type Server } from "node:http";
import { networkInterfaces, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { createAssignment, fetchComments, fetchSubmissions, joinAssignment, sendComment, submit, type StudentAssignment } from "../sync/e2ee/classroom/classroom";
import { fromBase64Url } from "../sync/e2ee/classroom/link";
import { open } from "../sync/e2ee/classroom/seal";
import { relayProvider } from "../sync/e2ee/providers/relay";

const ROOT = resolve(__dirname, "..", "..");
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
/** The machine's first non-loopback IPv4 address (the "school LAN"), else loopback. */
const lanHost = Object.values(networkInterfaces()).flat().find((a) => a && a.family === "IPv4" && !a.internal)?.address ?? "127.0.0.1";

let relay: ChildProcess;
let dir: string;
let proxy: Server;
let origin: string;
const wire: Buffer[] = [];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "lumen-school-"));
  relay = spawn(process.execPath, [join(ROOT, "sync-server/server.js")], { env: { ...process.env, PORT: "0", VAULT_RELAY_DIR: dir }, stdio: ["ignore", "pipe", "pipe"] });
  const port = await new Promise<number>((ok, fail) => {
    const t = setTimeout(() => fail(new Error("relay did not start")), 15_000);
    relay.stdout!.on("data", (b: Buffer) => {
      const m = /ws:\/\/localhost:(\d+)/.exec(String(b));
      if (m) {
        clearTimeout(t);
        ok(Number(m[1]));
      }
    });
  });
  // A recording hop in front of it, as a school's network tap would see the traffic.
  proxy = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      wire.push(Buffer.from(`${req.method} ${req.url} ${JSON.stringify(req.headers)}`), body);
      const up = request({ host: lanHost, port, method: req.method, path: req.url, headers: { ...req.headers, host: `${lanHost}:${port}` } }, (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      });
      up.on("error", () => {
        res.writeHead(502);
        res.end();
      });
      up.end(body);
    });
  });
  await new Promise<void>((r) => proxy.listen(0, lanHost, () => r()));
  origin = `http://${lanHost}:${(proxy.address() as AddressInfo).port}`;
}, 30_000);

afterAll(async () => {
  relay?.kill("SIGTERM");
  await new Promise<void>((r) => proxy?.close(() => r()));
  rmSync(dir, { recursive: true, force: true });
});

function stored(): Buffer[] {
  const out: Buffer[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(readFileSync(p));
    }
  };
  walk(dir);
  return out;
}

const forms = (s: string) => [Buffer.from(s), Buffer.from(s, "utf16le"), Buffer.from(encodeURIComponent(s)), Buffer.from(Buffer.from(s).toString("base64").slice(0, -4))];
const leaks = (s: string, hay: Buffer[]) => hay.filter((h) => forms(s).some((f) => h.includes(f))).length;

describe("a class of 30 on a school network, the relay in its own process (W5.21)", () => {
  it("everyone at once behind one address: 30 submissions, 30 comments, 0 cross-reads, 0 plaintext on the wire or the server's disk", async () => {
    expect(relay.exitCode).toBeNull();
    const { assignment: teacher, link } = await createAssignment({ title: "בוחן בכיתה", template: "# בוחן", relay: origin });
    let students: StudentAssignment[] = await Promise.all(Array.from({ length: 30 }, (_, i) => joinAssignment(link, `תלמידה ${i + 1}`)));
    students = await Promise.all(students.map((s, i) => submit(s, `# בוחן\n\nתשובה פרטית ${i + 1} של הכיתה`)));

    const { submissions } = await fetchSubmissions(teacher);
    expect(submissions).toHaveLength(30);
    for (const [i, s] of students.entries()) expect(submissions.find((x) => x.student === s.pub)!.markdown).toContain(`תשובה פרטית ${i + 1} של הכיתה`);
    await Promise.all(submissions.map((sub) => sendComment(teacher, sub, `משוב אישי ל${sub.name}`)));

    // Every student tries every object on the server with their own key: only their own opens.
    const all = relayProvider({ url: origin, token: `a.${teacher.id}` });
    const names = await all.list();
    expect(names).toHaveLength(60);
    const boxes = await Promise.all(names.map(async (n) => (await all.get(n))!.data));
    let crossReads = 0;
    for (const s of students) {
      const me = { privateKey: s.key, publicRaw: fromBase64Url(s.pub) };
      let mine = 0;
      for (const data of boxes)
        for (const opts of [{ context: `sub|${s.id}` }, { context: `cmt|${s.id}`, sender: fromBase64Url(s.teacherKey) }]) {
          const text = await open(data, me, opts).then(dec, () => null);
          if (text === null) continue;
          if (text.includes(s.name) || text.includes(`תשובה פרטית ${students.indexOf(s) + 1} `)) mine++;
          else crossReads++;
        }
      expect(mine).toBeGreaterThanOrEqual(1);
      expect((await fetchComments(s)).map((c) => c.text)).toEqual([`משוב אישי ל${s.name}`]);
    }
    expect(crossReads).toBe(0);

    const hay = [...wire, ...stored()];
    expect(stored().length).toBeGreaterThan(0);
    for (let i = 1; i <= 30; i++) expect(leaks(`תשובה פרטית ${i} של הכיתה`, hay)).toBe(0);
    expect(leaks("תלמידה", hay)).toBe(0);
    expect(leaks("משוב אישי", hay)).toBe(0);
    expect(leaks("בוחן בכיתה", hay)).toBe(0);
    console.log(`[W5.21] relay pid ${relay.pid} on ${origin} (lan=${lanHost !== "127.0.0.1"}); ${wire.length / 2} requests, ${stored().length} objects on disk`);
  }, 120_000);
});
