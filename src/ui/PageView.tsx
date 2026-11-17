import { useAppStore } from "../store/useStore";
import { PagedPreview } from "./PagedPreview";

/**
 * The page view (toolbar "Page View", `view.pageView`): since W13.R10 it is
 * the print-accurate page preview — the PDF export's own pages, laid out by
 * the browser's print fragmentation (./PagedPreview.tsx). It used to slice
 * one tall preview into 912px windows, which cut lines in half and counted
 * pages the PDF did not have.
 */
interface Props {
  markdownText: string;
  docKey?: string | null;
}

export function PageView({ markdownText, docKey = null }: Props) {
  const name = useAppStore((s) => s.doc.name);
  return <PagedPreview key={docKey ?? name} markdownText={markdownText} docName={(name ?? "").replace(/\.(md|markdown)$/i, "")} />;
}
