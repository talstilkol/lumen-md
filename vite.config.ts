/// <reference types="vitest" />
import { defineConfig as defineViteConfig } from "vite";
import type { UserConfig as ViteUserConfig } from "vite";

interface VitestConfig {
  test?: {
    environment?: string;
    include?: string[];
    globals?: boolean;
    setupFiles?: string[];
    coverage?: {
      provider?: "v8" | "istanbul";
      reporter?: string[];
      reportsDirectory?: string;
      exclude?: string[];
    };
  };
}

const defineConfig = (config: ViteUserConfig & VitestConfig) =>
  defineViteConfig(config as ViteUserConfig);
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

/**
 * Tiny Vite plugin: rewrites clean URLs (`/roadmap`, `/landing`) to
 * their `.html` counterparts in `public/`. Production deployments
 * usually handle this at the proxy layer; this keeps dev / preview
 * parity with production so the status-bar link works locally.
 */
const cleanUrlAliases = {
  name: "lumen-clean-url-aliases",
  configureServer(server: { middlewares: { use: (fn: (req: { url?: string }, res: unknown, next: () => void) => void) => void } }) {
    server.middlewares.use((req, _res, next) => {
      if (req.url === "/roadmap") req.url = "/roadmap.html";
      else if (req.url === "/landing") req.url = "/landing.html";
      else if (req.url === "/benchmarks") req.url = "/benchmarks.html";
      next();
    });
  },
  configurePreviewServer(server: { middlewares: { use: (fn: (req: { url?: string }, res: unknown, next: () => void) => void) => void } }) {
    server.middlewares.use((req, _res, next) => {
      if (req.url === "/roadmap") req.url = "/roadmap.html";
      else if (req.url === "/landing") req.url = "/landing.html";
      else if (req.url === "/benchmarks") req.url = "/benchmarks.html";
      next();
    });
  },
};

export default defineConfig({
  plugins: [
    react(),
    cleanUrlAliases,
    VitePWA({
      registerType: "prompt",
      includeAssets: ["favicon.svg", "icons/*.png"],
      manifest: {
        name: "Lumen — Markdown, illuminated",
        short_name: "Lumen",
        description:
          "A markdown editor that turns text and data into beautiful documents.",
        theme_color: "#7c5cff",
        background_color: "#0c0f17",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Generous limit so heavy WASM/lazy chunks (Mermaid, Graphviz, ECharts)
        // are precached on install for offline use. Shiki bundles every
        // grammar/theme and is lazy-loaded only when a code block renders, so
        // it's intentionally excluded from precache.
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        globPatterns: ["**/*.{js,css,html,svg,wasm,woff2}"],
        // Per-language Shiki grammars are now individual chunks in
        // assets/shiki-langs/ — fetched on demand by the runtime cache.
        // Keeping them out of precache cuts ~10 MB of installs the user
        // probably never needs (cpp, emacs-lisp, etc).
        globIgnores: [
          "**/vendor-shiki-*.js",
          "**/shiki-langs/**",
        ],
        runtimeCaching: [
          {
            // Google Fonts CSS (mutable, but small)
            urlPattern: ({ url }) =>
              url.origin === "https://fonts.googleapis.com",
            handler: "StaleWhileRevalidate",
            options: { cacheName: "lumen-fonts-css" },
          },
          {
            // Google Fonts files (immutable hashed names)
            urlPattern: ({ url }) =>
              url.origin === "https://fonts.gstatic.com",
            handler: "CacheFirst",
            options: {
              cacheName: "lumen-fonts",
              expiration: { maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            // CDN-loaded model-viewer + Leaflet
            urlPattern: ({ url }) => url.origin === "https://unpkg.com",
            handler: "StaleWhileRevalidate",
            options: { cacheName: "lumen-cdn" },
          },
        ],
      },
      devOptions: {
        // Don't enable in dev — the SW intercepts HMR.
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  // ε.4.3 — clean-URL aliases for the auxiliary HTML pages so dev links
  // like `/roadmap` and `/landing` work without the `.html` suffix.
  // Production deployments are expected to handle this at the reverse
  // proxy layer (Cloudflare Pages, nginx).
  preview: {
    port: 5173,
  },
  build: {
    target: "es2022",
    sourcemap: true,
    // Warn early if a single chunk crosses 500 KiB; the renderer pipeline
    // and editor frameworks split out as their own chunks today.
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        landing: path.resolve(__dirname, "public/landing.html"),
        roadmap: path.resolve(__dirname, "public/roadmap.html"),
        benchmarks: path.resolve(__dirname, "public/benchmarks.html"),
      },
      output: {
        // Route Shiki per-language and per-theme grammar chunks into a
        // dedicated `assets/shiki-langs/` subfolder so the PWA precache
        // can glob-exclude them. They still load on demand through the
        // service-worker runtime cache when the user opens a code block.
        chunkFileNames(chunkInfo) {
          const id = chunkInfo.facadeModuleId ?? "";
          if (id.includes("@shikijs/langs/") || id.includes("@shikijs/themes/")) {
            return "assets/shiki-langs/[name]-[hash].js";
          }
          return "assets/[name]-[hash].js";
        },
        // Manual chunking — keeps the initial JS small and lets the heavy
        // visualization libraries lazy-load only when their blocks render.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@codemirror") || id.includes("@lezer")) return "vendor-codemirror";
          if (id.includes("@milkdown") || id.includes("prosemirror")) return "vendor-milkdown";
          if (id.includes("mermaid")) return "vendor-mermaid";
          if (id.includes("@hpcc-js/wasm")) return "vendor-graphviz";
          if (id.includes("echarts") || id.includes("zrender")) return "vendor-echarts";
          if (id.includes("leaflet")) return "vendor-leaflet";
          if (id.includes("katex")) return "vendor-katex";
          // Shiki's per-language and per-theme grammars live in
          // @shikijs/langs and @shikijs/themes and are imported dynamically
          // by shiki's web-bundle; let Rollup keep each one as its own
          // chunk so a doc that uses TypeScript+JSON only fetches those
          // two grammar chunks instead of the entire 9 MB language pack.
          if (id.includes("@shikijs/langs/")) return undefined;
          if (id.includes("@shikijs/themes/")) return undefined;
          if (id.includes("shiki") || id.includes("@shikijs")) return "vendor-shiki";
          if (id.includes("isomorphic-git") || id.includes("lightning-fs")) return "vendor-git";
          if (id.includes("tldraw") || id.includes("@tldraw")) return "vendor-tldraw";
          if (id.includes("yjs") || id.includes("y-")) return "vendor-yjs";
          if (id.includes("react-dom")) return "vendor-react-dom";
          if (id.includes("/react/")) return "vendor-react";
          return undefined;
        },
      },
    },
  },
  // ── Vitest ──────────────────────────────────────────────────────────
  test: {
    environment: "jsdom",
    include: ["src/__tests__/**/*.test.{ts,tsx}"],
    globals: true,
    css: false,
    setupFiles: ["src/__tests__/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "html", "json-summary"],
      reportsDirectory: "coverage",
      // Skip lazy-loaded vendor wrappers, build config, and the Tauri
      // / iOS native shells — they aren't unit-testable in jsdom.
      exclude: [
        "src/__tests__/**",
        "src/main.tsx",
        "src/App.tsx",
        "src/welcome.ts",
        "src/i18n/**",
        "src/plugins/EChart.tsx",
        "src/plugins/Model3DBlock.tsx",
        "src/plugins/MapBlock.tsx",
        "src/plugins/MermaidBlock.tsx",
        "src/plugins/HtmlPreviewBlock.tsx",
        "src/plugins/EmbedBlock.tsx",
        "src/ui/**",
        "src/editor/**",
        "src/layouts/**",
        "src/components/**",
        "src/views/DatabaseBlock.tsx",
        "src/renderer/components.tsx",
        "src/renderer/Preview.tsx",
        "src/renderer/Frontmatter.tsx",
      ],
    },
  },
});

