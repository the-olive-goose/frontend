// One-command isolated e2e runner. Spins up an embedded Postgres, the test
// backend, and the Vite frontend; seeds content + fixtures; runs the Playwright
// suites; then tears everything down. Exits non-zero if any suite fails.
//
//   npm run test:e2e
//
// Why two phases: most suites log in many times and load hundreds of content
// endpoints, so they need the rate limiters raised (AUTH_/API_RATE_LIMIT_MAX).
// But payment-security.spec asserts the auth limiter *does* throttle a brute
// force — so it runs against a backend with the default 20/15min auth limit.
import { spawn, spawnSync } from "child_process";
import { readFileSync, existsSync, rmSync } from "fs";
import path from "path";
import net from "net";
import {
  REPO_ROOT, TEST_DATABASE_URL, SEED_SOURCE_DATABASE_URL, BACKEND_PORT, FRONTEND_PORT,
  API_URL, BASE_URL, ADMIN, ADMIN_PASSWORD_HASH,
} from "./setup/config.mjs";
import { startPg } from "./setup/pg.mjs";

const BACKEND_ENTRY = path.join(REPO_ROOT, "backend", "index.js");
const children = [];
let pg;

function log(msg) { console.log(`\x1b[36m[e2e]\x1b[0m ${msg}`); }

// Pull STRIPE_SECRET_KEY (+ optional SEED source) out of backend/.env so the
// checkout journey can create real test-mode Stripe sessions.
function backendEnvValue(key) {
  const envPath = path.join(REPO_ROOT, "backend", ".env");
  if (!existsSync(envPath)) return undefined;
  const line = readFileSync(envPath, "utf8").split("\n").find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim().replace(/^["']|["']$/g, "") : undefined;
}

function waitForPort(port, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const sock = net.connect(port, "127.0.0.1");
      sock.once("connect", () => { sock.destroy(); resolve(); });
      sock.once("error", () => {
        sock.destroy();
        if (Date.now() > deadline) reject(new Error(`port ${port} not up after ${timeoutMs}ms`));
        else setTimeout(tryOnce, 300);
      });
    };
    tryOnce();
  });
}

function killPort(port) {
  const out = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" });
  for (const pid of out.stdout.split("\n").filter(Boolean)) {
    try { process.kill(Number(pid), "SIGTERM"); } catch { /* already gone */ }
  }
}

function startBackend(extraEnv) {
  killPort(BACKEND_PORT);
  const child = spawn(process.execPath, [BACKEND_ENTRY], {
    cwd: path.join(REPO_ROOT, "backend"),
    env: {
      ...process.env,
      PORT: String(BACKEND_PORT),
      DATABASE_URL: TEST_DATABASE_URL,
      JWT_SECRET: "e2e-isolated-secret",
      ADMIN_EMAIL: ADMIN.email,
      ADMIN_PASSWORD_HASH,
      RESEND_API_KEY: "",
      STRIPE_SECRET_KEY: backendEnvValue("STRIPE_SECRET_KEY") || "",
      FRONTEND_URL: BASE_URL,
      ...extraEnv,
    },
    stdio: "inherit",
  });
  children.push(child);
  return child;
}

function startFrontend() {
  const child = spawn("npx", ["vite", "--port", String(FRONTEND_PORT), "--strictPort"], {
    cwd: REPO_ROOT,
    env: { ...process.env, VITE_API_URL: API_URL },
    stdio: "ignore",
  });
  children.push(child);
  return child;
}

function seed(mode) {
  const res = spawnSync(process.execPath, [path.join(REPO_ROOT, "e2e", "setup", "seed.mjs"), mode], {
    stdio: "inherit",
    env: { ...process.env, SEED_SOURCE_DATABASE_URL: SEED_SOURCE_DATABASE_URL || backendEnvValue("DATABASE_URL") || "" },
  });
  if (res.status !== 0) throw new Error(`seed (${mode}) failed`);
}

function runPlaywright(specs, extraEnv) {
  const res = spawnSync(
    "npx",
    ["playwright", "test", "-c", "playwright.e2e.config.ts", ...specs, "--reporter=list"],
    {
      cwd: REPO_ROOT,
      stdio: "inherit",
      env: {
        ...process.env,
        E2E_BASE: BASE_URL, E2E_API: API_URL,
        E2E_ADMIN_EMAIL: ADMIN.email, E2E_ADMIN_PASSWORD: ADMIN.password,
        // Test-mode Stripe key so the discount spec can retrieve a Checkout
        // Session and assert the discount actually reached the payment amount.
        STRIPE_SECRET_KEY: backendEnvValue("STRIPE_SECRET_KEY") || "",
        ...extraEnv,
      },
    }
  );
  return res.status === 0;
}

async function teardown() {
  log("tearing down…");
  killPort(BACKEND_PORT);
  killPort(FRONTEND_PORT);
  for (const c of children) { try { c.kill("SIGTERM"); } catch { /* ignore */ } }
  if (pg) { try { await pg.stop(); } catch { /* ignore */ } }
}

async function main() {
  const keepData = process.argv.includes("--keep-data");
  // Optional spec filter: `npm run test:e2e -- e2e/offer-copy.spec.ts`. Runs just
  // those files in phase 1 and skips phase 2, so failure artifacts survive for
  // inspection. No arguments = the full two-phase run.
  const only = process.argv.slice(2).filter((a) => a.endsWith(".spec.ts"));
  if (!keepData && existsSync(path.join(REPO_ROOT, ".e2e-pgdata"))) {
    rmSync(path.join(REPO_ROOT, ".e2e-pgdata"), { recursive: true, force: true });
  }

  log("starting embedded Postgres…");
  pg = await startPg();

  log("starting backend (schema init) + frontend…");
  // First boot creates the schema and seeds the admin; then seed content/users.
  const boot = startBackend({
    AUTH_RATE_LIMIT_MAX: "100000", API_RATE_LIMIT_MAX: "100000",
    PUBLIC_WRITE_RATE_LIMIT_MAX: "100000", OTP_RATE_LIMIT_MAX: "100000",
    // The discount suite tries far more codes from one IP than the 20/15min
    // anti-enumeration budget a real shopper ever would.
    DISCOUNT_VALIDATE_RATE_LIMIT_MAX: "100000",
  });
  await waitForPort(BACKEND_PORT);
  startFrontend();
  await waitForPort(FRONTEND_PORT);

  log("seeding content + users + fixtures…");
  seed("full");

  let ok = true;

  // Phase 1 — login-heavy + admin/API suites, rate limiters raised.
  log(only.length
    ? `PHASE 1 (scoped): ${only.join(", ")}`
    : "PHASE 1: storefront + customer + admin suites (raised limits)");
  ok = runPlaywright(
    only.length ? only : [
      "e2e/olive-goose.spec.ts", "e2e/auth-journey.spec.ts",
      "e2e/customer-journey.spec.ts", "e2e/mobile-journey.spec.ts",
      "e2e/admin-journey.spec.ts", "e2e/admin-payment-status.spec.ts",
      "e2e/discount-codes.spec.ts", "e2e/bundle-discounts.spec.ts",
      "e2e/checkout-edge-cases.spec.ts", "e2e/offer-copy.spec.ts",
      "e2e/video-reel.spec.ts",
    ],
    {}
  ) && ok;

  // A scoped run stops here. Phase 2 restarts the backend and starts a SECOND
  // playwright run, which clears test-results/ on startup — that wipes the traces
  // and screenshots phase 1 just wrote, exactly when you are trying to read them.
  if (only.length) return ok;

  // Phase 2 — payment-security on the DEFAULT auth limit so its throttling
  // assertion holds. Restart the backend without AUTH_RATE_LIMIT_MAX.
  log("PHASE 2: payment-security (default auth limit)");
  boot.kill("SIGTERM");
  killPort(BACKEND_PORT);
  startBackend({ API_RATE_LIMIT_MAX: "100000", DISCOUNT_VALIDATE_RATE_LIMIT_MAX: "100000" }); // auth limit left at its 20/15min default
  await waitForPort(BACKEND_PORT);
  ok = runPlaywright(["e2e/payment-security.spec.ts"], { E2E_SKIP_SEED: "1" }) && ok;

  return ok;
}

let success = false;
try {
  success = await main();
} catch (err) {
  console.error("[e2e] runner error:", err);
  success = false;
} finally {
  await teardown();
}
log(success ? "ALL SUITES PASSED ✅" : "SOME SUITES FAILED ❌");
process.exit(success ? 0 : 1);
