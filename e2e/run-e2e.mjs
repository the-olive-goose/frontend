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

// ── The Conversions API, intercepted ──────────────────────────────────────────
//
// The Purchase is the one event nobody can produce by browsing: it is written by
// the server, from a Stripe-confirmed order, and it is the only one that carries
// money. So it is the one event most worth watching — and the only way to watch
// it is to be the endpoint.
//
// e2e/setup/meta-sink.mjs stands in for graph.facebook.com and records every call
// for e2e/__meta-purchase.spec.ts to reconcile against Stripe. It is not only a
// convenience: without it the backend posts e2e's fabricated orders to the real
// Meta, which is how a test run ends up as revenue in someone's ad account.
//
// Spawned as its own process, not run in here, because this process drives
// Playwright with spawnSync and is blocked for the whole run — see that file.
const META_SINK_PORT = Number(process.env.E2E_META_SINK_PORT) || 3057;
const META_SINK_FILE = path.join(REPO_ROOT, ".e2e-meta-sink.jsonl");

function startMetaSink() {
  killPort(META_SINK_PORT);
  const child = spawn(
    process.execPath,
    [path.join(REPO_ROOT, "e2e", "setup", "meta-sink.mjs"), String(META_SINK_PORT), META_SINK_FILE],
    { cwd: REPO_ROOT, stdio: "inherit" }
  );
  children.push(child);
  return child;
}

// ── Resend, intercepted ───────────────────────────────────────────────────────
// The abandoned-cart suite has to read the email that was actually built: its
// recipient, its subject, its List-Unsubscribe headers, the basket rows inside
// it and the tagged link out of it. With RESEND_API_KEY empty the sender only
// logs, and with a real key it mails a real person — so neither setting can be
// tested against. The backend takes RESEND_ORIGIN for this, and phase 1c points
// it here. A separate process for the same reason the Meta sink is one.
const EMAIL_SINK_PORT = Number(process.env.E2E_EMAIL_SINK_PORT) || 3058;
const EMAIL_SINK_FILE = path.join(REPO_ROOT, ".e2e-email-sink.jsonl");

/**
 * What the abandoned-cart suite needs from its backend: a sender it can read
 * (the sink), and a sweep fast enough to watch. Hoisted out of phase 1c because
 * a scoped run — `npm run test:e2e -- e2e/abandoned-cart.spec.ts` — has to boot
 * with the same environment or the suite tests a backend that cannot send.
 */
const abandonedCartEnv = () => ({
  RESEND_API_KEY: "e2e-sink-key",
  RESEND_ORIGIN: `http://127.0.0.1:${EMAIL_SINK_PORT}`,
  // Fast enough to watch, slow enough that one sweep finishes before the next.
  ABANDONED_CART_FIRST_RUN_MS: "2000",
  ABANDONED_CART_SWEEP_MS: "4000",
});

function startEmailSink() {
  killPort(EMAIL_SINK_PORT);
  const child = spawn(
    process.execPath,
    [path.join(REPO_ROOT, "e2e", "setup", "email-sink.mjs"), String(EMAIL_SINK_PORT), EMAIL_SINK_FILE],
    { cwd: REPO_ROOT, stdio: "inherit" }
  );
  children.push(child);
  return child;
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
      // The public origin the List-Unsubscribe header points at. Production
      // serves it on the storefront's own domain via the /api proxy; here the
      // API answers directly, so this is the API's address. Left unset it would
      // default to localhost:3001 — the DEV backend, which in this repo is
      // pointed at the production database — and the suite would assert a
      // one-click link aimed at the wrong server entirely.
      BACKEND_URL: API_URL,
      // In this stack the frontend under test IS the shop, so it is the origin
      // analytics counts as the storefront. Without this the backend falls back
      // to the real theolivegoose.ie, every visit the suite makes classifies as
      // "localhost", and the dashboard — which reports the storefront unless
      // asked for another hostname — correctly shows an empty shop.
      ANALYTICS_ORIGINS: BASE_URL,
      // Meta's Conversions API, pointed at the local sink above. Both are set
      // explicitly rather than inherited: a developer with META_CAPI_TOKEN in
      // their shell would otherwise hand this stack a credential for the shop's
      // real pixel, and the token has to be non-empty or reportPurchaseToMeta
      // returns before it ever builds a payload.
      META_GRAPH_ORIGIN: `http://127.0.0.1:${META_SINK_PORT}`,
      META_CAPI_TOKEN: "e2e-sink-token",
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
        // Where __meta-purchase.spec.ts reads back what the server actually sent
        // to Meta, to reconcile the revenue against what Stripe actually charged.
        META_SINK_FILE,
        // Where abandoned-cart.spec.ts reads back the emails the server built.
        EMAIL_SINK_FILE,
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

  log("starting Meta Conversions API sink…");
  startMetaSink();
  await waitForPort(META_SINK_PORT);

  log("starting email sink…");
  startEmailSink();
  await waitForPort(EMAIL_SINK_PORT);

  log("starting backend (schema init) + frontend…");
  // A scoped run of the abandoned-cart suite needs the email sink and the fast
  // sweep on THIS boot — it never reaches phase 1c, which is where they normally
  // come from.
  const scopedCart = only.some((f) => f.includes("abandoned-cart"));
  // First boot creates the schema and seeds the admin; then seed content/users.
  const boot = startBackend({
    AUTH_RATE_LIMIT_MAX: "100000", API_RATE_LIMIT_MAX: "100000",
    PUBLIC_WRITE_RATE_LIMIT_MAX: "100000", OTP_RATE_LIMIT_MAX: "100000",
    CHECKOUT_RATE_LIMIT_MAX: "100000",
    // Every page a suite opens beacons to /api/analytics/events, so the storefront
    // suites alone spend the 150/5min budget before the analytics tests run.
    ANALYTICS_RATE_LIMIT_MAX: "100000",
    // The discount suite tries far more codes from one IP than the 20/15min
    // anti-enumeration budget a real shopper ever would.
    DISCOUNT_VALIDATE_RATE_LIMIT_MAX: "100000",
    ...(scopedCart ? abandonedCartEnv() : {}),
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
      "e2e/olive-goose.spec.ts", "e2e/auth-journey.spec.ts", "e2e/session-management.spec.ts",
      "e2e/customer-journey.spec.ts", "e2e/mobile-journey.spec.ts",
      "e2e/admin-journey.spec.ts", "e2e/admin-payment-status.spec.ts",
      "e2e/discount-codes.spec.ts", "e2e/bundle-discounts.spec.ts",
      "e2e/checkout-edge-cases.spec.ts", "e2e/offer-copy.spec.ts",
      "e2e/video-reel.spec.ts",
    ],
    {}
  ) && ok;

  // A scoped run stops here. The later phases start a SECOND playwright run,
  // which clears test-results/ on startup — that wipes the traces and
  // screenshots phase 1 just wrote, exactly when you are trying to read them.
  if (only.length) return ok;

  // Phase 1b — admin-api on FRESH fixtures. It drives OGE2ECANA/CANB/RETURN
  // through the same one-way cancellation and return lifecycles admin-journey
  // does, so the two cannot share one seeding: whichever ran second would find
  // the order already cancelled. Its own playwright invocation re-runs
  // globalSetup, which re-creates the OGE2E* orders first.
  log("PHASE 1b: admin-api on re-seeded fixtures");
  ok = runPlaywright(["e2e/admin-api.spec.ts"], {}) && ok;

  // Phase 1c — abandoned carts, on a backend that can actually "send" email.
  //
  // Its own phase, and its own backend, for two reasons. RESEND_API_KEY has to be
  // non-empty here or every send returns delivered:false and the suite asserts
  // nothing — but the discount suite two phases up asserts the opposite
  // (email_delivered === false in dev mode), so the two cannot share one boot.
  // And the sweep is slowed to a quarter of an hour in production, which no test
  // can wait for, so this backend runs it every few seconds instead.
  log("PHASE 1c: abandoned carts (email sink + fast sweep)");
  boot.kill("SIGTERM");
  killPort(BACKEND_PORT);
  const cartBoot = startBackend({
    AUTH_RATE_LIMIT_MAX: "100000", API_RATE_LIMIT_MAX: "100000",
    PUBLIC_WRITE_RATE_LIMIT_MAX: "100000", OTP_RATE_LIMIT_MAX: "100000",
    CHECKOUT_RATE_LIMIT_MAX: "100000", ANALYTICS_RATE_LIMIT_MAX: "100000",
    DISCOUNT_VALIDATE_RATE_LIMIT_MAX: "100000",
    ...abandonedCartEnv(),
  });
  await waitForPort(BACKEND_PORT);
  ok = runPlaywright(["e2e/abandoned-cart.spec.ts"], { E2E_EMAIL_SINK_PORT: String(EMAIL_SINK_PORT) }) && ok;
  cartBoot.kill("SIGTERM");

  // Phase 2 — payment-security on the DEFAULT auth limit so its throttling
  // assertion holds. Restart the backend without AUTH_RATE_LIMIT_MAX.
  log("PHASE 2: payment-security (default auth limit)");
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
