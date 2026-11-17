/**
 * W12.S1: the loader behind "What I knew then" (src/ui/AsOfDialog.tsx).
 *
 * The history store only knows what was saved since Lumen was installed.
 * When the vault holds git repositories cloned in the app (src/sync/git,
 * folders under /git), their log reaches further back: `vaultAsOf` takes it
 * as a second source (sync/gitAsOf.ts), and the dialog's "history from …"
 * line moves to the oldest commit. The plumbing was there; the dialog called
 * `vaultAsOf(date)` without it, so the git half never ran in the app.
 *
 * The repositories are listed once per dialog, and isomorphic-git loads only
 * when there is one. A failure to list them (no git storage, a private
 * window) is "no git", never an error in the dialog.
 */
import { vaultAsOf, type AsOfVault, type GitAsOfSource } from "./asOf";

export interface AsOfLoadDeps {
  /** The cloned repositories' folders. */
  repos: () => Promise<string[]>;
  /** A git source over those folders. */
  gitSource: (repoFolders: string[]) => GitAsOfSource | Promise<GitAsOfSource>;
}

const appDeps: AsOfLoadDeps = {
  repos: async () => (await import("../sync/git")).listGitRepos(),
  gitSource: async (r) => (await import("../sync/gitAsOf")).gitAsOfSource(r),
};

/** `(date) => vault as of date`: the history store, plus the git log of every cloned repository. */
export function makeAsOfLoad(deps: AsOfLoadDeps = appDeps): (date: number) => Promise<AsOfVault> {
  let git: Promise<GitAsOfSource | undefined> | null = null;
  return async (date) => {
    git ??= deps
      .repos()
      .then((r) => (r.length ? deps.gitSource(r) : undefined))
      .catch(() => undefined);
    const source = await git;
    if (!source) return vaultAsOf(date);
    try {
      return await vaultAsOf(date, { git: source });
    } catch {
      // A repository that can't be read (a broken clone) doesn't take the history with it.
      return vaultAsOf(date);
    }
  };
}
