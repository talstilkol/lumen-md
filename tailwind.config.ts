import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        serif: [
          "Source Serif 4",
          "Iowan Old Style",
          "Apple Garamond",
          "Baskerville",
          "ui-serif",
          "serif",
        ],
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      colors: {
        bg: {
          DEFAULT: "hsl(var(--bg))",
          subtle: "hsl(var(--bg-subtle))",
          muted: "hsl(var(--bg-muted))",
          inset: "hsl(var(--bg-inset))",
        },
        fg: {
          DEFAULT: "hsl(var(--fg))",
          subtle: "hsl(var(--fg-subtle))",
          muted: "hsl(var(--fg-muted))",
        },
        border: {
          DEFAULT: "hsl(var(--border))",
          strong: "hsl(var(--border-strong))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          fg: "hsl(var(--accent-fg))",
        },
      },
      keyframes: {
        in: {
          from: { opacity: "0", transform: "translateY(2px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        in: "in 120ms ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
