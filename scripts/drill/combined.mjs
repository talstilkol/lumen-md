/**
 * The combined data-safety scenario (plan W4.33, W10.E40): everything at
 * once on one vault, then a crash.
 *
 *   - two app windows edit the same notes: the atomic save path and the
 *     OPFS backend's (opfs-sync), each in its own process;
 *   - a sync client writes the same notes the way such programs do
 *     (temporary file, rename);
 *   - a git pull runs through the app's own pull (src/sync/gitPull.ts
 *     integrateFetched, isomorphic-git on the folder's real repository,
 *     every vault write through atomic.ts) and brings new versions of the
 *     tracked notes;
 *   - at a random moment every one of those processes gets SIGKILL.
 *
 * Then the app recovers the folder (atomic recoverDir, a fresh OPFS
 * backend's listing) and every note is checked: no note damaged, none
 * missing, no save leftover; each tracked note is whole and either the
 * version before the pull or the pulled one.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The notes the git pull brings (tracked in notes/); the other notes stay untracked, as a vault's usually are. */
export const TRACKED = ["notes/g0.md", "notes/g1.md", "notes/g2.md", "notes/g3.md"];

const git = (cwd, ...a) => execFileSync("git", ["-c", "user.name=drill", "-c", "user.email=drill@example.invalid", "-c", "init.defaultBranch=main", ...a], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** notes/ as a clone of a bare remote, with the tracked notes at version 1 and version 2 pushed from elsewhere. */
export function gitFixture(root, version) {
  const remote = mkdtempSync(join(tmpdir(), "drill-remote-"));
  const other = mkdtempSync(join(tmpdir(), "drill-other-"));
  git(remote, "init", "-q", "--bare");
  const notes = join(root, "notes");
  git(notes, "init", "-q");
  for (const p of TRACKED) writeFileSync(join(root, p), version(1, `pulled note ${p}, before`));
  git(notes, "add", ...TRACKED.map((p) => p.slice("notes/".length)));
  git(notes, "commit", "-q", "-m", "before");
  git(notes, "remote", "add", "origin", remote);
  git(notes, "push", "-q", "origin", "HEAD:main");
  git(other, "clone", "-q", remote, ".");
  for (const p of TRACKED) writeFileSync(join(other, p.slice("notes/".length)), version(2, `pulled note ${p}, after; `.repeat(200)));
  git(other, "commit", "-q", "-am", "after");
  git(other, "push", "-q", "origin", "HEAD:main");
  git(notes, "fetch", "-q", "origin");
  return { theirs: git(notes, "rev-parse", "origin/main"), cleanup: () => (rmSync(remote, { recursive: true, force: true }), rmSync(other, { recursive: true, force: true })) };
}

/** The pulling process: the app's integrateFetched on notes/, writes through atomic.ts. Resolves when the pull ended. */
export async function pullChild({ root, theirs, gitPull, atomic, atomicFs }) {
  const isogit = await import("isomorphic-git");
  const fs = await import("node:fs");
  const vaultFs = atomicFs(root);
  const at = (p) => join(root, ...p.split("/"));
  return gitPull.integrateFetched({
    git: isogit.default ?? isogit,
    fs,
    dir: join(root, "notes"),
    repoFolder: "notes",
    theirs,
    author: { name: "drill", email: "drill@example.invalid" },
    vault: {
      read: async (p) => {
        try {
          return new Uint8Array(fs.readFileSync(at(p)));
        } catch (e) {
          if (e.code === "ENOENT") return null;
          throw e;
        }
      },
      write: (p, data) => atomic.atomicWrite(vaultFs, p, data),
      exists: async (p) => fs.existsSync(at(p)),
      kind: async (p) => (fs.existsSync(at(p)) ? (fs.statSync(at(p)).isDirectory() ? "directory" : "file") : null),
    },
    openNote: () => null,
  });
}

/** Can this checkout run the pull here? (isomorphic-git is an app dependency; offline it may be missing.) */
export async function pullAvailable() {
  try {
    await import("isomorphic-git");
    return null;
  } catch {
    return "isomorphic-git is not installed here";
  }
}

/**
 * `rounds` combined rounds. `d` is the drill's toolkit: { paths, startChild,
 * killGroup, newFolder, seed, audit, newTally, version, check, SELF }.
 */
export async function drillCombined(d, rounds) {
  const t = { ...d.newTally(), pulls: 0, pullSkipped: await pullAvailable(), trackedDamaged: 0, trackedOther: 0, trackedMissing: 0 };
  const atomic = d.paths.find((p) => p.name === "atomic");
  const opfs = d.paths.find((p) => p.name === "opfs-sync");
  if (!atomic || !opfs) return { ...t, skipped: "needs the atomic and opfs-sync paths" };
  for (let round = 0; round < rounds; round++) {
    const root = await d.newFolder();
    const store = atomic.open(root);
    const state = new Map();
    await d.seed(root, store, state);
    const fixture = gitFixture(root, d.version);
    const base = (round + 1) * 10_000_000;
    const procs = [
      d.startChild(["--child", d.work, "atomic", root, String(base), "strict"]),
      d.startChild(["--child", d.work, "opfs-sync", root, String(base + 3_000_000), "strict"]),
      d.startChild(["--external", root, String(base + 6_000_000)]),
    ];
    if (!t.pullSkipped) procs.push(d.startChild(["--pull", d.work, root, fixture.theirs]));
    await Promise.all(procs.map((p) => p.ready));
    await new Promise((r) => setTimeout(r, 30 + Math.random() * 400));
    for (const p of procs) d.killGroup(p.child);
    await Promise.all(procs.map((p) => p.exited));
    for (const name of d.listAll(root)) if (name.includes(".ext~")) rmSync(name);
    // Recovery as the app does it on the next start: both backends over the folder.
    await opfs.open(root).recover();
    const before = t.older;
    await d.audit(root, store, state, t);
    t.older = before; // several writers: the newest on disk can be any of theirs
    for (const p of TRACKED) {
      let bytes;
      try {
        bytes = readFileSync(join(root, ...p.split("/")));
      } catch {
        t.trackedMissing++;
        continue;
      }
      const v = d.check(bytes);
      if (v === null) t.trackedDamaged++;
      else if (v !== 1 && v !== 2) t.trackedOther++;
      else if (v === 2) t.pulls++;
    }
    fixture.cleanup();
    rmSync(root, { recursive: true, force: true });
    t.rounds++;
  }
  return t;
}
