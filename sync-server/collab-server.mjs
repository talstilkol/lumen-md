/**
 * Lumen persistent collab server on Hocuspocus (MIT) — plan 3.6.
 *
 * Replaces `persistent-server.js` (y-websocket + LevelDB). A room survives
 * every peer leaving: its Yjs state is stored in SQLite and loaded again
 * when someone rejoins. In end-to-end encrypted rooms (every new room) the
 * synced document is ciphertext, so that is all the server ever stores.
 *
 * ── Auth ──────────────────────────────────────────────────────────────────
 *   1. The client opens  ws(s)://<host>/token  and sends {room, key}.
 *      `key` is the operator's access key (COLLAB_ACCESS_KEY; the "Server
 *      access token" field in Collab settings). The server answers
 *      {token, expiresAt}: an HMAC-signed token for that one room, valid
 *      for COLLAB_TOKEN_TTL_S seconds (default 600). WebSocket, not HTTP,
 *      because the app's CSP allows ws:/wss: to any host but not https:.
 *   2. The Hocuspocus connection presents that token; `onAuthenticate`
 *      rejects a bad signature, another room's token or an expired one.
 *   The signing key (COLLAB_TOKEN_SECRET, ≥ 32 chars; random per process
 *   when unset) and the access key stay on the server. Nothing secret is
 *   built into the web app.
 *   Without COLLAB_ACCESS_KEY anyone who knows a room name gets a token —
 *   room names are 128-bit random, so the room name is then the capability.
 *
 * ── Roles and share links (plan W1.19, collab/sharing.mjs) ───────────────
 *   A token carries a role. "view" connections are read-only on both of a
 *   room's documents (`<room>` and `<room>~comments`), "comment" ones on the
 *   text, "edit" on neither. Read-only is the connection flag plus a second
 *   check on every message (`isDocumentWrite`): an update sent by hand is
 *   dropped with the connection. Share links (role, expiry, revocation) and
 *   the room's owner live in SQLite; every COLLAB_REVOKE_CHECK_MS (default
 *   1 s) connections bought with a revoked or expired link are closed.
 *
 * ── Sealed rooms (plan W2.20, collab/sealed.mjs) ─────────────────────────
 *   An end-to-end encrypted client asks for its token with `e2ee: true`;
 *   the room is then sealed for good: an update that writes anything but
 *   ciphertext envelopes, or a presence state that isn't sealed, is refused
 *   with its connection, and a document that isn't ciphertext-only is never
 *   stored. COLLAB_REQUIRE_E2EE=1 seals every room (a server for encrypted
 *   rooms only: plaintext clients can't write at all).
 *
 * ── Storage ───────────────────────────────────────────────────────────────
 *   COLLAB_DATA_DIR (default ./.collab-data): collab.sqlite plus backups/.
 *   A backup is taken every COLLAB_BACKUP_INTERVAL_MS (default 1 h) and on
 *   shutdown; the newest COLLAB_BACKUP_KEEP (default 24) are kept. A room
 *   deleted on request is taken out of all of them (see Deleting a room).
 *   Upgrading from persistent-server.js: rooms in the LevelDB directory
 *   COLLAB_LEGACY_LEVELDB_DIR (the Docker image sets /data/yjs) are imported
 *   once at start, never overwriting a room SQLite already has.
 *
 * ── Privacy (plan W4.8, PRIVACY.he.md) ───────────────────────────────────
 *   COLLAB_E2EE_ONLY=1   refuse every update that is not an encrypted
 *                        envelope (collab/relay.mjs, checkE2eeUpdate): the
 *                        connection is closed (4403) before the update is
 *                        applied, so the server only ever holds ciphertext.
 *                        The public server (edge-workers/collab) always does.
 *   COLLAB_RETENTION_DAYS  delete rooms nobody changed for this many days
 *                        (default 90; 0 keeps them). Swept at start and daily.
 *   Study rooms (havruta, plan W12.H3: names starting `havruta-`) are kept
 *   at most HAVRUTA_RETENTION_DAYS (30), whatever COLLAB_RETENTION_DAYS says.
 *
 * ── Deleting a room (plan W12.H3) ────────────────────────────────────────
 *   On the token socket, {action: "delete", room, token} deletes the room's
 *   documents, owner and share links and closes its connections, and
 *   {action: "exists", room, token} answers {status: 200 | 404}. `token` is
 *   a room token for that room (an edit token, not one bought with a share
 *   link), and `proof`, the room proof from the room's password, which the
 *   room's committed name (`<room>_k<commitment>`) must commit to, as on the
 *   public Worker (review Z7-L6). The token alone is not enough here: on this
 *   server anyone with the access key and the room's name gets an edit token
 *   for an unclaimed room. Because the room is stored under its base name,
 *   the first commitment a token was issued for is kept with the room
 *   (`commit:<room>` in meta) and a name that commits to another proof is
 *   refused, so only a participant who knows the password can delete it. The room is also taken out
 *   of every backup in backups/ right after the answer (each one rewritten
 *   with VACUUM when the disk has room for it), so no (ciphertext) copy
 *   waits there for the backups to rotate out. A backup that cannot be
 *   rewritten (busy, disk full, read-only) is kept as it was and the room is
 *   tried again with the next backup round; only a file SQLite says is not a
 *   database is removed (review Z7-M4). Backups copied elsewhere are the
 *   operator's to delete.
 *   Logs name no IP address.
 *
 * ── Health ────────────────────────────────────────────────────────────────
 *   GET /healthz → 200 {"ok":true,"service":"lumen-collab","persistence":"sqlite"}
 *
 *   node sync-server/collab-server.mjs        # PORT=4445 by default
 *   docker compose -f docker/collab.yml up
 */
import { Server } from "@hocuspocus/server";
import { WebSocketServer } from "ws";
import * as Y from "yjs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { openStore } from "./collab/sqliteStore.mjs";
import { importLegacyDir } from "./collab/legacyImport.mjs";
import { DEFAULT_TOKEN_TTL_S, adminCommitment, readRoomToken, signingKey } from "./collab/roomToken.mjs";
import { canWrite, handleTokenRequest, isDocumentWrite, parseDocumentName, shareState } from "./collab/sharing.mjs";
import { isSealedDocument, isSealedState, sealedMessageProblem } from "./collab/sealed.mjs";
import { checkE2eeUpdate, updateInMessage } from "./collab/relay.mjs";

/** W12.H3: study rooms (src/havruta) are named `havruta-<128 bits>` and kept at most 30 days. */
export const HAVRUTA_PREFIX = "havruta-";
export const HAVRUTA_RETENTION_DAYS = 30;

/**
 * Build (not start) a collab server. `listen()` resolves with the bound
 * port; `close()` stores pending documents, takes a backup and closes the
 * database.
 */
export function createCollabServer(opts = {}) {
  const {
    port = 4445,
    host,
    dataDir = resolve(".collab-data"),
    legacyLeveldbDir = "",
    accessKey = "",
    tokenSecret = "",
    tokenTtlS = DEFAULT_TOKEN_TTL_S,
    debounceMs = 2000,
    maxDebounceMs = 10_000,
    backupIntervalMs = 60 * 60 * 1000,
    keepBackups = 24,
    quiet = true,
    revokeCheckMs = 1000,
    requireE2ee = false,
    e2eeOnly = false,
    retentionDays = 90,
    log = () => {},
  } = opts;
  /** Live connections bought with a share link: closed when the link is revoked or expires. */
  const shared = new Set();
  const key = signingKey(tokenSecret);
  const store = openStore(dataDir, { keepBackups });
  const sealed = (room) => requireE2ee || store.isSealed(room);
  /** A room may be sealed while it stores no readable content (a new room, or one that was always encrypted). */
  /** The stored name of a document: its room's plain name (+ `~comments`). */
  const storedName = (documentName) => {
    const d = parseDocumentName(documentName);
    return d ? (d.kind === "comments" ? `${d.room}~comments` : d.room) : documentName;
  };
  const sealable = (room) =>
    [room, `${room}~comments`].every((name) => {
      const state = store.load(name);
      return !state || isSealedState(state, Y);
    });
  const tokenWss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  /** Rooms deleted on request: their open document is not stored again when it unloads (W12.H3). */
  const purged = new Set();

  /** Z7-L6: remember the commitment of a room's first committed name (see roomAdmin). */
  const bindCommitment = (req) => {
    const d = parseDocumentName(req.room);
    if (!d || store.getMeta(`commit:${d.room}`)) return;
    const commit = adminCommitment(req.room, req.proof, null);
    if (commit) store.setMeta(`commit:${d.room}`, commit);
  };

  /** W12.H3: `delete` / `exists` on the token socket, for a participant holding an edit token of the room. */
  const roomAdmin = (req) => {
    const d = parseDocumentName(req.room);
    if (!d || d.kind !== "text") return { error: "bad-room" };
    const claims = readRoomToken(key, req.token, d.room);
    if (!claims.ok) return { error: "unauthorized" };
    if (claims.share || claims.role !== "edit") return { error: "forbidden" };
    // Review Z7-L6: an edit token alone is not enough. On this server a token for an unclaimed room goes to anyone
    // with the access key and the room's name, so the request must also carry the room proof (from the room's
    // password) that its committed name commits to, as on the public Worker. The name's base is stored without
    // the commitment, so the first commitment this server issued a token for is bound to the base, and a name
    // that commits to another proof is refused.
    if (!adminCommitment(req.room, req.proof, store.getMeta(`commit:${d.room}`))) return { error: "commitment" };
    if (req.action === "exists") return { status: store.load(d.room) ? 200 : 404 };
    purged.add(d.room);
    for (const document of server.hocuspocus?.documents?.values?.() ?? []) {
      const r = parseDocumentName(document.name)?.room;
      if (r !== d.room) continue;
      for (const connection of document.getConnections?.() ?? []) {
        try {
          connection.close({ code: 4410, reason: "room-deleted" });
        } catch {
          /* already closed */
        }
      }
    }
    const had = store.deleteRoom(d.room);
    store.setMeta(`commit:${d.room}`, ""); // the name may be used again; its next first token binds it anew
    log(`room deleted on request${had ? "" : " (nothing was stored)"}`);
    // W12.H3 (coordinator decision): the room leaves the backups too, not only when they rotate out.
    purgeLater(d.room);
    return { deleted: true, status: 404 };
  };

  /**
   * Review Z7-M4: the backups are purged after the answer is sent, one room at a time (DatabaseSync blocks the
   * event loop while it rewrites a backup), and a room asked for twice is purged once. A backup that could not be
   * purged (busy, full disk, read-only) is kept, never deleted for it, and the room is tried again with the next
   * backup round. Only a file SQLite says is not a database is removed.
   */
  const purgeQueue = new Set();
  const purgeRetry = new Set();
  let purging = Promise.resolve();
  const purgeLater = (room) => {
    if (purgeQueue.has(room)) return purging;
    purgeQueue.add(room);
    purging = purging.then(
      () =>
        new Promise((done) =>
          setImmediate(() => {
            purgeQueue.delete(room);
            try {
              const r = store.purgeBackups(room);
              if (r.failed.length) purgeRetry.add(room);
              else purgeRetry.delete(room);
              log(
                `backups: room taken out of ${r.purged}${r.unvacuumed ? ` (${r.unvacuumed} without VACUUM: not enough free space)` : ""}` +
                  `${r.removed ? `; ${r.removed} backup(s) that are not databases removed` : ""}` +
                  `${r.failed.length ? `; ${r.failed.length} kept as they were and to be tried again: ${r.failed.join(", ")}` : ""}`,
              );
            } catch (e) {
              purgeRetry.add(room);
              log(`backups could not be read; the room will be taken out of them later: ${e instanceof Error ? e.message : String(e)}`);
            }
            done();
          }),
        ),
    );
    return purging;
  };

  tokenWss.on("connection", (ws) => {
    const done = (msg) => {
      try {
        ws.send(JSON.stringify(msg));
      } finally {
        ws.close(1000);
      }
    };
    const timer = setTimeout(() => ws.terminate(), 5000);
    ws.once("message", (raw) => {
      clearTimeout(timer);
      let req;
      try {
        req = JSON.parse(String(raw));
      } catch {
        return done({ error: "bad-request" });
      }
      let answer;
      try {
        answer =
          req && (req.action === "delete" || req.action === "exists")
            ? roomAdmin(req)
            : handleTokenRequest(req, { store, key, accessKey, tokenTtlS, requireE2ee, sealable });
        // Z7-L6: the first token issued for a committed name, with the proof it commits to, binds that commitment.
        if (answer?.token && req?.action !== "delete" && req?.action !== "exists") bindCommitment(req);
      } catch (e) {
        log(`token request failed: ${e instanceof Error ? e.message : String(e)}`);
        answer = { error: "server-error" };
      }
      done(answer);
    });
  });

  const server = new Server({
    port,
    ...(host ? { address: host } : {}),
    quiet,
    stopOnSignals: false,
    debounce: debounceMs,
    maxDebounce: maxDebounceMs,
    async onUpgrade({ request, socket, head }) {
      const pathname = (request.url || "/").split("?")[0];
      if (!pathname.endsWith("/token")) return; // also behind a path prefix (wss://host/collab/token)
      tokenWss.handleUpgrade(request, socket, head, (ws) => tokenWss.emit("connection", ws, request));
      // A falsy rejection stops Hocuspocus from handling this upgrade too.
      throw null;
    },
    async onRequest({ request, response }) {
      const pathname = (request.url || "/").split("?")[0];
      // Also behind a path prefix (wss://host/collab → /collab/healthz), like /token.
      if (!/\/health(z)?$/.test(pathname)) return;
      response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ ok: true, status: "ok", service: "lumen-collab", persistence: "sqlite" }));
      throw null;
    },
    async onAuthenticate(data) {
      const { token, documentName } = data;
      const doc = parseDocumentName(documentName);
      if (!doc) throw new Error("bad-room");
      const claims = readRoomToken(key, token, doc.room);
      if (!claims.ok) {
        log(`auth rejected (${claims.reason})`);
        throw new Error("unauthorized");
      }
      if (claims.share) {
        const s = store.getShare(claims.share);
        if (!s || s.room !== doc.room || shareState(s) !== "active") {
          log("auth rejected (share)");
          throw new Error("unauthorized");
        }
      }
      const writable = canWrite(claims.role, doc.kind);
      if (!writable && data.connectionConfig) data.connectionConfig.readOnly = true;
      // The context every later hook sees for this connection.
      return { role: claims.role, share: claims.share, kind: doc.kind, room: doc.room, writable };
    },
    async connected({ connection, context }) {
      if (context?.share && connection) shared.add({ connection, share: context.share });
    },
    async onDisconnect({ connection }) {
      for (const c of shared) if (c.connection === connection) shared.delete(c);
    },
    async beforeHandleMessage({ context, update, documentName, document }) {
      // Second guard after the read-only flag: a change sent by hand on a
      // connection that may not write ends that connection. First, so a
      // viewer's message never reaches the E2EE check (review of train 5, H2).
      if (context && context.writable === false && update && isDocumentWrite(update)) {
        log(`write refused (${context.role} on ${context.kind})`);
        throw new Error("read-only");
      }
      // COLLAB_E2EE_ONLY (plan W4.8): nothing but encrypted envelopes is ever applied.
      if (e2eeOnly && update) {
        const yjsUpdate = updateInMessage(update);
        const why = yjsUpdate ? checkE2eeUpdate(document, yjsUpdate) : null;
        if (why) {
          log(`update refused (e2ee-only: ${why})`);
          // A CloseEvent-like object: Hocuspocus closes the connection with it.
          throw { code: 4403, reason: `e2ee-only: ${why}` };
        }
      }
      // A sealed room takes ciphertext only (checked per message: a room
      // can be sealed while a connection is open).
      const room = context?.room ?? parseDocumentName(documentName)?.room;
      if (update && room && sealed(room)) {
        const problem = sealedMessageProblem(update, Y);
        if (problem) {
          log(`plaintext refused in a sealed room (${problem})`);
          throw new Error("sealed");
        }
      }
    },
    async onLoadDocument({ document, documentName }) {
      // The app now names a password room `<name>_k<commit>` (review 4 of #469). This
      // server reads that as `<name>` (sharing.mjs roomOf), so it is stored under the plain
      // name: rooms stored before are found there, and the seal check sees every copy.
      const state = store.load(storedName(documentName));
      if (state) Y.applyUpdate(document, state);
    },
    async onStoreDocument({ document, documentName }) {
      const room = parseDocumentName(documentName)?.room;
      // W12.H3: a room deleted on request is not written back when its document unloads.
      // Someone who joins it again afterwards starts a new room, which is stored as usual.
      if (room && purged.has(room)) {
        if ((document.getConnectionsCount?.() ?? 0) === 0) return;
        purged.delete(room);
      }
      // Belt and braces: a sealed room's readable content is never written to disk.
      if (room && sealed(room) && !isSealedDocument(document)) {
        log("store refused: a sealed room's document is not ciphertext-only");
        return;
      }
      store.save(storedName(documentName), Y.encodeStateAsUpdate(document));
    },
  });

  const backup = () => {
    // Z7-M4: rooms whose purge failed last time are tried again with every backup round.
    for (const room of [...purgeRetry]) void purgeLater(room);
    try {
      const file = store.backup();
      log(`backup ${file}`);
      return file;
    } catch (e) {
      log(`backup failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  };
  const backupTimer = backupIntervalMs > 0 ? setInterval(backup, backupIntervalMs) : null;
  backupTimer?.unref?.();

  /** Close every live connection whose share link was revoked or has expired. */
  const revokeSweep = () => {
    const now = Date.now();
    const live = new Map();
    const ended = (share) => {
      if (!live.has(share)) {
        const s = store.getShare(share);
        live.set(share, !!s && shareState(s, now) === "active");
      }
      return !live.get(share);
    };
    const close = (connection) => {
      try {
        connection.close({ code: 4403, reason: "share-ended" });
      } catch {
        /* already closed */
      }
    };
    // Every open document's connections (each carries its onAuthenticate context)…
    for (const document of server.hocuspocus?.documents?.values?.() ?? []) {
      for (const connection of document.getConnections?.() ?? []) {
        if (connection?.context?.share && ended(connection.context.share)) close(connection);
      }
    }
    // …and those recorded by the `connected` hook.
    for (const c of [...shared]) {
      if (!ended(c.share)) continue;
      shared.delete(c);
      close(c.connection);
    }
  };
  const revokeTimer = revokeCheckMs > 0 ? setInterval(revokeSweep, revokeCheckMs) : null;
  revokeTimer?.unref?.();

  /** Retention (plan W4.8): rooms not changed for `retentionDays` are deleted. */
  const sweep = (nowMs = Date.now()) => {
    const day = 24 * 60 * 60 * 1000;
    // W12.H3: study rooms are kept at most HAVRUTA_RETENTION_DAYS, even when retention is off.
    const studyDays = retentionDays > 0 ? Math.min(retentionDays, HAVRUTA_RETENTION_DAYS) : HAVRUTA_RETENTION_DAYS;
    const study = store.sweepPrefix(HAVRUTA_PREFIX, nowMs - studyDays * day);
    if (study) log(`retention: deleted ${study} study room(s) unchanged for ${studyDays} days`);
    if (!(retentionDays > 0)) return study;
    const n = store.sweep(nowMs - retentionDays * day);
    if (n) log(`retention: deleted ${n} room(s) unchanged for ${retentionDays} days`);
    return n + study;
  };
  const sweepTimer = setInterval(sweep, 24 * 60 * 60 * 1000);
  sweepTimer?.unref?.();

  let closing = null;
  return {
    server,
    store,
    backup,
    sweep,
    /** Queue the backup purge of a deleted room (roomAdmin does; exported for tests). */
    purgeLater,
    /** Resolves once every queued backup purge has run (tests, shutdown). */
    purgesDone: () => purging,
    async listen() {
      // Before accepting connections, so nobody opens an "empty" legacy room.
      if (legacyLeveldbDir) await importLegacyDir(store, legacyLeveldbDir, { log });
      sweep();
      await server.listen();
      return server.address.port;
    },
    close() {
      closing ??= (async () => {
        if (backupTimer) clearInterval(backupTimer);
        if (sweepTimer) clearInterval(sweepTimer);
        if (revokeTimer) clearInterval(revokeTimer);
        for (const c of tokenWss.clients) c.terminate();
        tokenWss.close();
        await server.destroy();
        await purging;
        backup();
        await purging;
        store.close();
      })();
      return closing;
    },
  };
}

function fromEnv(env) {
  const num = (v, d) => (v === undefined || v === "" ? d : Number(v));
  return {
    port: num(env.PORT, 4445),
    host: env.HOST || undefined,
    dataDir: resolve(env.COLLAB_DATA_DIR || ".collab-data"),
    // persistent-server.js used YJS_STORAGE_DIR / LEVELDB_PATH.
    legacyLeveldbDir: env.COLLAB_LEGACY_LEVELDB_DIR || env.YJS_STORAGE_DIR || env.LEVELDB_PATH || "",
    // COLLAB_TOKEN is the access key's older name (T49, persistent-server.js).
    accessKey: env.COLLAB_ACCESS_KEY || env.COLLAB_TOKEN || "",
    tokenSecret: env.COLLAB_TOKEN_SECRET || "",
    tokenTtlS: num(env.COLLAB_TOKEN_TTL_S, DEFAULT_TOKEN_TTL_S),
    debounceMs: num(env.COLLAB_DEBOUNCE_MS, 2000),
    backupIntervalMs: num(env.COLLAB_BACKUP_INTERVAL_MS, 60 * 60 * 1000),
    keepBackups: num(env.COLLAB_BACKUP_KEEP, 24),
    revokeCheckMs: num(env.COLLAB_REVOKE_CHECK_MS, 1000),
    requireE2ee: env.COLLAB_REQUIRE_E2EE === "1" || env.COLLAB_REQUIRE_E2EE === "true",
    e2eeOnly: env.COLLAB_E2EE_ONLY === "1",
    retentionDays: num(env.COLLAB_RETENTION_DAYS, 90),
    log: (m) => console.log(`[collab] ${m}`),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opts = fromEnv(process.env);
  const app = createCollabServer(opts);
  const port = await app.listen();
  console.log(`Lumen collab (Hocuspocus) listening on :${port}, data in ${opts.dataDir}`);
  if (!opts.accessKey) console.warn("COLLAB_ACCESS_KEY is not set: anyone who knows a room name can get a token for it.");
  if (!opts.tokenSecret) console.warn("COLLAB_TOKEN_SECRET is not set: a random key is used; tokens end with this process.");
  const stop = (signal) => {
    console.log(`${signal}: storing documents and taking a backup…`);
    app.close().then(
      () => process.exit(0),
      (e) => {
        console.error(e);
        process.exit(1);
      },
    );
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
}
