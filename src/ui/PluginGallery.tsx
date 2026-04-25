import { useState } from "react";
import { getRegisteredPlugins, registerPlugin, unregisterPlugin } from "../plugins/pluginSystem";
import type { LumenPlugin } from "../plugins/pluginSystem";

/**
 * Community Plugin Gallery — browse, install, and manage plugins.
 */

// ── Built-in Community Plugins Catalog ──────────────────────────────────

const COMMUNITY_PLUGINS: LumenPlugin[] = [
  {
    id: "community.reading-time",
    name: "Reading Time",
    version: "1.0.0",
    description: "Shows estimated reading time in the toolbar",
    author: "Lumen Community",
    activate: (api) => {
      api.registerCommand({
        id: "reading-time.show",
        label: "📖 Reading Time",
        hint: "Show estimated reading time",
        action: () => {
          const content = api.getContent();
          const words = content.split(/\s+/).filter(Boolean).length;
          const minutes = Math.ceil(words / 200);
          api.showToast(`📖 ~${minutes} min read (${words} words)`);
        },
      });
    },
  },
  {
    id: "community.emoji-picker",
    name: "Emoji Picker",
    version: "1.0.0",
    description: "Insert emoji via command palette",
    author: "Lumen Community",
    activate: (api) => {
      const emojis = ["😀", "🎉", "🚀", "✨", "💡", "🔥", "❤️", "⭐", "📝", "🎯", "💪", "🌟"];
      for (const emoji of emojis) {
        api.registerCommand({
          id: `emoji.${emoji}`,
          label: `Insert ${emoji}`,
          hint: "Emoji",
          action: () => {
            const content = api.getContent();
            api.setContent(content + emoji);
          },
        });
      }
    },
  },
  {
    id: "community.lorem-ipsum",
    name: "Lorem Ipsum Generator",
    version: "1.0.0",
    description: "Generate placeholder text for drafts",
    author: "Lumen Community",
    activate: (api) => {
      api.registerCommand({
        id: "lorem.generate",
        label: "📄 Lorem Ipsum",
        hint: "Generate placeholder text",
        action: () => {
          const lorem = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.";
          const content = api.getContent();
          api.setContent(content + "\n\n" + lorem);
          api.showToast("📄 Lorem ipsum inserted");
        },
      });
    },
  },
  {
    id: "community.markdown-lint",
    name: "Markdown Linter",
    version: "1.0.0",
    description: "Basic markdown style checks",
    author: "Lumen Community",
    activate: (api) => {
      api.registerCommand({
        id: "lint.check",
        label: "🔍 Lint Markdown",
        hint: "Check for common issues",
        action: () => {
          const content = api.getContent();
          const issues: string[] = [];
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].length > 120) issues.push(`Line ${i + 1}: exceeds 120 chars`);
            if (lines[i].match(/^#+[^ ]/)) issues.push(`Line ${i + 1}: missing space after #`);
            if (lines[i].match(/  $/)) issues.push(`Line ${i + 1}: trailing whitespace`);
          }
          if (issues.length === 0) {
            api.showToast("✅ No issues found!");
          } else {
            api.showToast(`⚠️ ${issues.length} issues: ${issues.slice(0, 3).join(", ")}`);
          }
        },
      });
    },
  },
  {
    id: "community.focus-mode",
    name: "Focus Mode",
    version: "1.0.0",
    description: "Distraction-free writing with dimmed UI",
    author: "Lumen Community",
    activate: (api) => {
      let active = false;
      api.registerCommand({
        id: "focus.toggle",
        label: "🧘 Focus Mode",
        hint: "Toggle distraction-free writing",
        action: () => {
          active = !active;
          document.body.classList.toggle("focus-mode", active);
          api.showToast(active ? "🧘 Focus mode ON" : "Focus mode OFF");
        },
      });
    },
  },
  {
    id: "community.toc-generator",
    name: "Table of Contents",
    version: "1.0.0",
    description: "Generate a table of contents from headings",
    author: "Lumen Community",
    activate: (api) => {
      api.registerCommand({
        id: "toc.generate",
        label: "📋 Generate Table of Contents",
        hint: "From headings",
        action: () => {
          const content = api.getContent();
          const headings = content.match(/^#{1,6}\s+.+$/gm) || [];
          if (headings.length === 0) {
            api.showToast("No headings found");
            return;
          }
          const toc = headings.map((h) => {
            const level = h.match(/^#+/)![0].length;
            const text = h.replace(/^#+\s+/, "");
            const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
            return `${"  ".repeat(level - 1)}- [${text}](#${slug})`;
          }).join("\n");
          api.setContent("## Table of Contents\n\n" + toc + "\n\n---\n\n" + content);
          api.showToast("📋 TOC inserted at top");
        },
      });
    },
  },
];

// ── Gallery Component ───────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
}

export function PluginGallery({ open, onClose }: Props) {
  const [installed, setInstalled] = useState<Set<string>>(
    () => new Set(getRegisteredPlugins().map((p) => p.id)),
  );
  const [search, setSearch] = useState("");

  if (!open) return null;

  const filtered = COMMUNITY_PLUGINS.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.description ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  const handleInstall = async (plugin: LumenPlugin) => {
    await registerPlugin(plugin);
    setInstalled(new Set([...installed, plugin.id]));
  };

  const handleUninstall = (pluginId: string) => {
    unregisterPlugin(pluginId);
    const next = new Set(installed);
    next.delete(pluginId);
    setInstalled(next);
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200,
      background: "rgba(0,0,0,0.7)",
      display: "flex", alignItems: "center", justifyContent: "center",
      backdropFilter: "blur(8px)",
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "hsl(var(--bg))",
        border: "1px solid hsl(var(--border))",
        borderRadius: 16,
        width: 640,
        maxHeight: "80vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          padding: "16px 20px",
          borderBottom: "1px solid hsl(var(--border))",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}>
          <span style={{ fontSize: 20 }}>🔌</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Plugin Gallery</div>
            <div style={{ fontSize: 12, color: "hsl(var(--fg-muted))" }}>
              {installed.size} installed · {COMMUNITY_PLUGINS.length} available
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <input
            type="text"
            placeholder="Search plugins..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              background: "hsl(var(--bg-subtle))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 8,
              padding: "6px 12px",
              fontSize: 13,
              color: "hsl(var(--fg))",
              width: 200,
              outline: "none",
            }}
          />
        </div>

        {/* Plugin list */}
        <div style={{
          flex: 1,
          overflow: "auto",
          padding: "12px 16px",
        }}>
          {filtered.map((plugin) => (
            <div key={plugin.id} style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 16px",
              borderRadius: 10,
              background: "hsl(var(--bg-subtle) / 0.5)",
              border: "1px solid hsl(var(--border))",
              marginBottom: 8,
              transition: "all 200ms ease",
            }}>
              <div style={{
                width: 36, height: 36,
                borderRadius: 8,
                background: "linear-gradient(135deg, #7c5cfc, #c084fc)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 18,
                flexShrink: 0,
              }}>
                🔌
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{plugin.name}</div>
                <div style={{
                  fontSize: 12,
                  color: "hsl(var(--fg-muted))",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}>
                  {plugin.description}
                </div>
                <div style={{ fontSize: 11, color: "hsl(var(--fg-muted) / 0.6)", marginTop: 2 }}>
                  v{plugin.version} · by {plugin.author}
                </div>
              </div>
              <button
                onClick={() =>
                  installed.has(plugin.id)
                    ? handleUninstall(plugin.id)
                    : handleInstall(plugin)
                }
                style={{
                  padding: "6px 16px",
                  borderRadius: 8,
                  border: "none",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                  background: installed.has(plugin.id)
                    ? "hsl(var(--border))"
                    : "linear-gradient(135deg, #7c5cfc, #c084fc)",
                  color: "white",
                  transition: "all 150ms ease",
                }}
              >
                {installed.has(plugin.id) ? "Uninstall" : "Install"}
              </button>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{
          padding: "10px 20px",
          borderTop: "1px solid hsl(var(--border))",
          textAlign: "center",
          fontSize: 11,
          color: "hsl(var(--fg-muted) / 0.5)",
        }}>
          More plugins coming soon • <a href="https://github.com/talstilkol/lumen-md" style={{ color: "hsl(var(--accent))" }}>Submit a plugin</a>
        </div>
      </div>
    </div>
  );
}
