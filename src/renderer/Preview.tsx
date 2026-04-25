import { useEffect, useMemo, useRef, useState } from "react";
import { renderMarkdown, extractFrontmatter } from "./pipeline";
import { CopyButtonHandler } from "./components";
import { Frontmatter } from "../ui/Frontmatter";

interface Props {
  markdownText: string;
  /** Re-render is debounced by this many ms */
  debounceMs?: number;
}

export function Preview({ markdownText, debounceMs = 120 }: Props) {
  const [tree, setTree] = useState<React.ReactElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [themeVersion, setThemeVersion] = useState(0);
  const seqRef = useRef(0);

  useEffect(() => {
    const seq = ++seqRef.current;
    const timer = setTimeout(() => {
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
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [markdownText, debounceMs, themeVersion]);

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
    <div className="h-full overflow-y-auto" data-preview-root>
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
        {tree}
      </div>
    </div>
  );
}
