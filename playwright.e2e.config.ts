import { defineConfig, devices } from "@playwright/test";

// Config for the isolated e2e stack (embedded Postgres + test backend/frontend),
// driven by `npm run test:e2e` (see e2e/run-e2e.mjs). Uses the system Chrome and
// runs serially — these journeys share seeded server-side state (carts, sessions,
// fixture orders), so parallel workers would corrupt each other. globalSetup
// re-seeds the OGE2E* fixture orders before the run.
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  globalSetup: "./e2e/setup/global-setup.mjs",
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE ?? "http://localhost:8081",
    headless: true,
    channel: "chrome",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } }],
});
