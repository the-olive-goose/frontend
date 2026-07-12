// Playwright globalSetup for the isolated e2e stack: re-creates the OGE2E*
// fixture orders before the run so suites that consume them one-way (admin
// cancellation/return flows) are repeatable. Runs once per `playwright test`
// invocation. Skipped when E2E_SKIP_SEED is set (e.g. the runner already seeded).
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

export default async function globalSetup() {
  if (process.env.E2E_SKIP_SEED) return;
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const seed = path.join(__dirname, "seed.mjs");
  const res = spawnSync(process.execPath, [seed, "fixtures"], {
    stdio: "inherit",
    env: process.env,
  });
  if (res.status !== 0) {
    throw new Error("[global-setup] fixture seeding failed — is the test DB up? (npm run e2e:up)");
  }
}
