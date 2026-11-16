#!/usr/bin/env node
/**
 * A fixture MCP server over real stdio (plan W10.C1 tests): newline-delimited
 * JSON-RPC on stdin/stdout, logs on stderr, per the 2026-07-28 stdio binding.
 * SYNTHETIC: the tool shapes of server-everything / server-filesystem
 * (referenceServers.mjs), not the real servers.
 *
 *   node stdioMain.mjs everything
 *   node stdioMain.mjs filesystem <allowed folder>
 *   node stdioMain.mjs crash        (exits on its first request)
 *   node stdioMain.mjs silent       (reads, never answers)
 */
import { createInterface } from "node:readline";
import { everythingServer, filesystemServer } from "./referenceServers.mjs";

const [kind, ...rest] = process.argv.slice(2);
const log = (line) => process.stderr.write(`${line}\n`);
const srv = kind === "filesystem" ? filesystemServer(rest, { log }) : everythingServer({ log });
log(`fixture ${kind} started`);

const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    log("not JSON");
    return;
  }
  if (kind === "crash") {
    log("crashing");
    process.exit(3);
  }
  if (kind === "silent") return;
  if (msg.method === "notifications/cancelled") {
    log(`cancelled ${msg.params?.requestId}`);
    return;
  }
  const res = await srv.handle(msg);
  if (res) process.stdout.write(`${JSON.stringify(res)}\n`);
});
rl.on("close", () => {
  log("stdin closed, exiting");
  process.exit(0);
});
