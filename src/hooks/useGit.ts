/**
 * useGit – encapsulates Git clone/commit/push/pull operations.
 *
 * Extracted from useCommands.ts to keep Git-specific logic in a single
 * reusable hook. All commands still appear in the command palette via
 * the registry.
 */
import { useCallback } from "react";
import type { DocFile } from "../store/useStore";
import {
  cloneRepo,
  commitAndPush,
  getGitIdentity,
  gitStatusSummary,
  pullRepo,
  setGitIdentity,
  setGitToken,
} from "../sync/git";
import { generateAiCommitMessage } from "../ai/commands";
import { uiAlert, uiPrompt } from "../ui/PromptDialog";
import { showAiToast } from "../ui/AiToast";
import { t } from "../i18n";

export interface UseGitOptions {
  setDoc: (d: Partial<DocFile>) => void;
  showWorkspace: boolean;
  toggleWorkspace: () => void;
  activeFile: string | null;
}

export interface UseGitReturn {
  handleClone: () => Promise<void>;
  handleCommitAndPush: () => Promise<void>;
  handlePull: () => Promise<void>;
  handleSetGitIdentity: () => Promise<void>;
  handleSetGitToken: () => Promise<void>;
  handleGitStatus: () => Promise<void>;
}

export function useGit({ setDoc: _setDoc, showWorkspace, toggleWorkspace, activeFile }: UseGitOptions): UseGitReturn {
  const handleClone = useCallback(async () => {
    const url = await uiPrompt({ message: t("git.prompt.cloneUrl"), placeholder: "https://github.com/user/repo" });
    if (!url) return;
    try {
      showAiToast("Cloning repository…", "info");
      const result = await cloneRepo(url);
      showAiToast(`✅ Cloned ${result.fileCount} files into workspace`, "info");
      if (!showWorkspace) toggleWorkspace();
      window.dispatchEvent(new Event("lumen-workspace-changed"));
    } catch (e) {
      await uiAlert({ message: `Clone failed: ${(e as Error).message}` });
    }
  }, [showWorkspace, toggleWorkspace]);

  const handleCommitAndPush = useCallback(async () => {
    const repoFolder = activeFile?.split("/")[0];
    if (!repoFolder) {
      await uiAlert({ message: t("git.alert.noRepo") });
      return;
    }
    const identity = await getGitIdentity();
    let message = await uiPrompt({ message: t("git.prompt.commitMessage"), placeholder: "Update files" });
    if (!message) {
      try {
        showAiToast("Generating commit message…", "info");
        message = await generateAiCommitMessage("");
      } catch {
        message = "Update files";
      }
    }
    try {
      showAiToast("Pushing…", "info");
      await commitAndPush(repoFolder, message, identity);
      showAiToast("✅ Pushed to remote", "info");
    } catch (e) {
      await uiAlert({ message: `Push failed: ${(e as Error).message}` });
    }
  }, [activeFile]);

  const handlePull = useCallback(async () => {
    const repoFolder = activeFile?.split("/")[0];
    if (!repoFolder) {
      await uiAlert({ message: t("git.alert.noRepo") });
      return;
    }
    try {
      showAiToast("Pulling…", "info");
      const result = await pullRepo(repoFolder);
      showAiToast(`✅ Pulled ${result.changedFiles} changed files`, "info");
      window.dispatchEvent(new Event("lumen-workspace-changed"));
    } catch (e) {
      await uiAlert({ message: `Pull failed: ${(e as Error).message}` });
    }
  }, [activeFile]);

  const handleSetGitIdentity = useCallback(async () => {
    const current = await getGitIdentity();
    const name = await uiPrompt({ message: "Git name:", placeholder: current.name || "Your Name" });
    if (!name) return;
    const email = await uiPrompt({ message: "Git email:", placeholder: current.email || "you@example.com" });
    if (!email) return;
    await setGitIdentity({ name, email });
    showAiToast(`✅ Git identity set: ${name} <${email}>`, "info");
  }, []);

  const handleSetGitToken = useCallback(async () => {
    const token = await uiPrompt({ message: t("git.prompt.token"), placeholder: "ghp_xxxxxxxxxxxx" });
    if (token === null) return;
    await setGitToken(token || null);
    showAiToast(token ? "✅ Token saved" : "Token cleared", "info");
  }, []);

  const handleGitStatus = useCallback(async () => {
    const repoFolder = activeFile?.split("/")[0];
    if (!repoFolder) {
      await uiAlert({ message: t("git.alert.noRepo") });
      return;
    }
    try {
      const summary = await gitStatusSummary(repoFolder);
      const msg = `Added: ${summary.added}, Modified: ${summary.modified}, Deleted: ${summary.deleted}`;
      showAiToast(msg, "info");
    } catch (e) {
      await uiAlert({ message: `Status failed: ${(e as Error).message}` });
    }
  }, [activeFile]);

  return {
    handleClone,
    handleCommitAndPush,
    handlePull,
    handleSetGitIdentity,
    handleSetGitToken,
    handleGitStatus,
  };
}
