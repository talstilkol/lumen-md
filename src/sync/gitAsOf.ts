/**
 * W12.S1 — the files of a cloned repository as of a date, from `git log`.
 *
 * A vault that is a git repo (see `gitWatch.ts`) has history from before
 * the app's own history store existed. The vault as of `date` is the tree
 * of the newest commit on HEAD committed at or before it. Only Markdown
 * text files are returned; binaries are skipped.
 */
import type { GitAsOfSource, GitVersion } from "../storage/asOf";

/** The subset of isomorphic-git this module uses. */
export interface GitLike {
  log(args: { fs: unknown; dir: string; ref?: string }): Promise<Array<{ oid: string; commit: { committer: { timestamp: number } } }>>;
  TREE(args: { ref: string }): unknown;
  walk(args: {
    fs: unknown;
    dir: string;
    trees: unknown[];
    map: (path: string, entries: Array<{ type(): Promise<string>; content(): Promise<Uint8Array | undefined> } | null>) => Promise<unknown>;
  }): Promise<unknown>;
}

const NOTE = /\.(md|markdown|mdx|txt)$/i;

/**
 * The newest commit at or before `date` (ms), and the oldest commit's time.
 * `log` is newest first, as isomorphic-git returns it.
 */
export function commitAsOf(
  log: ReadonlyArray<{ oid: string; commit: { committer: { timestamp: number } } }>,
  date: number,
): { oid: string; at: number } | null {
  for (const c of log) {
    const at = c.commit.committer.timestamp * 1000;
    if (at <= date) return { oid: c.oid, at };
  }
  return null;
}

/** Files of `repoFolder` (cloned at `/git/<repoFolder>`) as of a date. */
export async function gitFilesAsOf(rt: { fs: unknown; git: GitLike }, repoFolder: string, date: number): Promise<{ files: GitVersion[]; from: number | null }> {
  const { fs, git } = rt;
  const dir = `/git/${repoFolder}`;
  let log: Awaited<ReturnType<GitLike["log"]>>;
  try {
    log = await git.log({ fs, dir, ref: "HEAD" });
  } catch {
    return { files: [], from: null }; // no commits
  }
  const from = log.length ? log[log.length - 1].commit.committer.timestamp * 1000 : null;
  const hit = commitAsOf(log, date);
  if (!hit) return { files: [], from };
  const files: GitVersion[] = [];
  const dec = new TextDecoder();
  await git.walk({
    fs,
    dir,
    trees: [git.TREE({ ref: hit.oid })],
    map: async (path, [e]) => {
      if (path === ".") return undefined;
      if (!e) return null;
      const t = await e.type();
      if (t === "tree") return undefined;
      if (t !== "blob" || !NOTE.test(path)) return null;
      const bytes = await e.content();
      if (!bytes || bytes.subarray(0, 8000).includes(0)) return null;
      files.push({ name: `${repoFolder}/${path}`, content: dec.decode(bytes), timestamp: hit.at });
      return null;
    },
  });
  return { files, from };
}

/** A `vaultAsOf` git source for the cloned repositories (lazy: loads isomorphic-git only when used). */
export function gitAsOfSource(repoFolders: string[]): GitAsOfSource {
  return async (date) => {
    const { __gitRuntime } = await import("./git");
    const rt = (await __gitRuntime()) as { fs: unknown; git: GitLike };
    const files: GitVersion[] = [];
    let from: number | null = null;
    for (const r of repoFolders) {
      const got = await gitFilesAsOf(rt, r, date);
      files.push(...got.files);
      if (got.from !== null) from = from === null ? got.from : Math.min(from, got.from);
    }
    return { files, from };
  };
}
