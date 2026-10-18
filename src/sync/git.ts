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
import { getSecret, setSecret, initSecretStore, flushSecrets } from "../lib/secretStore";

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
  walk: (opts: Record<string, unknown>) => Promise<unknown>;
  TREE: (opts: { ref: string }) => unknown;
  WORKDIR: () => unknown;
  STAGE: () => unknown;
  resolveRef: (opts: Record<string, unknown>) => Promise<string>;
  isIgnored: (opts: Record<string, unknown>) => Promise<boolean>;
}

/** One side of a path in `git.walk` (the subset we use). */
interface WalkerEntry {
  type: () => Promise<"tree" | "blob" | "special" | "commit">;
  oid: () => Promise<string>;
  content: () => Promise<Uint8Array | undefined>;
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
      // LFS's default export is a class — its TS types declare the
      // constructor's `name` parameter as `string` but the value comes
      // through as a generic constructor. Cast through `unknown` to a
      // typed `new`-able to keep the call site honest.
      const FsCtor = LFS as unknown as new (name: string) => Fs;
      const fs = new FsCtor("lumen-git");
      return { fs, http: http.default ?? http, git: isoGit.default ?? isoGit };
    })();
  }
  return fsPromise;
}

const TOKEN_KEY = "lumen.git.token.v1";

export async function setGitToken(token: string | null): Promise<void> {
  await initSecretStore();
  setSecret(TOKEN_KEY, token || null);
  await flushSecrets();
}

export async function getGitToken(): Promise<string> {
  await initSecretStore();
  return getSecret(TOKEN_KEY) ?? "";
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
  const root = repoNameFromUrl(repoDir.replace(/^\/git\//, ""));
  await walk(repoDir, root);
  // Plan 2.7: a cloned repo's notes may be other authors' — agents treat the folder as outside content.
  (await import("../agents/provenance")).markUntrustedNote(root, "cloned from git");
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
  const all = await listWorkspace({ includeAssets: true, includeHidden: true });
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

/** Mirror the workspace copy of a repo (OPFS) into its lightning-fs checkout, so git sees the current edits. */
async function mirrorWorkspaceToGit(fs: Fs, dir: string, repoFolder: string, signal?: AbortSignal): Promise<void> {
  const all = await listWorkspace({ includeAssets: true, includeHidden: true });
  const prefix = `${repoFolder}/`;
  for (const f of all) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
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
  // Files deleted (or renamed away) in the workspace leave the checkout too, so
  // status and diffs show the deletion. Only when the listing really has this
  // repo's files: an empty or failed listing must never empty the checkout.
  const present = new Set(all.filter((f) => f.path.startsWith(prefix)).map((f) => f.path.slice(prefix.length)));
  if (!present.size || !fs.promises.unlink) return;
  const prune = async (rel: string): Promise<void> => {
    let names: string[] = [];
    try {
      names = await fs.promises.readdir(rel ? `${dir}/${rel}` : dir);
    } catch {
      return; // why: a folder that vanished meanwhile has nothing to prune
    }
    for (const name of names) {
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      if (!rel && name === ".git") continue;
      const path = rel ? `${rel}/${name}` : name;
      const st = await fs.promises.stat(`${dir}/${path}`).catch(() => null);
      if (st?.isDirectory()) await prune(path);
      else if (st?.isFile() && !present.has(path)) await fs.promises.unlink!(`${dir}/${path}`).catch(() => undefined);
    }
  };
  await prune("");
}

export async function gitStatus(repoFolder: string): Promise<GitStatusEntry[]> {
  const { fs, git } = await load();
  const dir = `/git/${repoFolder}`;
  // First mirror OPFS → lightning-fs so the status reflects current edits.
  await mirrorWorkspaceToGit(fs, dir, repoFolder);
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
  const beforeOpfs = await listWorkspace({ includeAssets: true, includeHidden: true });
  const opfsBefore = new Set(
    beforeOpfs
      .map((e) => e.path)
      .filter((p) => p === repoFolder || p.startsWith(`${repoFolder}/`)),
  );
  const seen = new Set<string>();
  const pulled: string[] = [];
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
          pulled.push(opfsPath);
          changed++;
        }
      }
    }
  }
  await walk(dir, repoFolder);
  // Plan 2.7: what a pull brings in may be another author's text.
  (await import("../agents/provenance")).markUntrustedNotes(pulled, "pulled from git");
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

/** Repositories cloned in this browser (the folders under `/git`, which are also their workspace folders). */
export async function listGitRepos(): Promise<string[]> {
  const { fs } = await load();
  try {
    return (await fs.promises.readdir("/git")).filter((n) => !n.startsWith(".")).sort();
  } catch {
    return [];
  }
}

export interface GitFileChange {
  /** Workspace path (`<repoFolder>/<path in the repo>`). */
  path: string;
  state: "added" | "modified" | "deleted";
  /** Content at HEAD (null: not in HEAD) — null as well for binary files. */
  before: string | null;
  /** Content in the working tree / the index (null: deleted) — null as well for binary files. */
  after: string | null;
  binary: boolean;
}

const decodeText = (bytes: Uint8Array | undefined): { text: string | null; binary: boolean } => {
  if (!bytes) return { text: null, binary: false };
  if (bytes.subarray(0, 8000).includes(0)) return { text: null, binary: true };
  return { text: new TextDecoder().decode(bytes), binary: false };
};

/**
 * The changed files of a repo with their content on both sides.
 *
 *   staged: false (default) — HEAD against the working tree: what the next
 *           `git.commit` would record (Lumen's commit stages everything);
 *           the workspace copy is mirrored into the checkout first.
 *   staged: true            — HEAD against the index (`git diff --staged`).
 *
 * `paths` (repo-relative files or folders) narrows the walk.
 */
export async function gitDiffEntries(
  repoFolder: string,
  opts: { staged?: boolean; paths?: string[]; signal?: AbortSignal } = {},
): Promise<GitFileChange[]> {
  const { fs, git } = await load();
  const dir = `/git/${repoFolder}`;
  const abort = () => {
    if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
  };
  if (!opts.staged) await mirrorWorkspaceToGit(fs, dir, repoFolder, opts.signal);
  abort();
  let hasHead = true;
  try {
    await git.resolveRef({ fs, dir, ref: "HEAD" });
  } catch {
    hasHead = false; // a repository without commits: everything is new
  }
  const paths = (opts.paths ?? []).map((p) => p.replace(/^\/+|\/+$/g, "")).filter(Boolean);
  const wanted = (filepath: string, isTree: boolean) =>
    !paths.length ||
    paths.some((p) => p === filepath || filepath.startsWith(`${p}/`) || (isTree && p.startsWith(`${filepath}/`)));
  const trees = [...(hasHead ? [git.TREE({ ref: "HEAD" })] : []), opts.staged ? git.STAGE() : git.WORKDIR()];
  const result = (await git.walk({
    fs,
    dir,
    trees,
    map: async (filepath: string, entries: Array<WalkerEntry | null>) => {
      abort();
      if (filepath === ".") return undefined;
      if (filepath === ".git" || filepath.startsWith(".git/")) return null;
      const [head, side] = hasHead ? entries : [null, entries[0]];
      const [ht, st] = await Promise.all([head?.type(), side?.type()]);
      if (ht === "commit" || st === "commit") return null; // submodule
      if (ht === "tree" || st === "tree") {
        if (!wanted(filepath, true)) return null;
        if (!head && !opts.staged && (await git.isIgnored({ fs, dir, filepath }))) return null;
        return undefined; // descend
      }
      if (!wanted(filepath, false)) return undefined;
      if (!head && !opts.staged && (await git.isIgnored({ fs, dir, filepath }))) return undefined;
      const [ho, so] = await Promise.all([head?.oid(), side?.oid()]);
      if (ho === so) return undefined;
      const before = decodeText(head ? await head.content() : undefined);
      const after = decodeText(side ? await side.content() : undefined);
      const change: GitFileChange = {
        path: `${repoFolder}/${filepath}`,
        state: !head ? "added" : !side ? "deleted" : "modified",
        before: before.text,
        after: after.text,
        binary: before.binary || after.binary,
      };
      return change;
    },
  })) as GitFileChange[] | undefined;
  abort();
  return (result ?? []).filter(Boolean).sort((a, b) => a.path.localeCompare(b.path));
}
