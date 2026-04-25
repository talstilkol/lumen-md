/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["favicon.svg"],
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
          {
            src: "favicon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        // Generous limit so heavy WASM/lazy chunks (Mermaid, Graphviz, ECharts)
        // are precached on install for offline use.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        globPatterns: ["**/*.{js,css,html,svg,wasm,woff2}"],
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
  build: {
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        landing: path.resolve(__dirname, "public/landing.html"),
      },
    },
  },
  // ── Vitest ──────────────────────────────────────────────────────────
  test: {
    environment: "jsdom",
    include: ["src/__tests__/**/*.test.ts"],
    globals: true,
  },
});

