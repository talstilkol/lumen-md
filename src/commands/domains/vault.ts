/** Vault commands: Vault Doctor, export / import, digest and encryption. */
import { cmdIcons, type Command } from "../../ui/CommandPalette";
import { useAppStore } from "../../store/useStore";
import { t, getLocale } from "../../i18n";
import { uiPrompt, uiSelect } from "../../ui/PromptDialog";
import { showAiToast } from "../../ui/AiToast";
import { encryptDocument, decryptDocument, isEncrypted } from "../../storage/encryption";
import { isOPFSAvailable, readWorkspaceFile } from "../../storage/workspace";
import type { CommandContext } from "./context";

/** Vault Doctor: a report on the workspace, and fixing its broken wiki links. */
export function buildVaultDoctorCommands(): Command[] {
  return [
    {
      id: "tools.vaultDoctor",
      label: t("cmd.tools.vaultDoctor"),
      hint: t("cmd.tools.vaultDoctor.hint"),
      icon: cmdIcons.Sparkles,
      group: t("group.tools"),
      action: async () => (await import("./vaultDoctorActions")).runDoctor(),
    },
    {
      id: "tools.vaultDoctorFix",
      label: t("cmd.tools.vaultDoctorFix"),
      hint: t("cmd.tools.vaultDoctorFix.hint"),
      icon: cmdIcons.Sparkles,
      group: t("group.tools"),
      action: async () => (await import("./vaultDoctorActions")).fixDoctorLinks(),
    },
    {
      id: "vault.check",
      label: t("cmd.vault.check"),
      icon: cmdIcons.Sparkles,
      group: t("group.tools"),
      action: async () => (await import("../../storage/vault/integrityCommand")).runVaultCheck(),
    },
  ];
}


/** Export the whole vault (zip or folder) and import one. */
export function buildVaultTransferCommands(): Command[] {
  return [
    {
      id: "vault.export",
      label: t("cmd.vault.export"),
      hint: t("cmd.vault.export.hint"),
      icon: cmdIcons.Save,
      group: t("group.file"),
      action: async () => {
        const { exportVaultZip, exportVaultToFolder } = await import("../../storage/exportAll");
        const { flushActiveWorkspaceDoc } = await import("../../store/openDocs");
        try {
          const picker = (window as unknown as { showDirectoryPicker?: (o?: object) => Promise<unknown> }).showDirectoryPicker;
          const choice = picker
            ? await uiSelect({ message: t("vault.export.where"), choices: [{ value: "zip", label: t("vault.export.zip") }, { value: "folder", label: t("vault.export.folder") }] })
            : "zip";
          if (!choice) return;
          // The export reads the vault from disk: include edits the
          // debounced autosave has not written yet.
          await flushActiveWorkspaceDoc();
          if (choice === "folder" && picker) {
            // A WebIDL method: it must be called on `window` (Illegal invocation otherwise).
            const dir = await picker.call(window, { mode: "readwrite" });
            const r = await exportVaultToFolder(dir as Parameters<typeof exportVaultToFolder>[0]);
            showAiToast(t("vault.export.doneFolder", { n: String(r.files), folder: r.folder }), "info");
            return;
          }
          const { bytes, files } = await exportVaultZip();
          const { downloadBytes } = await import("../../storage/exportFormats");
          downloadBytes(`lumen-vault-${new Date().toISOString().slice(0, 10)}.zip`, bytes, "application/zip");
          showAiToast(t("vault.export.done", { n: String(files) }), "info");
        } catch (e) {
          if ((e as DOMException)?.name === "AbortError") return;
          showAiToast(t("vault.export.failed", { error: (e as Error).message }), "error");
        }
      },
    },
    {
      id: "vault.import",
      label: t("cmd.vault.import"),
      hint: t("cmd.vault.import.hint"),
      icon: cmdIcons.Save,
      group: t("group.file"),
      action: async () => {
        const choice = await uiSelect({ message: t("vault.import.what"), choices: [{ value: "zip", label: t("vault.import.zip") }, { value: "folder", label: t("vault.import.folder") }] });
        if (!choice) return;
        const input = document.createElement("input");
        input.type = "file";
        if (choice === "zip") input.accept = ".zip,application/zip";
        else (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;
        input.onchange = async () => {
          const files = input.files;
          if (!files?.length) return;
          const { importZip, importFileList } = await import("../../storage/exportAll");
          try {
            const r = choice === "zip" ? await importZip(await files[0].arrayBuffer(), files[0].name) : await importFileList(files);
            window.dispatchEvent(new Event("lumen-workspace-changed"));
            showAiToast(t("vault.import.done", { notes: String(r.notes), files: String(r.attachments), folder: r.folder, source: r.source }), "info");
          } catch (e) {
            showAiToast(t("vault.import.failed", { error: (e as Error).message }), "error");
          }
        };
        input.click();
      },
    },
  ];
}

/** Digest of the notes changed since the last one. */
export function buildDigestCommands(): Command[] {
  return [
    {
      id: "vault.digest",
      label: t("cmd.vault.digest"),
      hint: t("cmd.vault.digest.hint"),
      icon: cmdIcons.Sparkles,
      group: t("group.tools"),
      action: async () => {
        const { listWorkspace, readWorkspaceFile, writeWorkspaceFile, isOPFSAvailable } = await import("../../storage/workspace");
        if (!isOPFSAvailable()) return;
        const { writeDigest } = await import("../../agents/defs/digester");
        const KEY = "lumen.digest.last";
        const now = Date.now();
        let since = now - 24 * 3600_000;
        try {
          since = Number(localStorage.getItem(KEY)) || since;
        } catch {
          /* default: last 24 h */
        }
        const lang = getLocale();
        const folder = lang === "he" ? "סיכומים" : "Digests";
        const fmtDate = (ms: number) => new Date(ms).toLocaleString(getLocale(), { dateStyle: "medium", timeStyle: "short" });
        const res = await writeDigest(
          { list: () => listWorkspace({ includeAssets: false }), read: readWorkspaceFile, write: writeWorkspaceFile },
          { since, now, lang, folder, formatDate: fmtDate },
        );
        if (!res.ok) {
          // The checkpoint stays, so these notes are in the next digest.
          showAiToast(t("toast.digest.readFailed", { count: res.failed.length }), "error");
          return;
        }
        const { path, body } = res;
        try {
          localStorage.setItem(KEY, String(now));
        } catch {
          /* next digest covers 24 h again */
        }
        window.dispatchEvent(new Event("lumen-workspace-changed"));
        useAppStore.getState().openTab({ name: path.split("/").pop()!, content: body, workspaceName: path });
      },
    },
  ];
}

/** Encrypt or decrypt the open note. */
export function buildEncryptionCommands({ setContent, liveDoc }: CommandContext): Command[] {
  return [
    {
      id: "vault.encrypt",
      label: t("cmd.security.encrypt"),
      hint: t("cmd.security.encrypt.hint"),
      icon: cmdIcons.Save,
      group: t("group.security"),
      action: async () => {
        const password = await uiPrompt({ message: "Enter encryption password:" });
        if (!password) return;
        const encrypted = await encryptDocument(liveDoc().content, password);
        setContent(encrypted);
        showAiToast(t("toast.documentEncrypted"), "info");
      },
    },
    {
      id: "vault.decrypt",
      label: t("cmd.security.decrypt"),
      hint: t("cmd.security.decrypt.hint"),
      icon: cmdIcons.Save,
      group: t("group.security"),
      action: async () => {
        if (!isEncrypted(liveDoc().content)) {
          showAiToast(t("toast.documentIsNotEncrypted"), "error");
          return;
        }
        const password = await uiPrompt({ message: "Enter decryption password:" });
        if (!password) return;
        try {
          const decrypted = await decryptDocument(liveDoc().content, password);
          setContent(decrypted);
          showAiToast(t("toast.documentDecrypted"), "info");
        } catch {
          showAiToast(t("toast.wrongPassword"), "error");
        }
      },
    },
  ];
}
