/** Vault commands: Vault Doctor, export / import, digest and encryption. */
import { cmdIcons, type Command } from "../../ui/CommandPalette";
import { t } from "../../i18n";
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
      action: async () => (await import("./vaultActions")).runDoctor(),
    },
    {
      id: "tools.vaultDoctorFix",
      label: t("cmd.tools.vaultDoctorFix"),
      hint: t("cmd.tools.vaultDoctorFix.hint"),
      icon: cmdIcons.Sparkles,
      group: t("group.tools"),
      action: async () => (await import("./vaultActions")).fixDoctorLinks(),
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
      action: async () => (await import("./vaultActions")).exportVault(),
    },
    {
      id: "vault.import",
      label: t("cmd.vault.import"),
      hint: t("cmd.vault.import.hint"),
      icon: cmdIcons.Save,
      group: t("group.file"),
      action: async () => (await import("./vaultActions")).importVault(),
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
      action: async () => (await import("./vaultActions")).writeDigest(),
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
      action: async () => (await import("./vaultActions")).encryptOpenNote({ setContent, liveDoc }),
    },
    {
      id: "vault.decrypt",
      label: t("cmd.security.decrypt"),
      hint: t("cmd.security.decrypt.hint"),
      icon: cmdIcons.Save,
      group: t("group.security"),
      action: async () => (await import("./vaultActions")).decryptOpenNote({ setContent, liveDoc }),
    },
  ];
}
