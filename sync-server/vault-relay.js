/**
 * The encrypted vault relay (plan W4.19): a blob store for Lumen's encrypted
 * sync, for devices with no desktop sync folder and no WebDAV.
 *
 * What it holds: opaque objects that the app encrypted before sending them
 * (sealed with keys the relay never sees) under opaque names. What it knows:
 * the SHA-256 of each space's bearer token (the token itself is never kept),
 * object sizes and times. No accounts, no logs of addresses.
 *
 *   GET    /v1/vault/o/            → {"names": [...]}
 *   GET    /v1/vault/o/<name>      → bytes + ETag            (404 when none)
 *   PUT    /v1/vault/o/<name>      If-Match / If-None-Match: *   (412 lost race)
 *   DELETE /v1/vault/o/<name>
 *
 * Limits (env or options): VAULT_RELAY_MAX_OBJECT (25 MiB), VAULT_RELAY_MAX_SPACE
 * (1 GiB), VAULT_RELAY_RATE (600 requests per minute per address),
 * VAULT_RELAY_RETENTION_DAYS (180: a space untouched that long is deleted).
 * VAULT_RELAY_DIR keeps the objects on disk; without it they live in memory.
 *
 *   node vault-relay.js                       # standalone on $PORT (default 4446)
 *   require('./vault-relay').createVaultRelay({ dir })   # mounted (server.js)
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const http = require("http");

const PREFIX = "/v1/vault/o/";
const NAME = /^[A-Za-z0-9_.-]{1,64}$/;
const TOKEN = /^[A-Za-z0-9_-]{32,128}$/;

const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
const etagOf = (data) => `"${sha256(data).slice(0, 32)}"`;

function memoryStore() {
  const spaces = new Map();
  const space = (id) => {
    let s = spaces.get(id);
    if (!s) spaces.set(id, (s = { objects: new Map(), bytes: 0, touched: Date.now() }));
    return s;
  };
  return {
    async list(id) {
      return [...(spaces.get(id)?.objects.keys() ?? [])];
    },
    async get(id, name) {
      return spaces.get(id)?.objects.get(name) ?? null;
    },
    async put(id, name, data) {
      const s = space(id);
      const old = s.objects.get(name);
      s.bytes += data.length - (old ? old.data.length : 0);
      s.objects.set(name, { data, etag: etagOf(data) });
      s.touched = Date.now();
    },
    async delete(id, name) {
      const s = spaces.get(id);
      const old = s?.objects.get(name);
      if (!s || !old) return;
      s.bytes -= old.data.length;
      s.objects.delete(name);
      s.touched = Date.now();
    },
    async bytes(id) {
      return spaces.get(id)?.bytes ?? 0;
    },
    async sweep(olderThan) {
      let n = 0;
      for (const [id, s] of spaces) if (s.touched < olderThan) (spaces.delete(id), n++);
      return n;
    },
  };
}

function diskStore(dir) {
  const p = (id, name) => path.join(dir, id, name ?? "");
  const touch = async (id) => {
    const now = new Date();
    await fs.promises.utimes(p(id), now, now).catch(() => undefined);
  };
  return {
    async list(id) {
      return (await fs.promises.readdir(p(id)).catch(() => [])).filter((n) => NAME.test(n) && !n.endsWith(".tmp"));
    },
    async get(id, name) {
      const data = await fs.promises.readFile(p(id, name)).catch(() => null);
      return data ? { data, etag: etagOf(data) } : null;
    },
    async put(id, name, data) {
      await fs.promises.mkdir(p(id), { recursive: true });
      const tmp = p(id, `${name}.${crypto.randomBytes(4).toString("hex")}.tmp`);
      await fs.promises.writeFile(tmp, data);
      await fs.promises.rename(tmp, p(id, name));
      await touch(id);
    },
    async delete(id, name) {
      await fs.promises.unlink(p(id, name)).catch(() => undefined);
      await touch(id);
    },
    async bytes(id) {
      let n = 0;
      for (const name of await this.list(id)) n += (await fs.promises.stat(p(id, name)).catch(() => ({ size: 0 }))).size;
      return n;
    },
    async sweep(olderThan) {
      let n = 0;
      for (const id of await fs.promises.readdir(dir).catch(() => [])) {
        const st = await fs.promises.stat(p(id)).catch(() => null);
        if (st?.isDirectory() && st.mtimeMs < olderThan) (await fs.promises.rm(p(id), { recursive: true, force: true }), n++);
      }
      return n;
    },
  };
}

const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

function createVaultRelay(opts = {}) {
  const env = process.env;
  const maxObject = num(opts.maxObjectBytes ?? env.VAULT_RELAY_MAX_OBJECT, 25 * 1024 * 1024);
  const maxSpace = num(opts.maxSpaceBytes ?? env.VAULT_RELAY_MAX_SPACE, 1024 * 1024 * 1024);
  const rate = num(opts.ratePerMinute ?? env.VAULT_RELAY_RATE, 600);
  const retentionDays = num(opts.retentionDays ?? env.VAULT_RELAY_RETENTION_DAYS, 180);
  const dir = opts.dir ?? env.VAULT_RELAY_DIR;
  const store = opts.store ?? (dir ? diskStore(dir) : memoryStore());
  const hits = new Map();
  /** One write at a time per space, so a conditional PUT checks and writes as one step. */
  const locks = new Map();
  const exclusive = (space, fn) => {
    const run = (locks.get(space) || Promise.resolve()).then(fn, fn);
    const tail = run.catch(() => undefined);
    locks.set(space, tail);
    tail.then(() => locks.get(space) === tail && locks.delete(space));
    return run;
  };

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "ETag",
      "Cache-Control": "no-store",
      ...headers,
    });
    res.end(body);
  };
  const json = (res, status, obj) => send(res, status, JSON.stringify(obj), { "Content-Type": "application/json" });

  function limited(req) {
    const ip = req.socket?.remoteAddress || "?";
    const minute = Math.floor(Date.now() / 60000);
    const h = hits.get(ip);
    if (!h || h.minute !== minute) {
      hits.set(ip, { minute, n: 1 });
      if (hits.size > 50000) hits.clear();
      return false;
    }
    return ++h.n > rate;
  }

  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let n = 0;
      req.on("data", (c) => {
        n += c.length;
        if (n > limit) {
          reject(Object.assign(new Error("too large"), { status: 413 }));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
  }

  async function serve(req, res, pathname) {
    if (req.method === "OPTIONS") {
      return send(res, 204, "", {
        "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, If-Match, If-None-Match",
        "Access-Control-Max-Age": "600",
      });
    }
    if (limited(req)) return json(res, 429, { error: "slow down" });
    const auth = /^Bearer (\S+)$/.exec(req.headers.authorization || "");
    if (!auth || !TOKEN.test(auth[1])) return json(res, 401, { error: "token" });
    const space = sha256(`lumen-vault-relay v1|${auth[1]}`);
    const name = decodeURIComponent(pathname.slice(PREFIX.length));
    if (name === "") {
      if (req.method !== "GET") return json(res, 405, { error: "method" });
      return json(res, 200, { names: await store.list(space) });
    }
    if (!NAME.test(name)) return json(res, 400, { error: "name" });
    if (req.method === "GET") {
      const o = await store.get(space, name);
      return o ? send(res, 200, o.data, { "Content-Type": "application/octet-stream", ETag: o.etag }) : json(res, 404, { error: "none" });
    }
    if (req.method === "DELETE") {
      await exclusive(space, () => store.delete(space, name));
      return send(res, 204, "");
    }
    if (req.method !== "PUT") return json(res, 405, { error: "method" });
    const data = await readBody(req, maxObject);
    const verdict = await exclusive(space, async () => {
      const now = await store.get(space, name);
      const ifMatch = req.headers["if-match"];
      if (req.headers["if-none-match"] === "*" && now) return [412, "exists"];
      if (ifMatch && (!now || now.etag !== ifMatch)) return [412, "changed"];
      if ((await store.bytes(space)) - (now ? now.data.length : 0) + data.length > maxSpace) return [507, "space full"];
      await store.put(space, name, data);
      return null;
    });
    if (verdict) return json(res, verdict[0], { error: verdict[1] });
    return send(res, 201, "", { ETag: etagOf(data) });
  }

  const sweep = () => store.sweep(Date.now() - retentionDays * 86400000).catch(() => 0);
  const timer = opts.sweep === false ? null : setInterval(sweep, 3600000);
  timer?.unref?.();

  return {
    /** Handles `/v1/vault/…`; returns false for any other path. */
    handle(req, res) {
      const pathname = (req.url || "/").split("?")[0];
      if (!pathname.startsWith(PREFIX)) return false;
      serve(req, res, pathname).catch((e) => json(res, e.status || 500, { error: e.status ? e.message : "error" }));
      return true;
    },
    sweep,
    close() {
      if (timer) clearInterval(timer);
    },
  };
}

module.exports = { createVaultRelay, memoryStore, diskStore };

if (require.main === module) {
  const relay = createVaultRelay();
  const server = http.createServer((req, res) => {
    if (relay.handle(req, res)) return;
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end('{"error":"not found"}');
  });
  server.listen(num(process.env.PORT, 4446), () => console.log(`vault relay on :${server.address().port}`));
}
