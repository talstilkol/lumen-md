/**
 * Git sync via `isomorphic-git`.
 *
 * Strategy: keep the git working copy in a `lightning-fs` (IndexedDB) volume
 * mounted at `/git/<repo>`. After a clone we mirror the textual files into
 * OPFS under the same path so they show up in the workspace tree. Commit /
 * push pull the latest content back from OPFS into lightning-fs so users can
 * edit locally and push when ready.
 */
import { get, set } from "idb-keyval";
import {
  createWorkspaceFolder,
  deleteWorkspaceFile,
  listWorkspace,
  readWorkspaceFile,
  workspaceHasFile,
  writeWorkspaceBlob,
} from "../storage/workspace";

type Fs = {
  promises: {
    readFile: (path: string, opts?: unknown) => Promise<Uint8Array | string>;
    writeFile: (path: string, data: Uint8Array | string) => Promise<void>;
    mkdir: (path: string, opts?: unknown) => Promise<void>;
    readdir: (path: string) => Promise<string[]>;
    stat: (path: string) => Promise<{ isDirectory: () => boolean; isFile: () => boolean }>;
    unlink?: (path: string) => Promise<void>;
  };
};

/**
 * `git` exposes a wide surface — for our needs we use clone, commit, push,
 * pull, and addRemote. Defining a small structural type keeps us from having
 * to import the package's full type bundle eagerly.
 */
interface IsomorphicGit {
  clone: (opts: Record<string, unknown>) => Promise<void>;
  pull: (opts: Record<string, unknown>) => Promise<void>;
  push: (opts: Record<string, unknown>) => Promise<unknown>;
  add: (opts: Record<string, unknown>) => Promise<void>;
  commit: (opts: Record<string, unknown>) => Promise<string>;
  statusMatrix: (opts: Record<string, unknown>) => Promise<unknown[][]>;
  listFiles: (opts: Record<string, unknown>) => Promise<string[]>;
}

let fsPromise: Promise<{ fs: Fs; http: unknown; git: IsomorphicGit }> | null = null;

async function load() {
  if (!fsPromise) {
    fsPromise = (async () => {
      const [LFS, isoGit, http] = await Promise.all([
        import("@isomorphic-git/lightning-fs").then((m) => m.default),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        import("isomorphic-git") as Promise<any>,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        import("isomorphic-git/http/web") as Promise<any>,
      ]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fs = new (LFS as any)("lumen-git") as Fs;
      return { fs, http: http.default ?? http, git: isoGit.default ?? isoGit };
    })();
  }
  return fsPromise;
}

const TOKEN_KEY = "lumen.git.token.v1";

export async function setGitToken(token: string | null): Promise<void> {
  await set(TOKEN_KEY, token ?? "");
}

export async function getGitToken(): Promise<string> {
  const v = (await get(TOKEN_KEY)) as string | undefined;
  return typeof v === "string" ? v : "";
}

function repoNameFromUrl(url: string): string {
  const m = url.match(/[/:]([^/:]+?)(?:\.git)?\/?$/);
  return m?.[1] ?? "repo";
}

/** Mirror every text-like file from lightning-fs into OPFS under the same path. */
async function mirrorRepoToOPFS(repoDir: string, fs: Fs): Promise<number> {
  let count = 0;
  async function walk(dir: string, opfsPrefix: string) {
    const entries = await fs.promises.readdir(dir);
    for (const entry of entries) {
      if (entry === ".git") continue;
      const full = `${dir}/${entry}`;
      const stat = await fs.promises.stat(full);
      const opfsPath = opfsPrefix ? `${opfsPrefix}/${entry}` : entry;
      if (stat.isDirectory()) {
        await createWorkspaceFolder(opfsPath);
        await walk(full, opfsPath);
      } else if (stat.isFile()) {
        const bytes = (await fs.promises.readFile(full)) as Uint8Array;
        await writeWorkspaceBlob(opfsPath, bytes);
        count++;
      }
    }
  }
  await walk(repoDir, repoNameFromUrl(repoDir.replace(/^\/git\//, "")));
  return count;
}

export interface CloneResult {
  /** Workspace folder where the files were placed. */
  workspaceFolder: string;
  /** Number of files copied. */
  fileCount: number;
}

/** Clone a public git repo (or with a token) into both lightning-fs and OPFS. */
export async function cloneRepo(
  url: string,
  opts: { branch?: string; token?: string; depth?: number } = {},
): Promise<CloneResult> {
  const { fs, http, git } = await load();
  const name = repoNameFromUrl(url);
  const dir = `/git/${name}`;
  // Ensure parent and target dirs exist.
  try {
    await fs.promises.mkdir("/git");
  } catch {
    /* exists */
  }
  // Clean any prior contents under the same name to keep things deterministic.
  try {
    await fs.promises.mkdir(dir);
  } catch {
    /* exists */
  }

  const token = opts.token ?? (await getGitToken()) ?? "";
  if (!token) {
    throw new Error(
      "A GitHub token is required for cloning. Set one via: Git → Set Token in the command palette.",
    );
  }
  await git.clone({
    fs,
    http,
    dir,
    url,
    ref: opts.branch,
    depth: opts.depth ?? 1,
    singleBranch: true,
    onAuth: () => ({ username: token, password: "x-oauth-basic" }),
  });

  const fileCount = await mirrorRepoToOPFS(dir, fs);
  return { workspaceFolder: name, fileCount };
}

/**
 * Push every workspace file under `<repoFolder>/` back into the lightning-fs
 * checkout, commit, and push to origin. `repoFolder` must match a previous
 * clone target.
 */
export async function commitAndPush(
  repoFolder: string,
  message: string,
  author: { name: string; email: string },
  opts: { token?: string; branch?: string } = {},
): Promise<void> {
  const { fs, http, git } = await load();
  const dir = `/git/${repoFolder}`;
  // Mirror OPFS → lightning-fs (only files under the repo's prefix).
  const all = await listWorkspace({ includeAssets: true });
  const prefix = `${repoFolder}/`;
  const repoFiles = all.filter((f) => f.path.startsWith(prefix));
  for (const f of repoFiles) {
    const relative = f.path.slice(prefix.length);
    const full = `${dir}/${relative}`;
    // Make sure intermediate dirs exist.
    const parts = relative.split("/").slice(0, -1);
    let cur = dir;
    for (const part of parts) {
      cur += `/${part}`;
      try {
        await fs.promises.mkdir(cur);
      } catch {
        /* exists */
      }
    }
    const txt = await readWorkspaceFile(f.path).catch(() => null);
    if (txt !== null) {
      await fs.promises.writeFile(full, txt);
    }
  }
  // Stage everything and commit.
  await git.add({ fs, dir, filepath: "." });
  await git.commit({
    fs,
    dir,
    message,
    author: { name: author.name, email: author.email },
  });
  // Push.
  const token = opts.token ?? (await getGitToken()) ?? "";
  if (!token) {
    throw new Error(
      "Missing GitHub token. Set one via the command palette: Git → Set token.",
    );
  }
  await git.push({
    fs,
    http,
    dir,
    ref: opts.branch,
    onAuth: () => ({ username: token, password: "x-oauth-basic" }),
  });
}

export interface GitStatusEntry {
  path: string;
  state: "unmodified" | "modified" | "added" | "deleted";
}

export async function gitStatus(repoFolder: string): Promise<GitStatusEntry[]> {
  const { fs, git } = await load();
  const dir = `/git/${repoFolder}`;
  // First mirror OPFS → lightning-fs so the status reflects current edits.
  const all = await listWorkspace({ includeAssets: true });
  const prefix = `${repoFolder}/`;
  for (const f of all) {
    if (!f.path.startsWith(prefix)) continue;
    const relative = f.path.slice(prefix.length);
    const full = `${dir}/${relative}`;
    const parts = relative.split("/").slice(0, -1);
    let cur = dir;
    for (const part of parts) {
      cur += `/${part}`;
      try {
        await fs.promises.mkdir(cur);
      } catch {
        /* */
      }
    }
    const txt = await readWorkspaceFile(f.path).catch(() => null);
    if (txt !== null) await fs.promises.writeFile(full, txt);
  }
  const matrix = (await git.statusMatrix({ fs, dir })) as [
    string,
    number,
    number,
    number,
  ][];
  const out: GitStatusEntry[] = [];
  for (const [filepath, head, workdir] of matrix) {
    let state: GitStatusEntry["state"] = "unmodified";
    if (head === 0 && workdir === 2) state = "added";
    else if (head === 1 && workdir === 0) state = "deleted";
    else if (head === 1 && workdir === 2) state = "modified";
    out.push({ path: `${repoFolder}/${filepath}`, state });
  }
  return out;
}

/** Useful when the user wants to point Lumen at a specific identity. */
export interface GitIdentity {
  name: string;
  email: string;
}

const IDENTITY_KEY = "lumen.git.identity.v1";

export async function setGitIdentity(id: GitIdentity): Promise<void> {
  await set(IDENTITY_KEY, id);
}

export async function getGitIdentity(): Promise<GitIdentity> {
  const v = (await get(IDENTITY_KEY)) as GitIdentity | undefined;
  return v ?? { name: "Lumen User", email: "lumen@example.invalid" };
}

export interface PullResult {
  /** Number of files that changed in OPFS as a result of the pull. */
  changedFiles: number;
}

/**
 * Fetch + fast-forward merge from origin, then mirror the resulting working
 * tree back into OPFS. Files that disappeared upstream are removed from OPFS
 * (under the repo prefix only).
 */
export async function pullRepo(
  repoFolder: string,
  opts: { token?: string; branch?: string; author?: GitIdentity } = {},
): Promise<PullResult> {
  const { fs, http, git } = await load();
  const dir = `/git/${repoFolder}`;
  const token = opts.token ?? (await getGitToken()) ?? "";
  const author = opts.author ?? (await getGitIdentity());
  await git.pull({
    fs,
    http,
    dir,
    ref: opts.branch,
    singleBranch: true,
    fastForwardOnly: true,
    author: { name: author.name, email: author.email },
    onAuth: () =>
      token
        ? { username: token, password: "x-oauth-basic" }
        : ({} as never),
  });
  // Mirror the updated lightning-fs tree back into OPFS.
  const beforeOpfs = await listWorkspace({ includeAssets: true });
  const opfsBefore = new Set(
    beforeOpfs
      .map((e) => e.path)
      .filter((p) => p === repoFolder || p.startsWith(`${repoFolder}/`)),
  );
  const seen = new Set<string>();
  let changed = 0;
  async function walk(currentDir: string, opfsPrefix: string) {
    const entries = await fs.promises.readdir(currentDir);
    for (const entry of entries) {
      if (entry === ".git") continue;
      const full = `${currentDir}/${entry}`;
      const stat = await fs.promises.stat(full);
      const opfsPath = opfsPrefix ? `${opfsPrefix}/${entry}` : entry;
      seen.add(opfsPath);
      if (stat.isDirectory()) {
        await createWorkspaceFolder(opfsPath);
        await walk(full, opfsPath);
      } else if (stat.isFile()) {
        const bytes = (await fs.promises.readFile(full)) as Uint8Array;
        // Compare to existing OPFS contents to count real changes.
        let isDifferent = true;
        try {
          if (await workspaceHasFile(opfsPath)) {
            const existing = await readWorkspaceFile(opfsPath);
            const newText = new TextDecoder().decode(bytes);
            isDifferent = existing !== newText;
          }
        } catch {
          /* fall back to write */
        }
        if (isDifferent) {
          await writeWorkspaceBlob(opfsPath, bytes);
          changed++;
        }
      }
    }
  }
  await walk(dir, repoFolder);
  // Remove files that no longer exist upstream.
  for (const path of opfsBefore) {
    if (!seen.has(path)) {
      try {
        await deleteWorkspaceFile(path);
        changed++;
      } catch {
        /* ignore */
      }
    }
  }
  return { changedFiles: changed };
}

export interface GitStatusSummary {
  added: number;
  modified: number;
  deleted: number;
  entries: GitStatusEntry[];
}

export async function gitStatusSummary(
  repoFolder: string,
): Promise<GitStatusSummary> {
  const entries = await gitStatus(repoFolder);
  const summary: GitStatusSummary = {
    added: 0,
    modified: 0,
    deleted: 0,
    entries,
  };
  for (const e of entries) {
    if (e.state === "added") summary.added++;
    else if (e.state === "modified") summary.modified++;
    else if (e.state === "deleted") summary.deleted++;
  }
  return summary;
}
