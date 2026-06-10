/// <reference types="vitest" />
import { defineConfig as defineViteConfig } from "vite";
import type { UserConfig as ViteUserConfig } from "vite";

interface VitestConfig {
  test?: {
    environment?: string;
    include?: string[];
    globals?: boolean;
    css?: boolean;
    setupFiles?: string[];
    alias?: Record<string, string>;
    coverage?: {
      provider?: "v8" | "istanbul";
      reporter?: string[];
      reportsDirectory?: string;
      include?: string[];
      exclude?: string[];
    };
  };
}

const defineConfig = (config: ViteUserConfig & VitestConfig) =>
  defineViteConfig(config as ViteUserConfig);
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";
import { existsSync } from "node:fs";

// y-websocket is an OPTIONAL peer dep. If the user has installed it
// (i.e. `node_modules/y-websocket` exists), Vite resolves the import
// normally. Otherwise we alias to a no-op stub so the dev server +
// production build don't fail on the unresolved import — the runtime
// try/catch in src/collab/yjs.ts handles the no-op cleanly.
const yWebsocketInstalled = existsSync(
  path.resolve(__dirname, "node_modules/y-websocket"),
);

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
        // Only precache small core files at install time. Heavy on-demand
        // vendor chunks (Mermaid, tldraw, ECharts, Graphviz, CodeMirror,
        // Milkdown) are fetched lazily by the runtime cache when first used.
        // This keeps the initial SW install under ~2 MB instead of ~12 MB.
        maximumFileSizeToCacheInBytes: 1024 * 1024,
        globPatterns: ["**/*.{js,css,html,svg,wasm,woff2}"],
        // Exclude heavy vendor chunks that are loaded on-demand via dynamic
        // import — these will be cached at runtime when first fetched.
        globIgnores: [
          "**/vendor-shiki-*.js",
          "**/shiki-langs/**",
          "**/vendor-mermaid-*.js",
          "**/vendor-tldraw-*.js",
          "**/vendor-echarts-*.js",
          "**/vendor-graphviz-*.js",
          "**/vendor-codemirror-*.js",
          "**/vendor-milkdown-*.js",
          "**/vendor-leaflet-*.js",
          "**/vendor-katex-*.js",
          "**/vendor-git-*.js",
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
          {
            // Large on-demand vendor chunks (Mermaid, tldraw, ECharts, etc.)
            // Cached at runtime when first loaded via dynamic import.
            urlPattern: ({ url }) =>
              url.origin === self.location.origin &&
              /\/assets\/vendor-(mermaid|tldraw|echarts|graphviz|codemirror|milkdown|leaflet|katex|git|yjs|react|react-dom)-/.test(url.pathname),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "lumen-vendor-chunks",
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
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
      // y-websocket is OPTIONAL — only alias to the stub when the real
      // package isn't installed. This way deployments that DO install
      // y-websocket explicitly still get the real implementation, while
      // bare `npm install` (most users, all CI runs) doesn't crash on
      // the unresolved import. In test mode the test-level vi.mock
      // overrides whichever resolution wins here.
      ...(yWebsocketInstalled
        ? {}
        : {
            "y-websocket": path.resolve(
              __dirname,
              "src/__tests__/stubs/y-websocket.ts",
            ),
          }),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  // y-websocket is an optional peer-dep (see src/collab/yjs.ts). The
  // Rollup `external` covers prod builds, but Vite's dev server uses
  // esbuild dep-optimization which trips on the unresolved import. Tell
  // Vite to skip pre-bundling it; the dynamic `await import(...)` will
  // fail at runtime if the user hasn't installed the package, and the
  // existing try/catch falls back to WebRTC-only collab cleanly.
  optimizeDeps: {
    exclude: ["y-websocket"],
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
      // `y-websocket` is an OPTIONAL runtime dep (see comments in
      // src/collab/yjs.ts). It's not in package.json — users opt in by
      // installing it explicitly. Mark it external so Rollup doesn't
      // try to bundle it; if the user hasn't installed it, the dynamic
      // import in src/collab/yjs.ts catches the resolution failure and
      // the session falls back to WebRTC-only.
      external: ["y-websocket"],
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
          // Vite's tiny preload helper (a VIRTUAL module — no node_modules in
          // its id, so this must sit above the guard). Auto-placement parked
          // it inside vendor-shiki, which made that 258KB chunk a STATIC dep
          // of main; pin it to the always-eager react chunk instead.
          if (id.includes("vite/preload-helper") || id.includes("vite/modulepreload-polyfill"))
            return "vendor-react";
          if (!id.includes("node_modules")) return undefined;
          // ── Shared text-processing families get their own chunks ──
          // The eager preview pipeline uses remark/micromark/unified and
          // hast-util-to-html; the LAZY editors (milkdown, shiki) use them
          // too. Without explicit homes Rollup co-located these shared
          // modules inside vendor-milkdown / vendor-shiki, which made main
          // statically import those chunks and EXECUTE all of milkdown +
          // prosemirror + shiki at boot (~400KB gz) just to reach the
          // helpers. (Diagnosed via sourcemap residents, 2026-06-10.)
          if (/node_modules\/lodash(-es)?\//.test(id)) return "vendor-lodash";
          if (
            /node_modules\/(micromark|mdast-util-|remark-|rehype-(?!katex)|unified|vfile|unist-util-|hast-util-|html-void-elements|property-information|space-separated-tokens|comma-separated-tokens|web-namespaces|stringify-entities|character-entities|character-reference-invalid|is-(alphabetical|alphanumerical|decimal|hexadecimal|plain-obj)|bail|trough|devlop|extend|zwitch|ccount|longest-streak|markdown-table|escape-string-regexp|decode-named-character-reference)/.test(id)
          ) return "vendor-unified";
          if (id.includes("@floating-ui/")) return "vendor-floating";
          if (id.includes("@codemirror") || id.includes("@lezer")) return "vendor-codemirror";
          if (id.includes("@milkdown") || id.includes("prosemirror")) return "vendor-milkdown";
          if (id.includes("mermaid")) return "vendor-mermaid";
          if (id.includes("@hpcc-js/wasm")) return "vendor-graphviz";
          if (id.includes("echarts") || id.includes("zrender")) return "vendor-echarts";
          if (id.includes("leaflet")) return "vendor-leaflet";
          // KaTeX + its mhchem extension + rehype-katex all share the
          // same chunk. Without rehype-katex in the chunk, the
          // production build hit a TDZ error ("Cannot access 'xn'
          // before initialization") at the chunk boundary because
          // rehype-katex re-exports katex internals that mhchem mutates.
          if (
            id.includes("katex") ||
            id.includes("rehype-katex") ||
            id.includes("mathml-tag-names")
          ) return "vendor-katex";
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
          // Anchor `y-*` to node_modules/y-… so we don't accidentally
          // match lucide-react icon file paths that contain `y-` in
          // the filename (e.g. "y-axis.js"). Previously this broad
          // match pulled lucide-react into vendor-yjs, which then
          // cross-imported into vendor-katex and caused a Temporal
          // Dead Zone error at module init time.
          if (
            id.includes("/yjs/") ||
            id.includes("node_modules/yjs") ||
            /node_modules\/y-[a-z]/.test(id)
          ) return "vendor-yjs";
          // @sentry/react's path matches the "/react/" rule below; without
          // this guard the lazily-imported SDK is merged back into the
          // EAGER vendor-react chunk — and a dynamic import can't be
          // tree-shaken, so the full SDK doubled that chunk. Keep Sentry
          // in its own chunk: it loads lazily (or never, without a DSN).
          if (id.includes("@sentry")) return "vendor-sentry";
          // React and react-dom MUST live in the same chunk: they share
          // internal helpers and have a circular dependency that
          // breaks (TDZ "Cannot set properties of undefined") when
          // rollup splits them. Both are small + always loaded
          // together; splitting saves nothing in real-world apps.
          if (
            id.includes("/react-dom/") ||
            id.includes("/react/") ||
            id.includes("/scheduler/")
          ) return "vendor-react";
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
    // `y-websocket` is intentionally absent from package.json (loaded at
    // runtime via dynamic import in src/collab/yjs.ts; users opt in by
    // installing it explicitly). Without an alias, Vitest's import
    // analyzer can't resolve `import("y-websocket")` in CI, even though
    // the test file then does `vi.mock(...)` to replace it. The stub
    // gives the analyzer a real file to resolve; the test's vi.mock
    // still wins at runtime.
    alias: {
      "y-websocket": path.resolve(__dirname, "src/__tests__/stubs/y-websocket.ts"),
    },
    coverage: {
      provider: "v8",
      // HTML reporter was dropped in round-25 — istanbul's html writer
      // crashed with `ERR_INVALID_ARG_VALUE` when mirroring Vite's
      // null-byte-prefixed virtual modules (`\x00virtual:…`) under
      // `coverage/`. CI only needs the JSON summary for the >=60% gate;
      // the text-summary prints to the build log for humans. Anyone who
      // wants a clickable HTML drilldown can opt-in by adding "html"
      // back locally.
      reporter: ["text-summary", "json-summary"],
      reportsDirectory: "coverage",
      // Without `include`, v8 reports every JS file executed during tests
      // — including ~3500 node_modules entries that artificially inflate
      // the total. Worse, the inflation isn't deterministic across
      // environments: locally the ratio came out at 97 %, in CI's
      // minimal install it dropped to 37 % (same source code), tripping
      // the >=60 % gate. Scope coverage to first-party src/ only — that's
      // what the gate is actually measuring.
      include: ["src/**/*.{ts,tsx}"],
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

