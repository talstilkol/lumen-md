import { useEffect, useMemo, useRef, useState } from "react";
import { renderMarkdown, extractFrontmatter } from "./pipeline";
import { CopyButtonHandler } from "./components";
import { Frontmatter } from "../ui/Frontmatter";
import { ErrorBoundary } from "../ui/ErrorBoundary";
import { t } from "../i18n";

interface Props {
  markdownText: string;
  /** Re-render is debounced by this many ms */
  debounceMs?: number;
}

export function Preview({ markdownText }: Props) {
  const [tree, setTree] = useState<React.ReactElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [themeVersion, setThemeVersion] = useState(0);
  const seqRef = useRef(0);

  useEffect(() => {
    const seq = ++seqRef.current;
    const isDark = () => document.documentElement.classList.contains("dark");
    renderMarkdown(markdownText, isDark)
      .then((el) => {
        if (seq !== seqRef.current) return;
        setTree(el);
        setError(null);
      })
      .catch((e: Error) => {
        if (seq !== seqRef.current) return;
        setError(e.message);
      });
  }, [markdownText, themeVersion]);

  // Re-process when theme changes so Shiki picks up the right theme tokens.
  useEffect(() => {
    const obs = new MutationObserver(() => setThemeVersion((v) => v + 1));
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => obs.disconnect();
  }, []);

  const frontmatter = useMemo(
    () => extractFrontmatter(markdownText),
    [markdownText],
  );

  return (
    <div className="flex-1 min-h-0 overflow-y-auto" data-preview-root>
      <CopyButtonHandler />
      {error && (
        <div
          style={{
            margin: "1rem",
            padding: "1rem",
            border: "1px solid hsl(0 80% 60% / 0.4)",
            borderRadius: "0.5rem",
            background: "hsl(0 80% 60% / 0.08)",
            color: "hsl(0 80% 70%)",
            fontFamily: "ui-monospace, monospace",
            fontSize: 12,
            whiteSpace: "pre-wrap",
          }}
        >
          ⚠︎ Render error: {error}
        </div>
      )}
      <div className="prose-lumen">
        <Frontmatter data={frontmatter} />
        <ErrorBoundary fallback={
          <div style={{ padding: "16px", color: "hsl(0 80% 60%)", border: "1px solid currentColor", borderRadius: "8px", margin: "16px" }}>
            <strong>{t("errorBoundary.heading")}</strong>
            <p style={{ marginTop: "4px", fontSize: "12px", opacity: 0.8 }}>{t("errorBoundary.renderDetail")}</p>
          </div>
        }>
          {tree}
        </ErrorBoundary>
      </div>
    </div>
  );
}
