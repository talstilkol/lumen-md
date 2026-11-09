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
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/talstilkol/lumen-md" },
      ],
      // Content lives at the collection root (no en/ folder), so English is
      // the root locale; Hebrew pages fall back to English until translated.
      locales: {
        root: { label: "English", lang: "en" },
        he: { label: "עברית", lang: "he" },
      },
      sidebar: [
        {
          label: "Getting Started",
          items: [
            { label: "Welcome to Lumen", slug: "getting-started/welcome" },
            { label: "Quickstart", slug: "getting-started/quickstart" },
            { label: "Desktop app updates", slug: "getting-started/desktop-updates" },
          ],
        },
        {
          label: "Editor modes",
          items: [
            { label: "Source / Split / Preview / WYSIWYG", slug: "editor/modes" },
            { label: "Smart Insert", slug: "editor/smart-insert" },
            { label: "Accessibility", slug: "editor/accessibility", translations: { he: "נגישות" } },
            { label: "Touch and phones", slug: "editor/touch", translations: { he: "מגע וטלפונים" } },
          ],
        },
        {
          label: "Markdown blocks",
          items: [{ autogenerate: { directory: "blocks" } }],
        },
        {
          label: "Workspace",
          items: [
            { label: "Database views", slug: "workspace/database-views" },
            { label: "Database formulas + map", slug: "workspace/database-formulas" },
            { label: "Search (BM25 + Smart)", slug: "workspace/search" },
            { label: "Search operators and #tags", slug: "workspace/search-operators", translations: { he: "אופרטורי חיפוש ו-#תגיות" } },
            { label: "Vault Doctor", slug: "workspace/doctor" },
            { label: "Quick capture (inbox)", slug: "workspace/quick-capture" },
            { label: "PDF reader and highlights", slug: "workspace/pdf-reader" },
            { label: "Large vaults and long notes", slug: "workspace/large-vaults" },
            { label: "Canvas (Excalidraw)", slug: "workspace/canvas", translations: { he: "קנבס (Excalidraw)" } },
          ],
        },
        {
          label: "Collaboration",
          items: [
            { label: "Real-time WebRTC", slug: "collab/webrtc" },
            { label: "End-to-end encryption", slug: "collab/encryption" },
          ],
        },
        {
          label: "AI",
          items: [
            { label: "Auto-tag + link suggestions", slug: "ai/agents" },
            { label: "Local LLM (web-llm)", slug: "ai/local-llm" },
            { label: "Local translation", slug: "ai/translation" },
            { label: "English spelling on this device", slug: "ai/spelling" },
            { label: "Image descriptions on this device", slug: "ai/image-captions" },
            { label: "Hebrew niqqud on this device", slug: "ai/nikud" },
            { label: "Image descriptions on this device", slug: "ai/image-captions" },
            { label: "English spelling on this device", slug: "ai/spelling" },
            { label: "AI doctor", slug: "ai/doctor" },
            { label: "Image search by description", slug: "ai/image-search" },
            { label: "Data analyst", slug: "ai/data-analyst" },
            { label: "Train a model on your style, locally", slug: "ai/local-fine-tune" },
            { label: "AI cost: usage meter + answer cache", slug: "ai/cost" },
            { label: "Research + citation checks", slug: "ai/research" },
            { label: "Agent eval: 14 agents, HTML report", slug: "ai/agent-eval", translations: { he: "הערכת סוכנים: 14 סוכנים, דוח HTML" } },
            { label: "Personal data before the cloud", slug: "ai/pii-redaction", translations: { he: "מידע אישי לפני הענן" } },
            { label: "MCP integration (Claude Desktop, Cursor)", slug: "ai/mcp" },
          ],
        },
        {
          label: "Plugins + Templates",
          items: [
            { label: "Plugin SDK", slug: "plugins/sdk" },
            { label: "Sandbox and permissions", slug: "plugins/sandbox" },
            { label: "Plugin API", slug: "plugins/api" },
            { label: "Plugin gallery", slug: "plugins/gallery" },
            { label: "Plugin signing keys", slug: "plugins/signing" },
            { label: "Templates marketplace", slug: "plugins/templates" },
            { label: "Web Clipper extension", slug: "plugins/web-clipper" },
          ],
        },
        {
          label: "Sync",
          items: [
            { label: "Git sync", slug: "sync/git" },
            { label: "Sync providers (WebDAV, S3, Dropbox, Drive)", slug: "sync/cloud" },
            { label: "Encrypted sync (E2EE)", slug: "sync/e2ee" },
            { label: "Read-mode publishing", slug: "sync/publish" },
          ],
        },
        {
          label: "Account",
          items: [
            { label: "Signing in", slug: "account/sign-in" },
            { label: "Single sign-on (SSO)", slug: "account/sso" },
            { label: "Organization settings", slug: "account/organization" },
          ],
        },
        {
          label: "Security",
          items: [
            { label: "Secrets and encryption", slug: "security/vault" },
            { label: "Monitoring and web vitals", slug: "security/monitoring" },
          ],
        },
        {
          label: "Self-hosting",
          items: [
            { label: "Docker compose bundle", slug: "self-hosting/docker" },
            { label: "Where Lumen runs", slug: "self-hosting/hosting", translations: { he: "איפה Lumen רץ" } },
            { label: "Android and iOS builds", slug: "self-hosting/mobile", translations: { he: "בניית Android ו-iOS" } },
          ],
        },
        {
          label: "Project",
          translations: { he: "הפרויקט" },
          items: [
            { label: "Issue triage", slug: "project/issue-triage", translations: { he: "מיון issues" } },
          ],
        },
        {
          label: "Project",
          translations: { he: "הפרויקט" },
          items: [
            { label: "Public roadmap", slug: "project/roadmap", translations: { he: "מפת דרכים ציבורית" } },
          ],
        },
      ],
    }),
  ],
});
