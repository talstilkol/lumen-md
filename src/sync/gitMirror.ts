/**
 * Copy vault files into the git mirror (lightning-fs) before a commit
 * (plan 3.3), without ever forcing a shape change: where the mirror holds a
 * folder at a path the vault has as a file — or a file where the vault needs
 * a folder (a clone into an existing folder keeps the local shape) — that
 * path is skipped and reported, and neither side is deleted. The rest of the
 * commit goes ahead.
 */

/** The part of a promise-based fs the mirror uses (lightning-fs, node's fs.promises). */
export interface MirrorFs {
  promises: {
    writeFile: (path: string, data: Uint8Array) => Promise<unknown>;
    mkdir: (path: string) => Promise<unknown>;
    stat: (path: string) => Promise<{ isDirectory: () => boolean; isFile: () => boolean }>;
  };
}

async function kindAt(fs: MirrorFs, path: string): Promise<"file" | "directory" | null> {
  try {
    const st = await fs.promises.stat(path);
    return st.isDirectory() ? "directory" : "file";
  } catch {
    return null; // nothing there
  }
}

/**
 * Write `files` (paths relative to the repository) under `dir`. Returns the
 * relative paths skipped because the mirror has the other shape there.
 */
export async function writeIntoMirror(fs: MirrorFs, dir: string, files: Array<{ relative: string; bytes: Uint8Array }>): Promise<string[]> {
  const skipped: string[] = [];
  outer: for (const { relative, bytes } of files) {
    const parts = relative.split("/");
    let cur = dir;
    for (const part of parts.slice(0, -1)) {
      cur += `/${part}`;
      const kind = await kindAt(fs, cur);
      if (kind === "file") {
        skipped.push(relative);
        continue outer;
      }
      if (kind === null) await fs.promises.mkdir(cur);
    }
    const full = `${dir}/${relative}`;
    if ((await kindAt(fs, full)) === "directory") {
      skipped.push(relative);
      continue;
    }
    await fs.promises.writeFile(full, bytes);
  }
  return skipped;
}
