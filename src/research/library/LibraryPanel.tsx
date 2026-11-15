/**
 * The reading library panel (plan 7.6, W10.E36): search the clips by
 * meaning, with the library's own embedding index (./clipIndex.ts).
 *
 * Opening it brings the index up to date with the vault's clips (new and
 * changed ones are embedded, deleted ones dropped); from then on a saved
 * clip is indexed as it is saved. A result opens the clip.
 *
 * Lazy: mounted by "Research: search the library"; never in the startup bundle.
 */
import { useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BookOpen, X } from "lucide-react";
import { t } from "../../i18n";
import { useAppStore } from "../../store/useStore";
import { explainError } from "../../lib/userError";
import { searchLibrary, syncLibrary, type LibraryDeps, type LibraryHit, appDeps } from "./clipIndex";
import "./libraryStrings";
import { HelpButton } from "../../ui/HelpButton";

/** Wait after the last keystroke before searching. */
export const LIBRARY_SEARCH_DELAY_MS = 250;

export interface LibraryVault {
  available(): boolean;
  list(): Promise<string[]>;
  read(path: string): Promise<string>;
}

async function appVault(): Promise<LibraryVault> {
  const ws = await import("../../storage/workspace");
  return {
    available: () => ws.isOPFSAvailable(),
    list: async () => (await ws.listWorkspace({ includeAssets: false })).map((e) => e.path),
    read: (p) => ws.readWorkspaceFile(p),
  };
}

type Status = { kind: "indexing"; done: number; total: number } | { kind: "ready"; count: number } | { kind: "error"; message: string } | { kind: "noVault" };

const muted: React.CSSProperties = { fontSize: 12, color: "hsl(var(--fg-muted))", margin: 0 };
const btn: React.CSSProperties = { padding: "2px 8px", fontSize: 12, borderRadius: 6, border: "1px solid hsl(var(--border))", background: "transparent", color: "inherit", cursor: "pointer" };
const host = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
};

export function LibraryPanel({ vault, deps, onClose }: { vault: LibraryVault; deps: LibraryDeps; onClose: () => void }) {
  const [status, setStatus] = useState<Status>({ kind: "indexing", done: 0, total: 0 });
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<LibraryHit[] | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!vault.available()) {
      setStatus({ kind: "noVault" });
      return;
    }
    let live = true;
    void vault
      .list()
      .then((files) => syncLibrary(files, vault.read, deps, (done, total) => live && setStatus({ kind: "indexing", done, total })))
      .then((count) => live && setStatus({ kind: "ready", count }))
      .catch((e) => live && setStatus({ kind: "error", message: explainError(e) }));
    return () => {
      live = false;
    };
  }, [vault, deps]);

  useEffect(() => {
    if (status.kind !== "ready") return;
    const q = query.trim();
    const mine = ++seq.current;
    if (!q) {
      setHits(null);
      return;
    }
    const timer = setTimeout(() => {
      void searchLibrary(q, 10, deps)
        .then((h) => mine === seq.current && setHits(h))
        .catch((e) => mine === seq.current && setStatus({ kind: "error", message: explainError(e) }));
    }, LIBRARY_SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query, status.kind, deps]);

  const open = (path: string) => {
    void vault.read(path).then((content) => useAppStore.getState().openTab({ name: path.split("/").pop() ?? path, content, workspaceName: path }));
  };

  return (
    <aside
      dir="auto"
      role="dialog"
      data-testid="library-panel"
      aria-label={t("library.title")}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
      style={{ position: "fixed", insetInlineEnd: 12, top: 72, width: 340, maxWidth: "calc(100vw - 24px)", maxHeight: "75vh", overflow: "auto", zIndex: 40, background: "hsl(var(--bg))", border: "1px solid hsl(var(--border))", borderRadius: 10, boxShadow: "var(--shadow-sm)", padding: 10, display: "flex", flexDirection: "column", gap: 8 }}
    >
      <header style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <BookOpen size={14} />
        <strong style={{ flex: 1, fontSize: 13 }}>{t("library.title")}</strong>
        <HelpButton topic="ai/research#research-search-the-library-by-meaning" />
        <button type="button" style={btn} onClick={onClose} aria-label={t("library.close")}>
          <X size={12} />
        </button>
      </header>
      <input
        type="search"
        autoFocus
        dir="auto"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("library.search")}
        aria-label={t("library.search")}
        data-testid="library-search"
        style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid hsl(var(--border))", background: "transparent", color: "inherit" }}
      />
      <p style={muted} role="status" data-testid="library-status">
        {status.kind === "indexing" && t("library.indexing", { done: status.done, total: status.total })}
        {status.kind === "ready" && (status.count ? t("library.count", { count: status.count }) : t("library.empty"))}
        {status.kind === "error" && t("library.unavailable", { message: status.message })}
        {status.kind === "noVault" && t("library.noVault")}
      </p>
      {hits && hits.length === 0 && <p style={muted}>{t("library.noResults")}</p>}
      {hits && hits.length > 0 && (
        <ul style={{ margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {hits.map((h) => (
            <li key={h.path} style={{ listStyle: "none" }} data-testid="library-hit" data-path={h.path}>
              <button type="button" onClick={() => open(h.path)} style={{ ...btn, border: "none", padding: 0, textAlign: "start", width: "100%" }}>
                <bdi style={{ fontSize: 13, fontWeight: 600 }}>{h.title}</bdi>
              </button>
              {h.source && <div style={muted}><bdi>{host(h.source)}</bdi></div>}
              <div style={{ ...muted, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                <bdi>{h.snippet}</bdi>
              </div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

let mounted: { root: Root; el: HTMLElement; stop: () => void } | null = null;

export function isLibraryPanelOpen(): boolean {
  return !!mounted;
}

/** Show the panel, or hide it when it is open. */
export async function toggleLibraryPanel(opts: { vault?: LibraryVault; deps?: LibraryDeps } = {}): Promise<void> {
  if (mounted) {
    mounted.stop();
    return;
  }
  const vault = opts.vault ?? (await appVault());
  const deps = opts.deps ?? appDeps();
  const el = document.createElement("div");
  el.id = "library-panel-root";
  document.body.appendChild(el);
  const root = createRoot(el);
  const stop = () => {
    mounted = null;
    root.unmount();
    el.remove();
  };
  mounted = { root, el, stop };
  root.render(<LibraryPanel vault={vault} deps={deps} onClose={stop} />);
}
