/**
 * The preview's `EmbedContext` (./embeds) for `![[embeds]]`, built from the
 * in-memory workspace index the backlinks and search panels already keep
 * (src/storage/workspaceIndex.ts). The remark pipeline is synchronous, so it
 * cannot read files itself: the index is brought up to date here, before
 * the render, and the render reads note texts from it. After an autosave the
 * index re-reads only the saved files, so a re-render after a change costs
 * one file read, not a vault scan.
 */

import { t } from "../i18n";
import { createEmbedContext, hasEmbeds, type EmbedContext, type EmbedNoticeKind } from "./embeds";

/** The workspace path a preview doc key (./previewDoc) names, or null. */
export function hostPathOf(docKey: string | null | undefined): string | null {
  return docKey?.startsWith("ws:") ? docKey.slice(3) : null;
}

export function embedNotice(kind: EmbedNoticeKind, vars: Record<string, string | number>): string {
  switch (kind) {
    case "notFound":
      return t("embed.notFound", vars);
    case "sectionNotFound":
      return t("embed.sectionNotFound", vars);
    case "cycle":
      return t("embed.cycle", vars);
    case "depth":
      return t("embed.depth", vars);
  }
}

/**
 * Context for rendering `markdownText`, or undefined when it has no embeds
 * (the common case costs one regex test). Never throws: without a
 * workspace (no OPFS) every target is reported missing.
 */
export async function loadEmbedContext(markdownText: string, docKey: string | null): Promise<EmbedContext | undefined> {
  if (!hasEmbeds(markdownText)) return undefined;
  let files: { path: string; content: string }[] = [];
  try {
    const { ensureIndex, indexedFiles } = await import("../storage/workspaceIndex");
    await ensureIndex();
    files = indexedFiles();
  } catch {
    /* no workspace */
  }
  return createEmbedContext({ hostPath: hostPathOf(docKey), hostText: markdownText, files, notice: embedNotice });
}
