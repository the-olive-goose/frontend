import { defineConfig, devices } from "@playwright/test";

// Fallback config that drives the system-installed Google Chrome (channel:"chrome")
// instead of Playwright's bundled headless-shell download. Used when the bundled
// browser can't be provisioned in a sandbox. Same base URL / testDir as the main
// config; run with: npx playwright test -c playwright.chrome.config.ts
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  // These journeys share one seeded shopper account (cart + session are
  // server-side state), so they must run serially — parallel workers would let
  // one test's logout/cart-clear disrupt another's session.
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE ?? "http://localhost:8080",
    headless: true,
    channel: "chrome",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
  ],
});
