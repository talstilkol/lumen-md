/**
 * The lane-state watchers a test started (review 11, M2): find them by the
 * folder in their command line, and stop them, so none outlives its test.
 */
import { spawnSync } from "node:child_process";

/** Pids of `lane-state.mjs watch` processes whose command line mentions `under`. */
export function watchersUnder(under: string): number[] {
  const r = spawnSync("ps", ["-eo", "pid=,args="], { encoding: "utf8" });
  if (r.status !== 0) return [];
  return r.stdout
    .split("\n")
    .map((l) => l.trim().match(/^(\d+)\s+(.*)$/))
    .filter((m): m is RegExpMatchArray => !!m && /lane-state\.mjs watch /.test(m[2]) && m[2].includes(under) && !/^\S*\bps\b/.test(m[2]))
    .map((m) => Number(m[1]));
}

/** Stop every watcher started under these folders. */
export function killWatchersUnder(dirs: string[]): void {
  for (const d of dirs)
    for (const pid of watchersUnder(d)) {
      try {
        process.kill(pid);
      } catch {
        // why: it may have stopped on its own between ps and kill
      }
    }
}
