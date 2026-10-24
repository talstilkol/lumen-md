import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "/home/claude/wl37/e2e",
  workers: 1,
  reporter: "line",
  timeout: 60_000,
  use: { baseURL: "http://localhost:5292", trace: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions: { executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" } } }],
  webServer: { command: "npx vite --port 5292 --strictPort", cwd: "/home/claude/wl37", url: "http://localhost:5292", reuseExistingServer: false, timeout: 180_000 },
});
