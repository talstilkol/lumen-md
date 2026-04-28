import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// Lumen's user docs. Hosted at docs.lumen.app — point your CNAME there.
//
// `npm install && npm run dev` from inside `docs/` to author. The site
// builds to `docs/dist/` for any static host (Cloudflare Pages, Netlify,
// GitHub Pages).
export default defineConfig({
  site: "https://docs.lumen.app",
  integrations: [
    starlight({
      title: "Lumen Docs",
      description: "Markdown, illuminated. The user manual.",
      social: {
        github: "https://github.com/",
      },
      defaultLocale: "en",
      locales: {
        en: { label: "English" },
        he: { label: "עברית", lang: "he" },
      },
      sidebar: [
        {
          label: "Getting Started",
          items: [
            { label: "Welcome to Lumen", slug: "getting-started/welcome" },
            { label: "Quickstart", slug: "getting-started/quickstart" },
            { label: "Keyboard shortcuts", slug: "getting-started/shortcuts" },
          ],
        },
        {
          label: "Editor modes",
          items: [
            { label: "Source / Split / Preview / WYSIWYG", slug: "editor/modes" },
            { label: "Smart Insert", slug: "editor/smart-insert" },
            { label: "Slash menu", slug: "editor/slash-menu" },
          ],
        },
        {
          label: "Markdown blocks",
          autogenerate: { directory: "blocks" },
        },
        {
          label: "Workspace",
          items: [
            { label: "OPFS file tree", slug: "workspace/opfs" },
            { label: "Wiki-links + Backlinks", slug: "workspace/wiki-links" },
            { label: "Database views", slug: "workspace/database-views" },
            { label: "Search (BM25 + Smart)", slug: "workspace/search" },
          ],
        },
        {
          label: "Collaboration",
          items: [
            { label: "Real-time WebRTC", slug: "collab/webrtc" },
            { label: "Persistent rooms (Pro)", slug: "collab/persistent" },
            { label: "End-to-end encryption", slug: "collab/encryption" },
          ],
        },
        {
          label: "AI",
          items: [
            { label: "AI Settings", slug: "ai/settings" },
            { label: "Smart search", slug: "ai/smart-search" },
            { label: "Auto-tag + link suggestions", slug: "ai/agents" },
            { label: "Local LLM (web-llm)", slug: "ai/local-llm" },
            { label: "MCP integration (Claude Desktop, Cursor)", slug: "ai/mcp" },
          ],
        },
        {
          label: "Plugins + Templates",
          items: [
            { label: "Plugin gallery", slug: "plugins/gallery" },
            { label: "Templates marketplace", slug: "plugins/templates" },
            { label: "Web Clipper extension", slug: "plugins/web-clipper" },
          ],
        },
        {
          label: "Sync",
          items: [
            { label: "Git sync", slug: "sync/git" },
            { label: "Cloud sync (Dropbox, Drive)", slug: "sync/cloud" },
            { label: "Read-mode publishing", slug: "sync/publish" },
          ],
        },
        {
          label: "Security",
          items: [
            { label: "Vault + recovery phrase", slug: "security/vault" },
            { label: "Privacy", slug: "security/privacy" },
          ],
        },
        {
          label: "Self-hosting",
          items: [
            { label: "Docker compose bundle", slug: "self-hosting/docker" },
          ],
        },
        { label: "FAQ", slug: "faq" },
      ],
    }),
  ],
});
