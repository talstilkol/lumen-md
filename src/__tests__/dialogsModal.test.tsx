/**
 * Plan 10.1 / W10.E5–E7 — the app's dialogs, rendered: each is the Modal
 * primitive (a native <dialog>, labelled), focus is inside once it opens,
 * Tab and Shift+Tab never leave it, and Escape closes it.
 *
 * The dialogs here are the ones that render from props alone; the rest
 * need a running app (a collab session, an editor view, a vault) and are
 * opened for real by e2e/a11y-dialogs.spec.ts. src/__tests__/modalTraps.test.ts
 * checks statically that all 66 are <Modal>.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { createElement, type ComponentType } from "react";

afterEach(() => cleanup());

const tick = () => act(() => new Promise((r) => setTimeout(r, 0)));

type Case = { name: string; load: () => Promise<ComponentType<Record<string, unknown>>>; props?: Record<string, unknown> };
const pick = <T,>(m: T, k: keyof T) => m[k] as unknown as ComponentType<Record<string, unknown>>;

/** [name, component, props besides onClose] — each closes through `onClose`. */
const CASES: Case[] = [
  { name: "AiDoctorPanel", load: async () => pick(await import("../ui/AiDoctorPanel"), "AiDoctorPanel"), props: { open: true } },
  { name: "AgentReviewPanel", load: async () => pick(await import("../ui/AgentReviewPanel"), "AgentReviewPanel"), props: { open: true } },
  { name: "PrivacyLedgerPanel", load: async () => pick(await import("../ui/PrivacyLedgerPanel"), "PrivacyLedgerPanel"), props: { open: true } },
  { name: "TrashPanel", load: async () => pick(await import("../ui/TrashPanel"), "TrashPanel"), props: { open: true } },
  { name: "ImageHostsPanel", load: async () => pick(await import("../ui/ImageHostsPanel"), "ImageHostsPanel"), props: { open: true } },
  { name: "ReadingSettings", load: async () => pick(await import("../ui/ReadingSettings"), "ReadingSettings"), props: { open: true } },
  { name: "KeyboardShortcuts", load: async () => pick(await import("../ui/KeyboardShortcuts"), "KeyboardShortcuts"), props: { open: true } },
  { name: "TemplateGallery", load: async () => pick(await import("../ui/TemplateGallery"), "TemplateGallery"), props: { open: true } },
  { name: "PluginGallery", load: async () => pick(await import("../ui/PluginGallery"), "PluginGallery"), props: { open: true } },
  { name: "AuditLog", load: async () => pick(await import("../ui/AuditLog"), "AuditLog"), props: { open: true } },
  { name: "OrgSettings", load: async () => pick(await import("../ui/OrgSettings"), "OrgSettings"), props: { open: true } },
  { name: "ThemeSettings", load: async () => pick(await import("../ui/ThemeSettings"), "ThemeSettings"), props: { open: true } },
  { name: "TrustedKeysSettings", load: async () => pick(await import("../ui/TrustedKeysSettings"), "TrustedKeysSettings"), props: { open: true } },
  { name: "FineTuneSettings", load: async () => pick(await import("../ui/FineTuneSettings"), "FineTuneSettings"), props: { open: true } },
  { name: "AiSettingsPanel", load: async () => pick(await import("../ui/AiSettingsPanel"), "AiSettingsPanel"), props: { open: true } },
  { name: "SettingsScreen", load: async () => pick(await import("../ui/SettingsScreen"), "SettingsScreen") },
  { name: "QuickCapture", load: async () => pick(await import("../ui/QuickCapture"), "QuickCapture"), props: { open: true } },
  { name: "FeatureFlagsPanel", load: async () => pick(await import("../ui/FeatureFlagsPanel"), "FeatureFlagsPanel") },
  { name: "TrustedReposDialog", load: async () => pick(await import("../ui/TrustedReposDialog"), "TrustedReposDialog"), props: { loadRepos: async () => [] } },
  { name: "PublishSiteDialog", load: async () => pick(await import("../ui/PublishSiteDialog"), "PublishSiteDialog") },
  { name: "NetworkMonitor", load: async () => pick(await import("../privacy/NetworkMonitor"), "NetworkMonitor") },
  { name: "ShareLinkDialog", load: async () => pick(await import("../share/ShareLinkDialog"), "ShareLinkDialog"), props: { title: "note.md", markdown: "# Note\n" } },
  { name: "TranslationSuggest", load: async () => pick(await import("../ui/TranslationSuggest"), "TranslationSuggest"), props: { open: () => {} } },
  { name: "HelpPanel", load: async () => pick(await import("../ui/HelpPanel"), "HelpPanel"), props: { topic: "getting-started" } },
  { name: "VaultEncryptionDialog", load: async () => pick(await import("../ui/VaultEncryptionDialog"), "VaultEncryptionDialog") },
  { name: "LectureRecorder", load: async () => pick(await import("../student/LectureRecorder"), "LectureRecorder") },
  { name: "ClassroomPanel", load: async () => pick(await import("../sync/e2ee/classroom/ClassroomPanel"), "ClassroomPanel"), props: { relay: null } },
  { name: "VersionHistory", load: async () => pick(await import("../ui/VersionHistory"), "VersionHistory"), props: { fileName: "note.md", currentContent: "x", onRestore: () => {} } },
];

describe("the app's dialogs are the Modal primitive", () => {
  for (const c of CASES) {
    it(`${c.name}: a labelled <dialog>, focus inside, Tab and Shift+Tab stay, Escape closes`, async () => {
      const Comp = await c.load();
      const onClose = vi.fn();
      const opener = document.createElement("button");
      opener.textContent = "opener";
      document.body.append(opener);
      opener.focus();
      const { getAllByRole } = render(createElement(Comp, { ...c.props, onClose }));
      await tick();
      await tick();
      const dialogs = getAllByRole("dialog");
      const d = dialogs[dialogs.length - 1];
      expect(d.tagName).toBe("DIALOG");
      expect(d.classList.contains("lumen-modal")).toBe(true);
      expect(d.getAttribute("aria-label") || d.getAttribute("aria-labelledby")).toBeTruthy();
      expect(d.contains(document.activeElement)).toBe(true);
      for (let i = 0; i < 15; i++) {
        fireEvent.keyDown(document.activeElement ?? document.body, { key: "Tab", shiftKey: i % 3 === 2 });
        expect(d.contains(document.activeElement), `Tab ${i + 1}`).toBe(true);
      }
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
      await tick();
      expect(onClose).toHaveBeenCalled();
      opener.remove();
    });
  }
});
