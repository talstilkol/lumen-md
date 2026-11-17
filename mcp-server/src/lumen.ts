#!/usr/bin/env node
/** The `lumen` command (bin of @lumen-md/mcp-server); see cli.ts. */
import { createInterface } from "node:readline/promises";
import { runVaultCli, VAULT_COMMANDS } from "./cli.js";
import { IPC_COMMANDS, runIpcCli } from "./ipc/client.js";
import { runHost } from "./ipc/serveCli.js";

// Approving needs a terminal (both ends a TTY), each diff on screen and a typed yes (review 21, B1).
// A terminal is not proof of a person: an agent can open a pty (review 24). See CliIO.tty.
const tty = !!process.stdin.isTTY && !!process.stdout.isTTY;
const ask = async (q: string) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(q);
  } finally {
    rl.close();
  }
};

const argv = process.argv.slice(2);
const io = { out: (l: string) => process.stdout.write(l + "\n"), err: (l: string) => process.stderr.write(l + "\n"), env: process.env, cwd: process.cwd() };
// W13.K1: the commands that talk to the running app; the W2.3 commands keep their names.
const run = (VAULT_COMMANDS as readonly string[]).includes(argv[0])
  ? runVaultCli(argv, { ...io, tty, ask })
  : argv[0] === "host"
    ? runHost(argv.slice(1), io)
    : IPC_COMMANDS.includes(argv[0]) || !argv.length
      ? runIpcCli(argv, { ...io, tty, ask })
      : runVaultCli(argv, { ...io, tty, ask });
run
  .then((code) => {
    // -1: `lumen mcp serve` keeps running.
    if (code >= 0) process.exit(code);
  })
  .catch((e) => {
    process.stderr.write(`error: ${(e as Error).message}\n`);
    process.exit(1);
  });
