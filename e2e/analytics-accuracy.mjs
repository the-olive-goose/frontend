// Accuracy regression suite for Ops → Analytics (GET /api/admin/analytics).
//
//   npm run test:analytics
//
// Boots the REAL backend against a throwaway embedded Postgres — real
// migrations, real route — then seeds a small dataset engineered so that each
// assertion below fails if a specific miscount comes back. Every check is
// pinned to a defect that has actually shipped once:
//
//   • device/source filters zeroing revenue, conversion and top products,
//     because server-written purchase rows carry no device/referrer;
//   • the 'server' sentinel session inflating sessions/visitors and collapsing
//     every untracked order into one "purchase";
//   • funnel stages counted independently, so later stages exceeded earlier ones;
//   • the device split double-counting sessions past 100%;
//   • bounce counting engaged single-page sessions;
//   • product revenue ignoring order discounts;
//   • day buckets resolved in UTC instead of the trading timezone;
//   • device class taken from viewport width, so narrow desktop windows were
//     reported as tablet traffic on a shop that has never had a tablet visitor;
//   • refunded returns never leaving revenue, because a return updates the
//     `returns` row and not orders.refund_status.
//
// Runs on its own ports and data dir, so it never collides with `npm run
// test:e2e`, and never reads backend/.env — DATABASE_URL is always the
// throwaway instance.
import { spawn, spawnSync } from "child_process";
import { createHmac } from "crypto";
import net from "net";
import path from "path";
import { rmSync } from "fs";
import { fileURLToPath } from "url";
import EmbeddedPostgres from "embedded-postgres";
import pgpkg from "pg";

const { Pool } = pgpkg;
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PG_PORT = Number(process.env.ANALYTICS_PG_PORT) || 5455;
const PG_DIR = path.join(REPO, ".analytics-pgdata");
const DB = `postgresql://postgres:postgres@localhost:${PG_PORT}/analytics_check`;
const PORT = Number(process.env.ANALYTICS_BACKEND_PORT) || 3055;
const API = `http://localhost:${PORT}`;
const ADMIN = { email: "analytics-check@test.local", password: "E2eAdmin123!" };
const ADMIN_HASH = "$2a$10$r.uiYaq6WeUsL5yheEzQ1Oup06Vq8wafTH/mlYWV88UPAEahfCpZi";
const TZ = "Europe/Dublin";
const COUNTED_ORIGIN = "https://shop.test"; // stands in for the live storefront

// The session cookie the backend issues, minted here rather than driving a real
// login — the assertions below are about what ingestion does with a signed-in
// visitor, not about how the visitor signed in. HS256 by hand keeps this file
// free of the backend's node_modules.
const sessionCookie = (userId) => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const data = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ userId, exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  return `og_session=${data}.${createHmac("sha256", "check-secret").update(data).digest("base64url")}`;
};

const kids = [];
let pg;
const fails = [];
// How many assertions actually executed. A run that asserts nothing is not a
// pass — see the exit path at the bottom of this file.
let checks = 0;
const ok = (name) => { checks++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); };
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) return ok(name);
  checks++;
  fails.push(`${name}\n      expected ${e}\n      actual   ${a}`);
  console.log(`  \x1b[31m✗\x1b[0m ${name} — expected ${e}, got ${a}`);
}

const waitPort = (port, ms = 60000) => new Promise((res, rej) => {
  const end = Date.now() + ms;
  const go = () => {
    const s = net.connect(port, "127.0.0.1");
    s.once("connect", () => { s.destroy(); res(); });
    s.once("error", () => { s.destroy(); Date.now() > end ? rej(new Error(`port ${port} down`)) : setTimeout(go, 300); });
  };
  go();
});

// ── Fixture dataset ──────────────────────────────────────────────────────────
// Days are relative to "today" in the store timezone so the 7-day window always
// covers them. dayOffset 1 = yesterday.
const todayTz = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });

// Minutes TZ is ahead of UTC at a given instant.
const tzOffsetMin = (ms) => {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hour12: false, year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).filter(x => x.type !== "literal").map(x => [x.type, x.value]));
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - ms) / 60000;
};

// A UTC instant for <hh:mm Dublin wall-clock> on the day `off` days before today.
const at = (off, hh, mm = 0) => {
  const ymd = new Date(Date.parse(`${todayTz()}T00:00:00Z`) - off * 86400000).toISOString().slice(0, 10);
  const naive = Date.parse(`${ymd}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`);
  let ts = naive - tzOffsetMin(naive) * 60000;
  ts = naive - tzOffsetMin(ts) * 60000; // one correction pass for DST edges
  return new Date(ts).toISOString();
};

async function seed(pool) {
  const uid = async (email) =>
    (await pool.query(`INSERT INTO users (email, full_name) VALUES ($1,'T') RETURNING id`, [email])).rows[0].id;
  const u1 = await uid("c1@test.local"), u2 = await uid("c2@test.local"), u3 = await uid("c3@test.local");

  // `scope` defaults to 'persistent' (cookie banner accepted) so the identity
  // coverage assertions can distinguish it from the opt-out case.
  const ev = (sid, vid, type, ts, o = {}) => pool.query(
    `INSERT INTO analytics_events (visitor_id, session_id, event_type, path, referrer, utm_source, utm_medium, utm_campaign, device, props, visitor_scope, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [vid, sid, type, o.path || "/", o.ref || "", o.src || "", o.med || "", o.camp || "", o.dev || "",
     JSON.stringify(o.props || {}), o.scope || "persistent", ts]
  );
  const order = (id, user, total, subtotal, discount, ts, items, extra = {}) => pool.query(
    `INSERT INTO orders (id, user_id, items, subtotal, shipping, total, discount_amount, tracking_number,
                         payment_status, refund_status, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id, user, JSON.stringify(items), subtotal, extra.shipping ?? 0, total, discount, `T-${id.slice(0, 6)}`,
     extra.payment || "paid", extra.refund || "not_applicable", ts]
  );
  const line = (pid, name, price, qty) => ({ product_id: pid, quantity: qty, product_data: { name, price: `€${price}` } });

  const O1 = "11111111-1111-4111-8111-111111111111";
  const O2 = "22222222-2222-4222-8222-222222222222";
  const O3 = "33333333-3333-4333-8333-333333333333";
  const O4 = "44444444-4444-4444-8444-444444444444";

  // S1 — desktop, google, the complete modern journey: every GA4 stage in order,
  // from browsing a collection to handing off to Stripe. Order has a €10 discount
  // on €110 of goods.
  await ev("s1", "v1", "page_view", at(3, 10), { path: "/", src: "google", dev: "desktop" });
  await ev("s1", "v1", "page_view", at(3, 10, 1), { path: "/shop", src: "google", dev: "desktop" });
  await ev("s1", "v1", "view_item_list", at(3, 10, 1), { path: "/shop", src: "google", dev: "desktop", props: { list_id: "all", item_count: 3 } });
  await ev("s1", "v1", "view_item", at(3, 10, 2), { path: "/products/candle-a", src: "google", dev: "desktop", props: { product_id: "p-a", name: "Candle A" } });
  await ev("s1", "v1", "add_to_cart", at(3, 10, 2), { src: "google", dev: "desktop", props: { product_id: "p-a", name: "Candle A" } });
  await ev("s1", "v1", "view_cart", at(3, 10, 3), { path: "/basket", src: "google", dev: "desktop", props: { total: 100, items: 2 } });
  await ev("s1", "v1", "checkout_gate", at(3, 10, 3), { path: "/basket", src: "google", dev: "desktop", props: { outcome: "passed", total: 100, items: 2 } });
  await ev("s1", "v1", "begin_checkout", at(3, 10, 3), { path: "/checkout", src: "google", dev: "desktop", props: { total: 100 } });
  await ev("s1", "v1", "add_shipping_info", at(3, 10, 3), { src: "google", dev: "desktop", props: { total: 100 } });
  await ev("s1", "v1", "add_payment_info", at(3, 10, 3), { src: "google", dev: "desktop", props: { total: 100 } });
  await order(O1, u1, 100, 110, 10, at(3, 10, 4), [line("p-a", "Candle A", 55, 2)]);
  await ev("s1", "v1", "purchase", at(3, 10, 4), { path: "/checkout/success", props: { order_id: O1, total: 100 } });

  // S2 — MOBILE, referred by www.instagram.com, lands straight on a product page
  // (never sees a collection) and buys. Trips: mobile-filter revenue, funnel
  // monotonicity — it must be credited with browsing despite never seeing a
  // list — www-stripping, non-direct source revenue.
  await ev("s2", "v2", "page_view", at(2, 12), { path: "/products/candle-b", ref: "https://www.instagram.com/p/xyz", dev: "mobile" });
  await ev("s2", "v2", "view_item", at(2, 12), { path: "/products/candle-b", ref: "https://www.instagram.com/p/xyz", dev: "mobile", props: { product_id: "p-b", name: "Candle B" } });
  await ev("s2", "v2", "add_to_cart", at(2, 12, 1), { path: "/products/candle-b", ref: "https://www.instagram.com/p/xyz", dev: "mobile", props: { product_id: "p-b", name: "Candle B" } });
  await ev("s2", "v2", "checkout_gate", at(2, 12, 1), { path: "/basket", ref: "https://www.instagram.com/p/xyz", dev: "mobile", props: { outcome: "signin_required", total: 50, items: 1 } });
  await ev("s2", "v2", "begin_checkout", at(2, 12, 2), { path: "/checkout", dev: "mobile", props: { total: 50 } });
  await ev("s2", "v2", "add_shipping_info", at(2, 12, 2), { dev: "mobile", props: { total: 50 } });
  await ev("s2", "v2", "add_payment_info", at(2, 12, 2), { dev: "mobile", props: { total: 50 } });
  await order(O2, u2, 50, 50, 0, at(2, 12, 3), [line("p-b", "Candle B", 50, 1)]);
  await ev("s2", "v2", "purchase", at(2, 12, 3), { path: "/checkout/success", props: { order_id: O2, total: 50 } });

  // S3 — mobile, direct, single page view, no engagement → a true bounce.
  await ev("s3", "v3", "page_view", at(2, 9), { path: "/", dev: "mobile" });

  // S4 — desktop/google, browses, reads a product and carts it, never buys.
  await ev("s4", "v4", "page_view", at(1, 14), { path: "/shop", src: "google", dev: "desktop" });
  await ev("s4", "v4", "view_item_list", at(1, 14), { path: "/shop", src: "google", dev: "desktop", props: { list_id: "all", item_count: 3 } });
  await ev("s4", "v4", "view_item", at(1, 14, 1), { path: "/products/candle-c", src: "google", dev: "desktop", props: { product_id: "p-c", name: "Candle C" } });
  await ev("s4", "v4", "add_to_cart", at(1, 14, 1), { src: "google", dev: "desktop", props: { product_id: "p-c", name: "Candle C" } });
  // Pressed "Proceed to Checkout" as a guest, was asked to make an account, and
  // left. Before checkout_gate existed this session was indistinguishable from
  // someone who idly abandoned the basket, so the cost of the gate was unknowable.
  await ev("s4", "v4", "checkout_gate", at(1, 14, 2), { path: "/basket", src: "google", dev: "desktop", props: { outcome: "signin_required", total: 40, items: 1 } });

  // S5 — desktop/google, gets as far as entering delivery details on a €75
  // basket and never reaches payment. This is the session that proves the two
  // deepest stages are distinct: it must appear in "Added delivery details"
  // and NOT in "Went to payment".
  await ev("s5", "v5", "page_view", at(1, 16), { path: "/", src: "google", dev: "desktop" });
  await ev("s5", "v5", "add_to_cart", at(1, 16, 1), { src: "google", dev: "desktop", props: { product_id: "p-a", name: "Candle A" } });
  await ev("s5", "v5", "view_cart", at(1, 16, 1), { path: "/basket", src: "google", dev: "desktop", props: { total: 75, items: 1 } });
  await ev("s5", "v5", "checkout_gate", at(1, 16, 1), { path: "/basket", src: "google", dev: "desktop", props: { outcome: "passed", total: 75, items: 1 } });
  await ev("s5", "v5", "begin_checkout", at(1, 16, 2), { path: "/checkout", src: "google", dev: "desktop", props: { total: 75 } });
  await ev("s5", "v5", "add_shipping_info", at(1, 16, 2), { src: "google", dev: "desktop", props: { total: 75 } });

  // O3 — a real paid order whose client never sent analytics ids: the purchase
  // event lands on the 'server' sentinel. Must not create a session/visitor.
  await order(O3, u3, 30, 30, 0, at(1, 18), [line("p-a", "Candle A", 30, 1)]);
  await pool.query(
    `INSERT INTO analytics_events (visitor_id, session_id, event_type, path, props, created_at)
     VALUES ('server','server','purchase','/checkout/success',$1,$2)`,
    [JSON.stringify({ order_id: O3, total: 30 }), at(1, 18)]
  );

  // O4 — refunded. Must be invisible to every revenue figure.
  await order(O4, u1, 999, 999, 0, at(2, 11), [line("p-a", "Candle A", 999, 1)], { refund: "refunded" });

  // S6 — 00:30 *Dublin* time yesterday (= 23:30 UTC the day before in summer).
  // Under UTC bucketing this lands on the wrong calendar day. Also the one
  // visitor who declined cookies, so their id dies with the tab.
  await ev("s6", "v6", "page_view", at(1, 0, 30), { path: "/", dev: "desktop", scope: "session" });

  // S7 — a LEGACY-shaped session, 20 days back so it falls outside both the
  // main window and the previous one it is compared against. It carries only the
  // events that existed before the GA4 vocabulary shipped: no view_item,
  // no view_cart, no add_shipping_info. It exists to prove two things about
  // historical data — that the path fallbacks still place it in the funnel, and
  // that the stages it could never have reported are omitted rather than shown
  // as zero (which would read as every shopper abandoning).
  await ev("s7", "v7", "page_view", at(20, 11), { path: "/shop", src: "google", dev: "desktop" });
  await ev("s7", "v7", "add_to_cart", at(20, 11, 1), { src: "google", dev: "desktop", props: { product_id: "p-a", name: "Candle A" } });
  await ev("s7", "v7", "page_view", at(20, 11, 2), { path: "/checkout", src: "google", dev: "desktop" });

  // S8 — 15 days back, in its own window: a session that BOUGHT but whose
  // begin_checkout never arrived (a beacon dropped on a hard reload). The funnel
  // credits it with reaching checkout, because a purchase proves it got there.
  // The abandonment card must agree — derived from begin_checkout alone it did
  // not, and the two disagreed on screen about how many people reached checkout.
  const O6 = "66666666-6666-4666-8666-666666666666";
  await ev("s8", "v8", "page_view", at(15, 11), { path: "/shop", src: "google", dev: "desktop" });
  await ev("s8", "v8", "view_item_list", at(15, 11), { path: "/shop", src: "google", dev: "desktop", props: { list_id: "all", item_count: 3 } });
  await ev("s8", "v8", "add_to_cart", at(15, 11, 1), { src: "google", dev: "desktop", props: { product_id: "p-a", name: "Candle A" } });
  await order(O6, u3, 40, 40, 0, at(15, 11, 2), [line("p-a", "Candle A", 40, 1)]);
  await ev("s8", "v8", "purchase", at(15, 11, 2), { path: "/checkout/success", props: { order_id: O6, total: 40 } });

  // O5 — paid in full, then one of its two lines returned and refunded. The
  // return never touches orders.refund_status, so this order still reads as
  // "paid, not refunded": revenue must drop by the returned line's value, and
  // that line's units must stop counting as sold.
  const O5 = "55555555-5555-4555-8555-555555555555";
  await order(O5, u1, 90, 90, 0, at(2, 15), [line("p-a", "Candle A", 60, 1), line("p-d", "Candle D", 30, 1)]);
  await pool.query(
    `INSERT INTO returns (order_id, user_id, product_id, product_name, reason, status)
     VALUES ($1, $2, 'p-d', 'Candle D', 'Changed my mind', 'refunded')`,
    [O5, u1]
  );
}

async function main() {
  rmSync(PG_DIR, { recursive: true, force: true });
  pg = new EmbeddedPostgres({ databaseDir: PG_DIR, user: "postgres", password: "postgres", port: PG_PORT, persistent: false });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("analytics_check");
  console.log("embedded postgres up");

  spawnSync("lsof", ["-nP", `-iTCP:${PORT}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" })
    .stdout.split("\n").filter(Boolean).forEach(p => { try { process.kill(+p, "SIGTERM"); } catch {} });

  const backend = spawn(process.execPath, [path.join(REPO, "backend", "index.js")], {
    cwd: path.join(REPO, "backend"),
    env: {
      ...process.env, PORT: String(PORT), DATABASE_URL: DB, JWT_SECRET: "check-secret",
      ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD_HASH: ADMIN_HASH, RESEND_API_KEY: "",
      STRIPE_SECRET_KEY: "", FRONTEND_URL: `http://localhost:8081,${COUNTED_ORIGIN}`, ANALYTICS_TZ: TZ,
      API_RATE_LIMIT_MAX: "100000", AUTH_RATE_LIMIT_MAX: "100000",
      // Left DELIBERATELY low so the per-visitor bucketing can be exercised for
      // real at the end of this file. High enough that the ~60 ingest calls the
      // rest of the suite makes (all on the no-edge-address fallback key) never
      // come near it.
      ANALYTICS_RATE_LIMIT_MAX: "200",
      // Stands in for theolivegoose.ie, so the origin gate is exercised against a
      // fixed value rather than whatever the live domain happens to be.
      ANALYTICS_ORIGINS: COUNTED_ORIGIN,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  kids.push(backend);
  backend.stderr.on("data", d => process.stderr.write(`[be] ${d}`));
  await waitPort(PORT);
  await new Promise(r => setTimeout(r, 2500)); // let migrations finish
  console.log("backend up\n");

  const pool = new Pool({ connectionString: DB });
  await seed(pool);

  const login = await fetch(`${API}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN.email, password: ADMIN.password }),
  });
  const cookie = (login.headers.getSetCookie?.() || []).map(c => c.split(";")[0]).join("; ");
  const body = await login.json();
  const auth = { Cookie: cookie, ...(body.token ? { Authorization: `Bearer ${body.token}` } : {}) };
  if (!login.ok) throw new Error(`admin login failed: ${JSON.stringify(body)}`);

  const today = todayTz();
  const start = new Date(Date.parse(`${today}T00:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10);
  const get = async (extra = "") => {
    const r = await fetch(`${API}/api/admin/analytics?start=${start}&end=${today}${extra}`, { headers: auth });
    const j = await r.json();
    if (!r.ok) throw new Error(`analytics ${r.status}: ${JSON.stringify(j)}`);
    return j;
  };

  // ── Unfiltered ──────────────────────────────────────────────────────────────
  console.log("\x1b[1munfiltered\x1b[0m");
  const d = await get();
  // Index-based, so a stage rename is a labelling change and not a silent
  // pass here — the counts are what this suite is guarding.
  const stage = (i) => d.funnel[i]?.sessions;

  eq("sessions exclude the 'server' sentinel", d.traffic.sessions, 6);
  eq("visitors exclude the 'server' sentinel", d.traffic.visitors, 6);
  eq("orders = all paid, non-refunded", d.sales.orders, 4);
  eq("revenue excludes the refunded order", d.sales.revenue, 240);
  eq("attributed_orders reports the tracking gap", d.sales.attributed_orders, 2);
  eq("funnel stage 1 == sessions KPI", stage(0), d.traffic.sessions);
  // The full GA4 funnel. s2 lands straight on a product and still counts as
  // having browsed (monotonic cascade); s5 enters delivery details but never
  // reaches payment, which is the one-session gap between stages 6 and 7.
  eq("funnel stages are named in journey order", d.funnel.map(f => f.stage), [
    "Sessions", "Browsed a collection", "Viewed a product", "Added to cart",
    "Viewed basket", "Pressed checkout", "Reached checkout", "Added delivery details",
    "Went to payment", "Purchased",
  ]);
  eq("browsed credits a straight-to-product session", stage(1), 4);
  eq("viewed a product", stage(2), 4);
  eq("added to cart", stage(3), 4);
  eq("viewed basket", stage(4), 4);
  // The stage the sign-in gate sits on. s4 pressed checkout and never reached
  // the page — that one-session gap between stages 5 and 6 IS the wall, and it
  // was invisible before this event existed.
  eq("pressed checkout", stage(5), 4);
  eq("reached checkout", stage(6), 3);
  eq("added delivery details", stage(7), 3);
  eq("went to payment excludes the shipping-only session", stage(8), 2);
  eq("purchased (sentinel excluded)", stage(9), 2);
  eq("funnel never widens", d.funnel.map(f => f.sessions), [6, 4, 4, 4, 4, 4, 3, 3, 2, 2]);
  // Belt and braces: whatever the stage list becomes, it must never increase.
  eq("every stage is <= the one above it",
    d.funnel.every((f, i) => i === 0 || f.sessions <= d.funnel[i - 1].sessions), true);
  eq("conversion = purchased / sessions", d.sales.conversion_rate, +(2 / 6 * 100).toFixed(2));
  eq("bounce counts only the unengaged single-pagers", d.traffic.bounce_rate, +(2 / 6 * 100).toFixed(1));
  eq("device split sums to sessions", d.devices.reduce((s, x) => s + x.sessions, 0), 6);
  eq("no phantom 'unknown' device", d.devices.filter(x => x.device === "unknown").length, 0);
  eq("desktop sessions", d.devices.find(x => x.device === "desktop")?.sessions, 4);
  eq("mobile sessions", d.devices.find(x => x.device === "mobile")?.sessions, 2);
  eq("abandoned at checkout", d.abandoned.abandoned_sessions, 1);
  eq("basket value walked away from", d.abandoned.lost_revenue, 75);
  // The card and the funnel are computed from the same predicate, so these must
  // be the same number — they used to be derived separately and could disagree
  // on screen about how many people reached checkout.
  eq("sessions reaching checkout", d.abandoned.checkout_sessions, 3);
  eq("abandonment card agrees with the funnel", d.abandoned.checkout_sessions,
    d.funnel.find(f => f.stage === "Reached checkout")?.sessions);

  // ── The sign-in gate ────────────────────────────────────────────────────────
  // s1 and s5 pressed checkout already signed in; s2 was asked to sign in, did,
  // and bought; s4 was asked and left. Without these the shop cannot tell what
  // requiring an account costs it, which is the decision this instrumentation
  // exists to inform.
  eq("gate sessions counted", d.signin_wall?.gate_sessions, 4);
  eq("guests asked to sign in", d.signin_wall?.walled_sessions, 2);
  eq("…who signed in and carried on", d.signin_wall?.walled_continued, 1);
  eq("…and bought", d.signin_wall?.walled_purchased, 1);
  eq("already-signed-in presses are the control group", d.signin_wall?.passed_sessions, 2);
  eq("…of whom this many bought", d.signin_wall?.passed_purchased, 1);
  // Only s4's basket: s2 got past the gate, so its €50 was never held up by it.
  eq("basket value held up at the gate", d.signin_wall?.blocked_basket_value, 40);

  const src = Object.fromEntries(d.sources.map(s => [s.source, s]));
  eq("instagram host is normalised (www stripped)", Object.keys(src).sort(), ["direct", "google", "instagram.com"]);
  eq("google revenue", src.google?.revenue, 100);
  eq("instagram revenue is not zeroed", src["instagram.com"]?.revenue, 50);
  eq("attribution sessions sum to sessions KPI", d.sources.reduce((s, x) => s + x.sessions, 0), 6);

  const prod = Object.fromEntries(d.top_products.map(p => [p.name, p]));
  eq("product revenue is net of the order discount", prod["Candle A"]?.revenue, 190); // 100 (O1, prorated) + 30 (O3) + 60 (O5)
  eq("cart-only product is still listed", prod["Candle C"]?.units, 0);
  eq("cart-only product shows its demand", prod["Candle C"]?.add_to_carts, 1);
  // Per-product conversion. Candle C was viewed once and carted once but never
  // bought: 100% view→cart, 0% cart→buy — the exact shape of a product whose
  // page sells well and whose checkout doesn't.
  eq("product views are counted per session", prod["Candle C"]?.views, 1);
  eq("view->cart rate", prod["Candle C"]?.view_to_cart_pct, 100);
  eq("cart->buy rate is 0, not null, when carts exist", prod["Candle C"]?.cart_to_buy_pct, 0);
  // Candle B was viewed once, carted once and bought once — a clean 100/100.
  eq("a converting product reports both rates",
    [prod["Candle B"]?.view_to_cart_pct, prod["Candle B"]?.cart_to_buy_pct], [100, 100]);
  // Never-viewed products must report an UNKNOWN rate, not 0% — 0 would read as
  // "everyone who looked rejected it" rather than "nobody looked".
  eq("an unviewed product's rate is null, never 0", prod["Candle D"]?.view_to_cart_pct ?? null, null);
  eq("product revenue sums to revenue minus shipping", +d.top_products.reduce((s, p) => s + p.revenue, 0).toFixed(2), 240);

  const yday = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const dayBefore = new Date(Date.parse(`${today}T00:00:00Z`) - 2 * 86400000).toISOString().slice(0, 10);
  eq("00:30 Dublin lands on the right calendar day",
    d.daily.find(r => r.day === yday)?.sessions, 3); // s4, s5, s6
  eq("daily revenue matches its orders", d.daily.find(r => r.day === dayBefore)?.revenue, 110); // O2 €50 + O5 net €60
  eq("daily revenue sums to the revenue KPI", +d.daily.reduce((s, r) => s + r.revenue, 0).toFixed(2), d.sales.revenue);
  eq("daily sessions never exceed the KPI", d.daily.reduce((s, r) => s + r.sessions, 0) <= d.traffic.sessions + 1, true);
  eq("timezone is reported", d.timezone, TZ);

  // ── Returns: money handed back must leave revenue ───────────────────────────
  // O5 was €90 with a €30 line returned and refunded. The return updates the
  // `returns` row, never orders.refund_status, so the order still reads "paid,
  // not refunded" — it used to count at its full €90.
  eq("a refunded return is deducted from revenue", d.sales.revenue, 240); // not 270
  eq("AOV uses the net order value", d.sales.aov, 60);
  eq("a returned line stops counting as sold", d.top_products.find(p => p.name === "Candle D"), undefined);
  eq("the kept line of a part-returned order still counts", prod["Candle A"]?.units, 4);

  // ── Visitor identity coverage ───────────────────────────────────────────────
  // 5 of 6 visitors accepted cookies; v6 declined, so their id dies with the tab
  // and they can never be recognised as returning.
  eq("identity coverage is reported", d.traffic.identified_visitor_pct, +(5 / 6 * 100).toFixed(1));

  // ── device=mobile — the filter that used to zero everything ─────────────────
  console.log("\n\x1b[1mdevice=mobile\x1b[0m");
  const m = await get("&device=mobile");
  eq("revenue is NOT zeroed by the device filter", m.sales.revenue, 50);
  eq("orders under filter", m.sales.orders, 1);
  eq("sessions under filter", m.traffic.sessions, 2);
  eq("purchased stage is not zero", m.funnel.at(-1)?.sessions, 1);
  eq("conversion under filter", m.sales.conversion_rate, 50);
  eq("abandonment is not 100%", m.abandoned.abandoned_sessions, 0);
  eq("top products survive the filter", m.top_products.find(p => p.name === "Candle B")?.revenue, 50);
  eq("filtered revenue is a subset of unfiltered", m.sales.revenue <= d.sales.revenue, true);
  eq("filtered daily revenue matches", +m.daily.reduce((s, r) => s + r.revenue, 0).toFixed(2), 50);

  // ── source=google ───────────────────────────────────────────────────────────
  console.log("\n\x1b[1msource=google\x1b[0m");
  const g = await get("&source=google");
  eq("google sessions", g.traffic.sessions, 3);
  eq("google revenue is NOT zeroed", g.sales.revenue, 100);
  eq("google orders", g.sales.orders, 1);
  eq("google abandoned at checkout", g.abandoned.abandoned_sessions, 1);

  // ── source=instagram.com — mid-session referrer loss must not split it ──────
  console.log("\n\x1b[1msource=instagram.com\x1b[0m");
  const i = await get("&source=instagram.com");
  eq("session attributed by landing, not per row", i.traffic.sessions, 1);
  eq("revenue survives the purchase row having no referrer", i.sales.revenue, 50);

  // ── attr=medium / campaign still work ───────────────────────────────────────
  console.log("\n\x1b[1mattr switches\x1b[0m");
  for (const a of ["medium", "campaign"]) {
    const r = await get(`&attr=${a}`);
    eq(`attr=${a} returns rows summing to sessions`, r.sources.reduce((s, x) => s + x.sessions, 0), 6);
  }

  // ── Device classification at ingestion ──────────────────────────────────────
  // The reported bug: a shop with no tablet visitors showed tablet traffic,
  // because the class came from window.innerWidth and anything 768–1023px was
  // called a tablet — a half-screen desktop window, a laptop at 125% zoom, a
  // phone in landscape. It now comes from the User-Agent, which the browser
  // cannot be wrong about. Each case posts through the real ingestion route and
  // reads back what was stored.
  console.log("\n\x1b[1mdevice classification\x1b[0m");
  const UA = {
    win: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    ipad: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    androidPhone: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36",
    androidTablet: "Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  };
  const ingest = async (sid, ua, hint) => {
    const r = await fetch(`${API}/api/analytics/events`, {
      method: "POST", headers: { "Content-Type": "application/json", "User-Agent": ua },
      body: JSON.stringify({
        visitor_id: sid, session_id: sid, visitor_scope: "persistent",
        events: [{ type: "page_view", path: "/", device: hint ?? "" }],
      }),
    });
    if (r.status !== 204) throw new Error(`ingest ${r.status}`);
    const q = await pool.query(`SELECT device FROM analytics_events WHERE session_id = $1 LIMIT 1`, [sid]);
    return q.rows[0]?.device;
  };

  // The exact reported failure: a desktop browser in a narrow window. The old
  // width rule stored "tablet"; the UA says Windows.
  eq("narrow desktop window is NOT a tablet", await ingest("ua-win-narrow", UA.win, "tablet"), "desktop");
  eq("desktop with no hint", await ingest("ua-win-plain", UA.win, ""), "desktop");
  eq("mac desktop", await ingest("ua-mac-desktop", UA.mac, ""), "desktop");
  eq("iPhone is mobile", await ingest("ua-iphone-safari", UA.iphone, ""), "mobile");
  eq("iPad is tablet", await ingest("ua-ipad-safari", UA.ipad, ""), "tablet");
  eq("Android phone is mobile", await ingest("ua-android-phone", UA.androidPhone, ""), "mobile");
  eq("Android tablet is tablet", await ingest("ua-android-tablet", UA.androidTablet, ""), "tablet");
  // iPadOS 13+ requests desktop sites and sends a macOS UA; only the client's
  // touch hint can tell it apart from a real Mac.
  eq("iPad in desktop mode is tablet via the touch hint", await ingest("ua-ipad-desktop-mode", UA.mac, "tablet"), "tablet");
  // A phone-width viewport must not be able to talk the server out of the UA.
  eq("a hint cannot override a phone UA", await ingest("ua-iphone-badhint", UA.iphone, "desktop"), "mobile");

  // ── previous-period comparison ──────────────────────────────────────────────
  console.log("\n\x1b[1mprevious period\x1b[0m");
  const p = await get();
  eq("previous window is empty (no data seeded there)", p.traffic.prev.sessions, 0);
  eq("previous revenue is zero", p.sales.prev.revenue, 0);

  // ── Historical data, before the GA4 events existed ──────────────────────────
  // A window containing only legacy-shaped events (S7). The path fallbacks must
  // still place it in the funnel, and the stages that could not have been
  // recorded then must be ABSENT — a zero there would be read as every shopper
  // abandoning at delivery details, and acted on.
  console.log("\n\x1b[1mlegacy window (pre-GA4-events)\x1b[0m");
  const legacyDay = new Date(Date.parse(`${today}T00:00:00Z`) - 20 * 86400000).toISOString().slice(0, 10);
  const legacyRes = await fetch(`${API}/api/admin/analytics?start=${legacyDay}&end=${legacyDay}`, { headers: auth });
  const L = await legacyRes.json();
  const legacyStages = L.funnel.map(f => f.stage);
  eq("a legacy session is still counted", L.traffic.sessions, 1);
  eq("the /shop page_view fallback still credits browsing",
    L.funnel.find(f => f.stage === "Browsed a collection")?.sessions, 1);
  eq("the /checkout page_view fallback still credits checkout",
    L.funnel.find(f => f.stage === "Reached checkout")?.sessions, 1);
  eq("uninstrumented stages are omitted, not zeroed",
    legacyStages.includes("Added delivery details") || legacyStages.includes("Went to payment"), false);
  eq("the legacy funnel is still monotonic",
    L.funnel.every((f, i) => i === 0 || f.sessions <= L.funnel[i - 1].sessions), true);

  // ── A session whose checkout event never arrived ────────────────────────────
  // S8 bought without a begin_checkout (dropped beacon). The funnel credits it
  // with reaching checkout — a purchase is proof it got there — so the
  // abandonment card, which the panel says is "the same sessions", has to agree.
  // Derived from begin_checkout alone it reported 0 against the funnel's 1.
  console.log("\n\x1b[1mlossy session (purchase, no begin_checkout)\x1b[0m");
  const lossyDay = new Date(Date.parse(`${today}T00:00:00Z`) - 15 * 86400000).toISOString().slice(0, 10);
  const X = await (await fetch(`${API}/api/admin/analytics?start=${lossyDay}&end=${lossyDay}`, { headers: auth })).json();
  const reachedX = X.funnel.find(f => f.stage === "Reached checkout")?.sessions;
  eq("a purchase alone still credits reaching checkout", reachedX, 1);
  eq("the abandonment card agrees with it", X.abandoned.checkout_sessions, reachedX);
  eq("a session that bought is not counted as abandoned", X.abandoned.abandoned_sessions, 0);
  eq("no phantom lost revenue", X.abandoned.lost_revenue, 0);
  eq("the gate stage is omitted where the event never fired",
    X.funnel.some(f => f.stage === "Pressed checkout"), false);
  eq("no sign-in gate block without gate events", X.signin_wall, null);
  eq("that window's funnel is still monotonic",
    X.funnel.every((f, i) => i === 0 || f.sessions <= X.funnel[i - 1].sessions), true);

  // ── Whose visits count ──────────────────────────────────────────────────────
  // The reported symptom: one person testing the shop for an hour arrived as six
  // visitors. Nothing was miscounted — a "visitor" is an id in a browser's
  // localStorage, and localStorage is per-origin, so the shop answering to four
  // hostnames (the domain, the Railway service that serves the same SPA, deploy
  // previews, and a developer's localhost pointed at this same database) minted
  // a fresh visitor on each. The owner's own testing then did the rest.
  console.log("\n\x1b[1mwhose visits count\x1b[0m");

  const rowsFor = async (visitor) =>
    (await pool.query(`SELECT COUNT(*)::int AS n FROM analytics_events WHERE visitor_id = $1`, [visitor])).rows[0].n;

  const send = async (visitor, origin, extraHeaders = {}) => {
    const r = await fetch(`${API}/api/analytics/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}), ...extraHeaders },
      body: JSON.stringify({
        visitor_id: visitor, session_id: visitor, visitor_scope: "persistent",
        events: [{ type: "page_view", path: "/" }],
      }),
    });
    // 403 is the CORS layer refusing an origin the shop doesn't serve, which is
    // the earlier of the two ways a stray hostname is turned away. Both end in
    // no row, and no row is what these checks are actually about.
    if (![204, 403].includes(r.status)) throw new Error(`ingest ${r.status}`);
    return rowsFor(visitor);
  };

  eq("the real storefront is counted", await send("origin-real", COUNTED_ORIGIN), 1);
  eq("localhost pointed at this database is not", await send("origin-localhost", "http://localhost:8080"), 0);
  eq("the Railway hostname serving the same SPA is not", await send("origin-railway", "https://frontend-production-a1bd.up.railway.app"), 0);
  eq("a deploy preview is not", await send("origin-preview", "https://deploy-preview-12--og.netlify.app"), 0);
  // Fails open on purpose: if a proxy ever stops forwarding the header the shop
  // must keep measuring itself rather than silently report zero traffic.
  eq("an unreadable origin is kept, not dropped", await send("origin-absent", null), 1);
  eq("…and the origin is stored, so this stays answerable",
    (await pool.query(`SELECT origin FROM analytics_events WHERE visitor_id = 'origin-real'`)).rows[0].origin,
    COUNTED_ORIGIN);

  const visitors = async () => (await get()).traffic.visitors;
  const baseline = await visitors();

  // A browser the owner marks in Admin → Analytics. The exclusion keys on the
  // visitor, so it has to retire what that browser already sent — marking it
  // only from now on would leave the inflated number on screen.
  await send("owner-phone", COUNTED_ORIGIN);
  eq("an unmarked browser is a visitor", await visitors(), baseline + 1);
  const mark = await fetch(`${API}/api/admin/analytics/internal/browser`, {
    method: "POST", headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ visitor_id: "owner-phone" }),
  });
  eq("marking the browser succeeds", mark.status, 200);
  eq("…and takes its whole history with it", await visitors(), baseline);
  eq("…and it stops being recorded at all", await send("owner-phone", COUNTED_ORIGIN), 1);

  // The account route. It matters that this reaches BACKWARDS: a test checkout
  // is anonymous browsing followed by a sign-in, and only the sign-in identifies
  // it — so the page views before it are just as much the shop's own traffic.
  const ownerId = (await pool.query(
    `INSERT INTO users (email, full_name) VALUES ('owner@test.local','Owner') RETURNING id`
  )).rows[0].id;
  await send("owner-laptop", COUNTED_ORIGIN);
  await send("owner-laptop", COUNTED_ORIGIN);
  const withOwner = await visitors();
  const saved = await fetch(`${API}/api/admin/analytics/internal`, {
    method: "PUT", headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ emails: ["owner@test.local", "not-an-email", "OTHER@Test.Local"] }),
  });
  eq("the account list saves, normalised and validated",
    (await saved.json()).emails, ["owner@test.local", "other@test.local"]);
  await send("owner-laptop", COUNTED_ORIGIN, { Cookie: sessionCookie(ownerId) });
  eq("signing in as an internal account retires that browser's earlier browsing too",
    await visitors(), withOwner - 1);
  eq("…and nothing new is stored for it", await rowsFor("owner-laptop"), 2);

  // A customer who happens to be signed in is still a customer.
  const shopper = (await pool.query(`SELECT id FROM users WHERE email = 'c1@test.local'`)).rows[0].id;
  const after = await visitors();
  await send("real-shopper", COUNTED_ORIGIN, { Cookie: sessionCookie(shopper) });
  eq("a signed-in customer is not excluded", await visitors(), after + 1);

  // ── The shop's own money ────────────────────────────────────────────────────
  // Browsing lives in analytics_events, but MONEY lives in the orders table, and
  // the internal-traffic exclusion does not reach across on its own. Until it
  // did, a €0.20 test checkout landed in Revenue, in average order value, in the
  // customer count, and at the top of Top products under the name "Test Product".
  // That is the figure an owner shows an investor.
  console.log("\n\x1b[1mthe shop's own money\x1b[0m");

  // Set the list this section depends on explicitly rather than relying on what
  // an earlier check left behind — including the '@domain' form, which is how
  // the shop keeps QA accounts out without naming each one.
  await fetch(`${API}/api/admin/analytics/internal`, {
    method: "PUT", headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ emails: ["owner@test.local", "@olivegoose-test.local"] }),
  });

  const beforeMoney = await get();

  // An order placed by an account on the internal list, and one by a QA-harness
  // account matched only by its domain.
  const ownerBuyer = (await pool.query(
    `SELECT id FROM users WHERE email = 'owner@test.local'`
  )).rows[0].id;
  const qaBuyer = (await pool.query(
    `INSERT INTO users (email, full_name) VALUES ('qa.bot@olivegoose-test.local','QA') RETURNING id`
  )).rows[0].id;

  const internalOrder = async (id, user, total) => pool.query(
    `INSERT INTO orders (id, user_id, items, subtotal, shipping, total, discount_amount,
                         tracking_number, payment_status, refund_status, created_at)
     VALUES ($1,$2,$3,$4,0,$4,0,'T-INT','paid','not_applicable',$5)`,
    [id, user, JSON.stringify([{ product_id: "test-1", quantity: 1,
        product_data: { name: "Test Product 1", price: "€" + total } }]), total, at(2, 12)]
  );
  await internalOrder("aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", ownerBuyer, 999);
  await internalOrder("bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb", qaBuyer, 888);

  const afterMoney = await get();

  eq("a test order does not become revenue", afterMoney.sales.revenue, beforeMoney.sales.revenue);
  eq("…nor an order", afterMoney.sales.orders, beforeMoney.sales.orders);
  eq("…nor moves average order value", afterMoney.sales.aov, beforeMoney.sales.aov);
  eq("…nor creates a customer", afterMoney.customers.total_customers, beforeMoney.customers.total_customers);
  eq("…nor a new customer this period", afterMoney.customers.new_customers, beforeMoney.customers.new_customers);
  eq("…nor distorts lifetime value", afterMoney.customers.avg_lifetime_value, beforeMoney.customers.avg_lifetime_value);
  eq("…nor appears in top products",
    afterMoney.top_products.some(p => p.name === "Test Product 1"), false);
  eq("…nor shows up on the daily chart",
    afterMoney.daily.reduce((n, d) => n + d.revenue, 0), beforeMoney.daily.reduce((n, d) => n + d.revenue, 0));
  // The QA account is excluded by its DOMAIN, never having been listed by name —
  // which is what stops a fixture account created next month from counting.
  eq("a QA-harness account is excluded by its domain alone",
    afterMoney.sales.orders, beforeMoney.sales.orders);

  // Real sales are untouched by all of it.
  eq("real revenue is unchanged", afterMoney.sales.revenue, beforeMoney.sales.revenue);
  eq("real revenue is still non-zero", afterMoney.sales.revenue > 0, true);

  // ── Where visitors are ──────────────────────────────────────────────────────
  // City and country arrive as headers from Netlify's edge, which resolved them
  // to route the request. No IP is looked up or stored to produce this, so the
  // headers ARE the measurement — and anything that can reach this route without
  // passing through Netlify can set them freely, which makes sanitising them the
  // whole security story rather than a nicety.
  console.log("\n\x1b[1mwhere visitors are\x1b[0m");

  const fromCity = (visitor, city, countryCode) =>
    send(visitor, COUNTED_ORIGIN, {
      ...(city === null ? {} : { "X-Og-Geo-City": encodeURIComponent(city) }),
      ...(countryCode === null ? {} : { "X-Og-Geo-Country": countryCode }),
    });

  const geoOf = async (visitor) =>
    (await pool.query(`SELECT geo_city, geo_country FROM analytics_events WHERE visitor_id = $1 LIMIT 1`, [visitor])).rows[0];

  await fromCity("geo-dublin", "Dublin", "IE");
  eq("a city from the edge is stored", await geoOf("geo-dublin"), { geo_city: "Dublin", geo_country: "IE" });

  // Header values are Latin-1; the edge percent-encodes so accented names survive.
  await fromCity("geo-munich", "München", "de");
  eq("an accented city survives the trip, and the country is normalised",
    await geoOf("geo-munich"), { geo_city: "München", geo_country: "DE" });

  // A city with no country is ambiguous to the point of misleading — there is a
  // Dublin in Ohio — so the pair travels together or not at all.
  await fromCity("geo-orphan", "Springfield", null);
  eq("a city with no country is discarded rather than guessed at",
    await geoOf("geo-orphan"), { geo_city: "", geo_country: "" });

  // Junk must never reach a GROUP BY key.
  await fromCity("geo-injection", "Dublin'); DROP TABLE analytics_events;--", "IE");
  eq("a city that isn't a place name is refused",
    (await geoOf("geo-injection")).geo_city, "");
  await fromCity("geo-longcountry", "Dublin", "IRELAND");
  eq("a country that isn't a two-letter code is refused",
    await geoOf("geo-longcountry"), { geo_city: "", geo_country: "" });

  // Every visit before this shipped, and every visit that reaches the backend
  // without passing through Netlify, has no location at all.
  await fromCity("geo-none", null, null);
  eq("no headers means no location, not a guess", await geoOf("geo-none"), { geo_city: "", geo_country: "" });

  const geoView = await (await fetch(
    `${API}/api/admin/analytics?start=${start}&end=${today}`, { headers: auth }
  )).json();
  const dublin = geoView.locations.find(l => l.city === "Dublin" && l.country === "IE");
  eq("the dashboard groups sessions by place", dublin?.sessions, 1);
  // A location table that silently omits the unlocated invites the reader to
  // treat the rest as the whole picture.
  eq("visits with no location are shown as Unknown, not dropped",
    geoView.locations.some(l => l.city === "Unknown"), true);
  // The seeded journeys carry no geo headers, so every located order in this
  // window is Unknown's — which makes this the check that the order join works
  // at all. Revenue is what the owner acts on here ("advertise where the money
  // is"), and a location table whose money column is quietly zero is worse than
  // no table.
  //
  // It is measured against the SOURCES table, not against total revenue: both
  // group the same session-attributed money by a different dimension, so they
  // must agree with each other. Total revenue is deliberately larger — it
  // includes orders with no browsing session behind them, which no dimension can
  // place, and which the panel already warns about at the top of the page.
  const locRevenue = geoView.locations.reduce((n, l) => n + l.revenue, 0);
  const srcRevenue = geoView.sources.reduce((n, s) => n + s.revenue, 0);
  eq("revenue follows the session to its location", locRevenue, srcRevenue);
  eq("…and stays under the total, which includes unattributable orders",
    locRevenue < geoView.sales.revenue, true);

  // ── Core Web Vitals ─────────────────────────────────────────────────────────
  // The metrics Google grades the shop on. The site-wide p75 says something is
  // slow; only the per-page breakdown says what to fix, and a breakdown built on
  // too few samples sends the owner after an unlucky phone on a train.
  console.log("\n\x1b[1mcore web vitals\x1b[0m");

  const vital = (sid, metric, value, path, offset) =>
    pool.query(
      `INSERT INTO analytics_events (visitor_id, session_id, event_type, path, props, created_at)
       VALUES ($1,$1,'web_vital',$2,$3,$4)`,
      [sid, path, JSON.stringify({ metric, value }), at(1, 9, offset)]
    );

  // /slow-page: six samples, clearly failing. /rare: three samples, worse — but
  // three visits is not a measurement.
  for (let i = 0; i < 6; i++) await vital(`vit-slow-${i}`, "LCP", 4200 + i, "/slow-page", i);
  for (let i = 0; i < 3; i++) await vital(`vit-rare-${i}`, "LCP", 9000 + i, "/rare", i);
  for (let i = 0; i < 6; i++) await vital(`vit-fast-${i}`, "LCP", 900 + i, "/fast-page", i);

  const vitalsWindow = await (await fetch(
    `${API}/api/admin/analytics?start=${start}&end=${today}`, { headers: auth }
  )).json();
  const byPage = vitalsWindow.web_vitals_by_page.filter(r => r.metric === "LCP");

  eq("a page with enough samples is broken out", byPage.find(r => r.path === "/slow-page")?.samples, 6);
  // 4200…4205 → percentile_cont interpolates at index 0.75×(6−1)=3.75, i.e.
  // three-quarters of the way from 4203 to 4204.
  eq("…at its own p75, not the site's", byPage.find(r => r.path === "/slow-page").p75, 4203.75);
  // Three visits is one bad phone, and chasing it costs the time the real
  // offender deserves.
  eq("a page with too few samples is left out", byPage.some(r => r.path === "/rare"), false);
  eq("a fast page is still reported, so the card can rank them", byPage.some(r => r.path === "/fast-page"), true);
  // The site-wide figure is unchanged by the breakdown existing.
  eq("the site-wide LCP still covers every sample including the rare page",
    vitalsWindow.web_vitals.find(v => v.metric === "LCP").samples, 15);

  // ── The household network ───────────────────────────────────────────────────
  // The signal that covers people who never sign in: a home connection is one
  // address for every device on it. `trust proxy` is on, so an X-Forwarded-For
  // sent to a test server on localhost is exactly what a real proxied visit
  // looks like from the route's point of view.
  // The address comes from the edge header, never from X-Forwarded-For: behind
  // Netlify AND Railway, req.ip is a proxy, and matching on it would have
  // compared a shared edge address to itself and excluded every visitor at once.
  const fromIp = (visitor, ip) => send(visitor, COUNTED_ORIGIN, { "X-Og-Client-Ip": ip });

  await fromIp("home-laptop", "203.0.113.7");   // the browser doing the excluding
  await fromIp("home-phone", "203.0.113.7");    // someone else in the house
  const beforeHome = await visitors();
  await fetch(`${API}/api/admin/analytics/internal`, {
    method: "PUT", headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ networks: ["203.0.113.7"], visitor_id: "home-laptop" }),
  });
  // Excluding a network can't reach backwards by itself — no visitor's IP is
  // stored, so there is nothing to match old rows against. What it CAN do is
  // clear the browser that did the excluding, so the number moves immediately
  // instead of leaving the owner wondering whether the setting took.
  eq("the excluding browser's own history goes at once", await visitors(), beforeHome - 1);
  eq("…and nothing more is stored from it", await fromIp("home-laptop", "203.0.113.7"), 1);
  // The whole point: a second person on the same wifi, never signed in. Their
  // earlier visit clears on their next one, which is the honest guarantee.
  eq("…and a different device on the same wifi records nothing new", await fromIp("home-phone", "203.0.113.7"), 1);
  eq("…and that visit takes its earlier ones out of the count too", await visitors(), beforeHome - 2);
  eq("a visitor somewhere else is untouched", await fromIp("someone-else", "198.51.100.9"), 1);

  // The failure that would have emptied the dashboard: a request whose client
  // address is unknown must be COUNTED, never matched. Behind two proxies the
  // backend's own idea of "the client" is a shared edge address, so a version
  // that fell back to it would have excluded the entire site the moment the
  // owner pressed one button.
  await fetch(`${API}/api/admin/analytics/internal`, {
    method: "PUT", headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ networks: ["203.0.113.7"] }),
  });
  const stranger = await send("proxy-visitor", COUNTED_ORIGIN, { "X-Forwarded-For": "203.0.113.7" });
  eq("an address the edge did not vouch for is never matched", stranger, 1);
  const noHeaders = await send("no-ip-visitor", COUNTED_ORIGIN);
  eq("a visit with no client address at all is counted, not excluded", noHeaders, 1);

  // Saving one list must not silently blank the other — they are separate
  // controls on the same card, and losing the accounts by editing networks would
  // be invisible until the numbers moved.
  const both = await (await fetch(`${API}/api/admin/analytics/internal`, { headers: auth })).json();
  // Whatever the account list currently holds, saving NETWORKS must not touch it.
  eq("saving networks kept the account list", both.emails, ["owner@test.local", "@olivegoose-test.local"]);

  // IPv6: every device on a home connection — and every privacy-extension
  // rotation on one device — gets a different address inside the same /64, so
  // matching the whole address would exclude nobody.
  await fetch(`${API}/api/admin/analytics/internal`, {
    method: "PUT", headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ networks: ["2001:db8:abcd:1::1"] }),
  });
  eq("an IPv6 device in the same /64 is the same household",
    await fromIp("v6-other-device", "2001:db8:abcd:1:f0e1:d2c3:b4a5:9687"), 0);
  eq("a different /64 is a different household",
    await fromIp("v6-elsewhere", "2001:db8:abcd:2::5"), 1);

  // CIDR, for a connection that moves around inside a block.
  await fetch(`${API}/api/admin/analytics/internal`, {
    method: "PUT", headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ networks: ["203.0.113.0/24"] }),
  });
  eq("a CIDR block covers the addresses inside it", await fromIp("cidr-inside", "203.0.113.44"), 0);
  eq("…and nothing outside it", await fromIp("cidr-outside", "203.0.114.44"), 1);

  // An entry that can't be matched would sit on screen looking like protection.
  const junk = await (await fetch(`${API}/api/admin/analytics/internal`, {
    method: "PUT", headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ networks: ["203.0.113.0/24", "not-an-address", "999.1.1.1"] }),
  })).json();
  eq("unmatchable entries are refused, not stored", junk.networks, ["203.0.113.0/24"]);

  // Undoing the exclusion has to give the traffic back, or a mis-click is
  // permanent data loss dressed up as a setting.
  await fetch(`${API}/api/admin/analytics/internal`, {
    method: "PUT", headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ networks: [] }),
  });
  const released = await (await fetch(`${API}/api/admin/analytics/internal`, { headers: auth })).json();
  eq("removing every network releases the visitors it hid",
    released.excluded_visitors.some(v => v.reason === "own network"), false);


  // ── Exclusions that reach backwards ─────────────────────────────────────────
  // Every control on the card is described to the owner as "your own visits stop
  // counting", and two of them quietly meant "…from the next visit onwards":
  //
  //   • naming an account did nothing at all to what that account had already
  //     browsed, because the exclusion list is written at INGEST — so the test
  //     checkouts it was added to hide stayed in the numbers, and the panel said
  //     they were gone;
  //   • removing one of two excluded networks released NOTHING, because the
  //     release only ran when the last one went. Real shoppers stayed hidden
  //     permanently, which is the one direction of error no other figure on the
  //     dashboard can reveal — the count only ever looks calm.
  console.log("\n\x1b[1mexclusions reach backwards\x1b[0m");

  const setInternal = (patch) => fetch(`${API}/api/admin/analytics/internal`, {
    method: "PUT", headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }).then(r => r.json());

  // A visit shaped like every test checkout: anonymous browsing, a sign-in, then
  // more anonymous browsing. Only the middle of it carries the account, so an
  // exclusion that keys on the account alone would leave two thirds behind.
  const lateId = (await pool.query(
    `INSERT INTO users (email, full_name) VALUES ('late@test.local','Late') RETURNING id`
  )).rows[0].id;
  await send("late-browser", COUNTED_ORIGIN);
  await send("late-browser", COUNTED_ORIGIN, { Cookie: sessionCookie(lateId) });
  await send("late-browser", COUNTED_ORIGIN);

  const beforeLate = await visitors();
  eq("an account not yet on the list is an ordinary visitor", await rowsFor("late-browser"), 3);

  await setInternal({ emails: ["owner@test.local", "@olivegoose-test.local", "late@test.local"] });
  eq("naming the account afterwards retires what it ALREADY browsed",
    await visitors(), beforeLate - 1);
  // The exclusion must hide the visit, never delete it: an undo that cannot get
  // the rows back is data loss with a checkbox in front of it.
  eq("…without destroying a single row", await rowsFor("late-browser"), 3);
  // The anonymous page views either side of the sign-in carry no account at all,
  // so only retiring the VISITOR takes the whole visit.
  eq("…including the anonymous browsing either side of the sign-in",
    (await pool.query(
      `SELECT COUNT(*)::int AS n FROM analytics_internal_visitors WHERE visitor_id = 'late-browser'`
    )).rows[0].n, 1);

  // The mark has to survive an unrelated save. Once a browser is marked,
  // ingestion DROPS its batches — so a browser that has only ever visited while
  // its account was already listed has NO stored events naming that account, and
  // a release that looked only for events would throw the mark away the next
  // time any setting was touched. The owner would watch a morning of their own
  // testing walk back into the numbers with nothing on screen to explain it.
  const heldByAccount = await visitors();
  await send("late-browser", COUNTED_ORIGIN, { Cookie: sessionCookie(lateId) }); // dropped, not stored
  await setInternal({ networks: [] });                                          // an unrelated save
  eq("an unrelated save does not hand the account's browsing back",
    await visitors(), heldByAccount);
  eq("…because the mark records which account made it",
    (await (await fetch(`${API}/api/admin/analytics/internal`, { headers: auth })).json())
      .excluded_visitors.find(v => v.visitor_id === "late-browser")?.detail, lateId);

  await setInternal({ emails: ["owner@test.local", "@olivegoose-test.local"] });
  eq("removing the account gives its browsing back", await visitors(), beforeLate);

  // Two networks, then one removed. The released set must be exactly the one
  // that was removed — releasing both would put the owner's own household back
  // in the numbers, releasing neither is what shipped.
  await fromIp("net-a-device", "192.0.2.10");
  await fromIp("net-b-device", "198.51.100.20");
  const beforeNets = await visitors();
  await setInternal({ networks: ["192.0.2.10", "198.51.100.20"] });
  // Neither device is excluded yet — no address is stored, so nothing can be
  // matched retroactively. Each drops out on its own next visit.
  await fromIp("net-a-device", "192.0.2.10");
  await fromIp("net-b-device", "198.51.100.20");
  eq("both networks' devices drop out as they return", await visitors(), beforeNets - 2);

  await setInternal({ networks: ["198.51.100.20"] });
  eq("removing ONE network releases exactly its own devices", await visitors(), beforeNets - 1);
  const afterOne = await (await fetch(`${API}/api/admin/analytics/internal`, { headers: auth })).json();
  eq("…and the network still on the list keeps hiding its own",
    afterOne.excluded_visitors.some(v => v.visitor_id === "net-b-device"), true);
  eq("…and records which network hid it, so this stays reversible",
    afterOne.excluded_visitors.find(v => v.visitor_id === "net-b-device")?.detail, "198.51.100.20");

  await setInternal({ networks: [] });
  eq("removing the last one releases the rest", await visitors(), beforeNets);

  // ── Retiring a visit after the fact ─────────────────────────────────────────
  // The gap none of the rules above can close. A VPN puts the owner's laptop on
  // an address in another country, so the home network never matches and the
  // visit lands in the numbers as a shopper in Stockholm — with nothing anywhere
  // that could say otherwise afterwards.
  console.log("\n\x1b[1mretiring a visit after the fact\x1b[0m");

  await send("vpn-laptop", COUNTED_ORIGIN, {
    "X-Og-Client-Ip": "203.0.113.200",          // a VPN exit node, not the house
    "X-Og-Geo-City": encodeURIComponent("Stockholm"),
    "X-Og-Geo-Country": "SE",
  });
  const beforeVpn = await visitors();

  const listSessions = async (q = "") =>
    (await (await fetch(`${API}/api/admin/analytics/sessions?days=7${q}`, { headers: auth })).json()).sessions;

  const listed = await listSessions();
  const vpnRow = listed.find(r => r.visitor_id === "vpn-laptop");
  eq("the visit is listed, with enough of it to be recognised", !!vpnRow, true);
  eq("…showing where it surfaced", `${vpnRow?.city}, ${vpnRow?.country}`, "Stockholm, SE");
  eq("…and that nothing had excluded it", vpnRow?.excluded, false);

  const retire = (visitorId, enabled) => fetch(`${API}/api/admin/analytics/internal/visitor`, {
    method: "POST", headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ visitor_id: visitorId, enabled }),
  });

  eq("retiring it succeeds", (await retire("vpn-laptop", true)).status, 200);
  eq("…and it leaves the numbers", await visitors(), beforeVpn - 1);
  eq("…and stops being recorded at all", await send("vpn-laptop", COUNTED_ORIGIN), 1);
  eq("…and is still listed, so the decision can be undone",
    (await listSessions()).find(r => r.visitor_id === "vpn-laptop")?.excluded, true);
  eq("…and shows up under the retired filter",
    (await listSessions("&only=excluded")).some(r => r.visitor_id === "vpn-laptop"), true);
  eq("…and not under the counted one",
    (await listSessions("&only=counted")).some(r => r.visitor_id === "vpn-laptop"), false);

  await retire("vpn-laptop", false);
  eq("putting it back counts it again", await visitors(), beforeVpn);

  // An account excluded by the LIST cannot be released from this button — the
  // list is where that decision lives, and a control that silently fails is
  // worse than one that isn't offered.
  await setInternal({ emails: ["owner@test.local", "@olivegoose-test.local", "late@test.local"] });
  const held = await visitors();
  await retire("late-browser", false);
  eq("a visit excluded by the account list is not released by this button",
    await visitors(), held);
  await setInternal({ emails: ["owner@test.local", "@olivegoose-test.local"] });

  // ── Where a visit came from ─────────────────────────────────────────────────
  // The source is the referrer's HOST. It used to be produced with
  // regexp_replace, which returns the subject unchanged when the pattern misses
  // — so any referrer that wasn't a plain http(s) URL became a "source" spelled
  // out as an entire URL, one row per distinct link, each of them pushing a real
  // source out of a top-ten table.
  console.log("\n\x1b[1mwhere a visit came from\x1b[0m");

  const rev = (sid, vid, ref) => pool.query(
    `INSERT INTO analytics_events (visitor_id, session_id, event_type, path, referrer, visitor_scope, created_at)
     VALUES ($1,$2,'page_view','/',$3,'persistent',NOW())`, [vid, sid, ref]);

  await rev("ref-s1", "ref-v1", "https://t.co/abc?utm=1");
  await rev("ref-s2", "ref-v2", "https://t.co/def?utm=2");
  await rev("ref-s3", "ref-v3", "https://www.t.co/ghi");
  eq("a query string is not part of the site that referred them",
    (await get("&source=t.co")).traffic.sessions, 3);

  await rev("ref-s4", "ref-v4", "android-app://com.google.android.gm/");
  eq("an app referral keeps its identity instead of becoming a URL",
    (await get("&source=com.google.android.gm")).traffic.sessions, 1);

  await rev("ref-s5", "ref-v5", "not a url at all");
  eq("an unreadable referrer is labelled, not counted as direct",
    (await get("&source=(unrecognised referrer)")).traffic.sessions, 1);

  // ── What shoppers searched for ──────────────────────────────────────────────
  // Recorded since the search event shipped and reported nowhere. It is the only
  // place a shopper says what they wanted in their own words, and a term that
  // finds nothing leaves no other trace on the whole dashboard: no product row,
  // no lost basket, no funnel step — the visit simply ends.
  console.log("\n\x1b[1mwhat shoppers searched for\x1b[0m");

  const sev = (sid, vid, query, results) => pool.query(
    `INSERT INTO analytics_events (visitor_id, session_id, event_type, path, props, visitor_scope, created_at)
     VALUES ($1,$2,'search','/',$3,'persistent',NOW())`,
    [vid, sid, JSON.stringify({ query, results })]);

  await sev("srch-s1", "srch-v1", "lavender", 3);
  await sev("srch-s2", "srch-v2", "Lavender ", 3);   // same search, different typing
  await sev("srch-s3", "srch-v3", "beeswax", 0);
  await sev("srch-s3", "srch-v3", "bees wax", 0);

  const searched = (await get()).searches;
  const term = (t) => searched.find(r => r.term === t);
  eq("searches are reported at all", searched.length > 0, true);
  eq("case and stray spaces are one term, not three", term("lavender")?.searches, 2);
  eq("…counted by session as well as by search", term("lavender")?.sessions, 2);
  eq("a term that found nothing is marked as such", term("beeswax")?.no_results, 1);
  eq("…and one that found something is not", term("lavender")?.no_results, 0);
  eq("two empty searches in one visit are one shopper, twice",
    [term("beeswax")?.sessions, term("bees wax")?.sessions], [1, 1]);

  // ── Measurement changes are declared, not hidden ────────────────────────────
  // A window spanning the day a metric's definition moved is comparing two
  // different measurements. No query can reconcile that, so the API has to say
  // so — otherwise the step reads as shopper behaviour and gets acted on.
  console.log("\n\x1b[1mmeasurement changes\x1b[0m");
  const spanning = await (await fetch(`${API}/api/admin/analytics?start=2026-08-01&end=2026-08-07`, { headers: auth })).json();
  const clear = await (await fetch(`${API}/api/admin/analytics?start=2026-08-05&end=2026-08-07`, { headers: auth })).json();
  eq("a window spanning the change is flagged", spanning.measurement_notes.length, 1);
  eq("…and dated", spanning.measurement_notes[0]?.date, "2026-08-04");
  eq("…and says what moved", /sign-in/i.test(spanning.measurement_notes[0]?.note ?? ""), true);
  eq("a window entirely after it is not flagged", clear.measurement_notes.length, 0);

  // ── A window in the past is measured in the past ────────────────────────────
  // Every check above asks for a window ending TODAY, which hid a whole class of
  // error: several predicates were written as "from the window start onward"
  // with no upper bound, which is invisible while the window ends now and wrong
  // the moment it doesn't. Asking for last June counted every purchase made
  // SINCE June as a June conversion — the funnel, the conversion rate and the
  // abandonment card all scored a past month against a future the shopper had
  // not reached yet, and the numbers looked plausible, which is worse.
  //
  // Seeded here rather than in the fixture so these rows can't perturb the
  // assertions above: they sit 200/190/100 days back, far outside every window
  // used up to this point.
  console.log("\n\x1b[1mpast windows don't borrow from the future\x1b[0m");
  const pastUser = (await pool.query(
    `INSERT INTO users (email, full_name) VALUES ('past@test.local','T') RETURNING id`
  )).rows[0].id;
  const pev = (sid, vid, type, ts, o = {}) => pool.query(
    `INSERT INTO analytics_events (visitor_id, session_id, event_type, path, utm_source, device, props, visitor_scope, geo_city, geo_country, created_at)
     VALUES ($1,$2,$3,$4,'google','desktop',$5,'persistent',$6,'IE',$7)`,
    [vid, sid, type, o.path || "/", JSON.stringify(o.props || {}), o.city || "Cork", ts]
  );
  const pord = (id, total, ts, items) => pool.query(
    `INSERT INTO orders (id, user_id, items, subtotal, shipping, total, discount_amount, tracking_number,
                         payment_status, refund_status, created_at)
     VALUES ($1,$2,$3,$4,0,$5,0,$6,'paid','not_applicable',$7)`,
    [id, pastUser, JSON.stringify(items), total, total, `T-${id.slice(0, 6)}`, ts]
  );
  const pline = (pid, name, price) => ({ product_id: pid, quantity: 1, product_data: { name, price: `€${price}` } });
  const day = (off) => new Date(Date.parse(`${todayTz()}T00:00:00Z`) - off * 86400000).toISOString().slice(0, 10);
  const win = async (d) => (await fetch(`${API}/api/admin/analytics?start=${d}&end=${d}`, { headers: auth })).json();

  // sHist reached checkout 200 days ago on a €500 basket and left. The same id
  // carries a purchase 100 days later — a long-lived id, a replayed beacon, a
  // checkout resumed. Whatever the cause, that sale is not this day's.
  const OHIST = "77777777-7777-4777-8777-777777777777";
  await pev("s-hist", "v-hist", "page_view", at(200, 12), { path: "/shop" });
  await pev("s-hist", "v-hist", "begin_checkout", at(200, 12, 1), { path: "/checkout", props: { total: 500 } });
  await pord(OHIST, 500, at(100, 12), [pline("p-h", "Candle H", 500)]);
  await pev("s-hist", "v-hist", "purchase", at(100, 12), { path: "/checkout/success", props: { order_id: OHIST, total: 500 } });

  const H = await win(day(200));
  eq("the historical session is counted", H.traffic.sessions, 1);
  eq("a purchase 100 days later is not this day's conversion", H.sales.conversion_rate, 0);
  eq("…nor this day's funnel purchase", H.funnel.find(f => f.stage === "Purchased")?.sessions, 0);
  eq("…and the session reads as abandoned, which is what it did", H.abandoned.abandoned_sessions, 1);
  eq("…with the basket it walked away from", H.abandoned.lost_revenue, 500);
  eq("no revenue leaks back into the earlier day", H.sales.revenue, 0);

  // One order, two purchase rows — a re-flushed beacon or a retried finalize.
  // Counted as event rows it became two orders and twice the money, in the two
  // tables built from those rows.
  const ODUP = "88888888-8888-4888-8888-888888888888";
  await pev("s-dup", "v-dup", "page_view", at(190, 12), { path: "/shop", city: "Galway" });
  await pord(ODUP, 80, at(190, 12, 1), [pline("p-i", "Candle I", 80)]);
  await pev("s-dup", "v-dup", "purchase", at(190, 12, 2), { path: "/checkout/success", city: "Galway", props: { order_id: ODUP, total: 80 } });
  await pev("s-dup", "v-dup", "purchase", at(190, 12, 3), { path: "/checkout/success", city: "Galway", props: { order_id: ODUP, total: 80 } });

  const D = await win(day(190));
  const dupSrc = D.sources.find(s => s.source === "google");
  const dupLoc = D.locations.find(l => l.city === "Galway");
  eq("a duplicated purchase row is still one order", D.sales.orders, 1);
  eq("attribution counts it once", dupSrc?.orders, 1);
  eq("…for its actual value", dupSrc?.revenue, 80);
  eq("locations counts it once", dupLoc?.orders, 1);
  eq("…for its actual value", dupLoc?.revenue, 80);

  // The attribution table has to account for every attributed order, including
  // one bought by a visit that began before the window — otherwise its columns
  // quietly fail to add up to the Revenue figure directly above them.
  const R = await win(day(100));
  eq("the later order lands in its own day", R.sales.orders, 1);
  eq("…and is attributable", R.sales.attributed_orders, 1);
  eq("attribution accounts for every attributed order",
    R.sources.reduce((n, s) => n + s.orders, 0), R.sales.attributed_orders);
  eq("…and for all of their revenue", R.sources.reduce((n, s) => n + s.revenue, 0), R.sales.revenue);
  eq("…saying plainly that the visit started earlier",
    R.sources.some(s => /before this period/.test(s.source)), true);

  // ── A range that can't be honoured is refused, not quietly replaced ─────────
  // These used to fall back to "last 30 days" with a 200, so the panel printed
  // the dates the reader picked above numbers from a different month.
  console.log("\n\x1b[1mimpossible ranges are refused\x1b[0m");
  const status = async (qs) => (await fetch(`${API}/api/admin/analytics?${qs}`, { headers: auth })).status;
  eq("end before start is rejected", await status("start=2026-08-01&end=2026-07-01"), 400);
  eq("a non-date is rejected", await status("start=hello&end=world"), 400);
  eq("half a range is rejected", await status("start=2026-08-01"), 400);
  eq("no range at all still gets the trailing default", await status("days=30"), 200);
  const capped = await (await fetch(`${API}/api/admin/analytics?start=2020-01-01&end=${today}`, { headers: auth })).json();
  eq("a range past the 2-year cap says it was shortened", capped.clamped, true);
  eq("…and reports the window it actually measured", capped.days, 731);
  eq("a normal range is not marked as shortened", (await win(day(190))).clamped, false);

  // ── The cards have to agree with the tiles ─────────────────────────────────
  // Sessions and visitors are counted once per window, but every card below
  // them re-derives its own row set, and each re-derivation is a chance to
  // count a different population than the tile it sits under. This fixture is
  // built so that each card's total is checked against the KPI it must match,
  // and so the awkward cases are present rather than assumed away: one person
  // with two visits, one visit either side of midnight, a browser that reported
  // only a performance measurement, a visit that began before the window and
  // paid inside it, one session that placed two orders, and a product bought
  // three at a time by one of the two sessions that added it.
  console.log("\n\x1b[1mcards agree with the tiles\x1b[0m");
  const cu = (await pool.query(
    `INSERT INTO users (email, full_name) VALUES ('cards@test.local','T') RETURNING id`
  )).rows[0].id;
  const cev = (sid, vid, type, ts, o = {}) => pool.query(
    `INSERT INTO analytics_events (visitor_id, session_id, event_type, path, referrer, utm_source, utm_medium, utm_campaign, device, props, visitor_scope, geo_city, geo_country, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'persistent',$11,$12,$13)`,
    [vid, sid, type, o.path || "/", o.ref || "", o.src || "", o.med || "", o.camp || "",
     o.dev || "desktop", JSON.stringify(o.props || {}), o.city || "", o.country || "", ts]
  );
  const cord = (id, total, ts, items) => pool.query(
    `INSERT INTO orders (id, user_id, items, subtotal, shipping, total, discount_amount, tracking_number,
                         payment_status, refund_status, created_at)
     VALUES ($1,$2,$3,$4,0,$5,0,$6,'paid','not_applicable',$7)`,
    [id, cu, JSON.stringify(items), total, total, `T-${id.slice(0, 6)}`, ts]
  );
  const cline = (pid, name, price, qty = 1) => ({ product_id: pid, quantity: qty, product_data: { name, price: `€${price}` } });
  const cid = (n) => `${String(n).repeat(8)}-9999-4999-8999-999999999999`;

  // One visitor, two visits on different days.
  for (const off of [298, 296]) {
    await cev(`c-s${off}`, "c-v1", "page_view", at(off, 12), { path: "/shop", src: "google", city: "Dublin", country: "IE" });
    await cev(`c-s${off}`, "c-v1", "view_item_list", at(off, 12, 1), { path: "/shop", src: "google", city: "Dublin", country: "IE" });
  }
  // One visit, either side of midnight.
  await cev("c-span", "c-v2", "page_view", at(295, 23, 50), { path: "/", ref: "https://www.instagram.com/p/x", dev: "mobile", city: "Galway", country: "IE" });
  await cev("c-span", "c-v2", "page_view", at(294, 0, 10), { path: "/shop", ref: "https://www.instagram.com/p/x", dev: "mobile", city: "Galway", country: "IE" });
  // A browser that reported a performance measurement and nothing else.
  await cev("c-vital", "c-v3", "web_vital", at(293, 10), { path: "/", props: { metric: "LCP", value: 1800 } });
  // A visit that began before the window and paid inside it.
  await cev("c-early", "c-v4", "page_view", at(310, 10), { path: "/shop", src: "google", city: "Limerick", country: "IE" });
  await cord(cid(4), 200, at(290, 10), [cline("p-cc", "Candle CC", 200)]);
  await cev("c-early", "c-v4", "purchase", at(290, 10), { path: "/checkout/success", props: { order_id: cid(4), total: 200 } });
  // Added one, bought three.
  const camp = { src: "newsletter", med: "email", camp: "spring", city: "Cork", country: "IE" };
  await cev("c-buy", "c-v6", "page_view", at(288, 12), { path: "/products/candle-aa", ...camp });
  await cev("c-buy", "c-v6", "view_item", at(288, 12, 1), { path: "/products/candle-aa", ...camp, props: { product_id: "p-aa", name: "Candle AA" } });
  await cev("c-buy", "c-v6", "add_to_cart", at(288, 12, 2), { ...camp, props: { product_id: "p-aa", name: "Candle AA" } });
  await cord(cid(6), 300, at(288, 12, 3), [cline("p-aa", "Candle AA", 100, 3)]);
  await cev("c-buy", "c-v6", "purchase", at(288, 12, 4), { path: "/checkout/success", props: { order_id: cid(6), total: 300 } });
  // Added the same one and did not buy.
  await cev("c-look", "c-v7", "page_view", at(287, 12), { path: "/products/candle-aa", src: "google", city: "Cork", country: "IE" });
  await cev("c-look", "c-v7", "view_item", at(287, 12, 1), { path: "/products/candle-aa", src: "google", city: "Cork", country: "IE", props: { product_id: "p-aa", name: "Candle AA" } });
  await cev("c-look", "c-v7", "add_to_cart", at(287, 12, 2), { src: "google", city: "Cork", country: "IE", props: { product_id: "p-aa", name: "Candle AA" } });
  // One session, two orders.
  await cev("c-two", "c-v8", "page_view", at(285, 12), { path: "/shop", src: "google", city: "Dublin", country: "IE" });
  await cord(cid(8), 50, at(285, 12, 5), [cline("p-dd", "Candle DD", 50)]);
  await cev("c-two", "c-v8", "purchase", at(285, 12, 6), { path: "/checkout/success", props: { order_id: cid(8), total: 50 } });
  await cord(cid(9), 60, at(285, 12, 30), [cline("p-ee", "Candle EE", 60)]);
  await cev("c-two", "c-v8", "purchase", at(285, 12, 31), { path: "/checkout/success", props: { order_id: cid(9), total: 60 } });

  const C = await (await fetch(
    `${API}/api/admin/analytics?start=${day(300)}&end=${day(280)}`, { headers: auth }
  )).json();
  const total = (rows, k) => +rows.reduce((n, r) => n + r[k], 0).toFixed(2);

  eq("a browser that only reported a web vital is not a visitor", C.traffic.visitors, 6);
  eq("one visit either side of midnight is one session", C.traffic.sessions, 7);
  eq("new + returning accounts for every visitor",
    C.traffic.new_visitors + C.traffic.returning_visitors, C.traffic.visitors);
  eq("page views", C.traffic.pageviews, 7);
  eq("the device split covers every session", total(C.devices, "sessions"), C.traffic.sessions);

  eq("the chart has a row for every day of the window", C.daily.length, 21);
  eq("charted revenue adds up to the Revenue tile", total(C.daily, "revenue"), C.sales.revenue);
  eq("charted orders add up to the Orders tile", total(C.daily, "orders"), C.sales.orders);
  eq("charted page views add up to the Page views tile", total(C.daily, "pageviews"), C.traffic.pageviews);
  // Per-day uniques deliberately exceed the period's: a visit spanning midnight
  // is on both days, and a person who came back is on both days. The panel says
  // so under the chart rather than leaving the reader to reconcile it.
  eq("per-day sessions exceed the period total, as uniques must",
    total(C.daily, "sessions") > C.traffic.sessions, true);

  const city = (n) => C.locations.find(l => l.city === n);
  eq("locations — Dublin sessions", city("Dublin")?.sessions, 3);
  eq("locations — one session's two orders count as two", city("Dublin")?.orders, 2);
  eq("locations — Dublin revenue", city("Dublin")?.revenue, 110);
  eq("locations — Cork", [city("Cork")?.sessions, city("Cork")?.orders, city("Cork")?.revenue], [2, 1, 300]);
  eq("every session appears on the map", total(C.locations, "sessions"), C.traffic.sessions);
  eq("…and every order", total(C.locations, "orders"), C.sales.orders);
  eq("…and all of the revenue", total(C.locations, "revenue"), C.sales.revenue);

  const from = (n) => C.sources.find(s => s.source === n);
  eq("attribution — google sessions", from("google")?.sessions, 4);
  eq("attribution — www stripped from the referrer host", from("instagram.com")?.sessions, 1);
  eq("attribution — a utm source beats the referrer", from("newsletter")?.sessions, 1);
  eq("attribution — revenue follows the session", from("newsletter")?.revenue, 300);
  eq("attribution accounts for every attributed order", total(C.sources, "orders"), C.sales.attributed_orders);
  eq("…and all of their revenue", total(C.sources, "revenue"), C.sales.revenue);
  // The one honest shortfall: a visit that started before the window is not a
  // session OF the window, so the Sessions column is under the tile by exactly
  // that many. The panel prints the difference rather than leaving it to be
  // spotted.
  eq("sessions are short only by the visits that began earlier",
    C.traffic.sessions - total(C.sources, "sessions"), 1);
  const byMedium = await (await fetch(
    `${API}/api/admin/analytics?start=${day(300)}&end=${day(280)}&attr=medium`, { headers: auth }
  )).json();
  eq("grouping by medium keeps the same sessions", total(byMedium.sources, "sessions"), total(C.sources, "sessions"));
  eq("…with the campaign's medium named", byMedium.sources.find(s => s.source === "email")?.sessions, 1);

  const item = (n) => C.top_products.find(p => p.name === n);
  eq("products — sessions that looked", item("Candle AA")?.views, 2);
  eq("products — sessions that added", item("Candle AA")?.add_to_carts, 2);
  eq("products — units sold", item("Candle AA")?.units, 3);
  eq("products — view→cart", item("Candle AA")?.view_to_cart_pct, 100);
  eq("products — cart→buy counts BUYERS, not units bought", item("Candle AA")?.cart_to_buy_pct, 50);
  eq("products — a sale with no tracked views has unknown rates, not zero",
    [item("Candle CC")?.views, item("Candle CC")?.view_to_cart_pct, item("Candle CC")?.cart_to_buy_pct], [0, null, null]);
  eq("product revenue adds up to the Revenue tile", total(C.top_products, "revenue"), C.sales.revenue);

  // Landing pages — where visits BEGIN. Not Top pages re-sorted: the busiest
  // page is usually one everyone passes THROUGH, and the front door is a
  // different page answering a different question.
  // A visit that began on the homepage and moved on lands on the HOMEPAGE. The
  // fixture's midnight-spanning session does exactly that, so if landing pages
  // were secretly "last page" or "busiest page" this row would not exist.
  eq("a visit that began on the homepage lands there, wherever it went next",
    (C.landing_pages.find(p => p.path === "/")?.sessions ?? 0) > 0, true);

  // The invariant that separates this table from Top pages: landing on a page
  // means visiting it, but visiting it does not mean landing on it. So for every
  // page, landings can never exceed visits — and where they differ, the two
  // tables are genuinely answering different questions rather than one being the
  // other re-sorted.
  const bySession = new Map(C.top_pages.map(p => [p.path, p.sessions]));
  const realRows = C.landing_pages.filter(p => !p.path.startsWith("+ "));
  eq("nobody lands on a page more often than they visit it",
    realRows.every(p => !bySession.has(p.path) || p.sessions <= bySession.get(p.path)), true);
  eq("…and the two tables do not agree, because they are not the same question",
    realRows.some(p => bySession.has(p.path) && p.sessions < bySession.get(p.path)), true);

  // Every landing is a session, so the column can never exceed the tile. It can
  // fall SHORT of it, and legitimately: a session with no page view at all has no
  // landing page, which is exactly how GA4 reports it too.
  eq("landings never exceed the sessions they came from",
    realRows.reduce((n, p) => n + p.sessions, 0) <= C.traffic.sessions, true);
  eq("…and the sales credited to landing pages don't exceed the ones measured",
    realRows.reduce((n, p) => n + p.purchased, 0) <= C.sales.orders, true);

  // ── The shape the panel is typed against ───────────────────────────────────
  // AnalyticsOverview in src/lib/api.ts is a hand-written description of this
  // response, and TypeScript cannot check it: nothing type-checks JSON coming
  // off the wire. Rename a column here and the build stays green, the tests
  // above keep passing on the fields they name, and the panel renders a blank
  // where a number used to be. These lists are the other half of that contract.
  console.log("\n\x1b[1mresponse shape\x1b[0m");
  const keys = (o) => Object.keys(o).sort();
  eq("top level", keys(C), [
    "abandoned", "accounts", "attributed", "clamped", "customers", "daily", "days", "devices",
    "end", "filters", "funnel", "landing_pages", "locations", "measurement_notes", "sales",
    "searches", "signin_wall", "sources", "start", "timezone", "top_pages", "top_products",
    "traffic", "web_vitals", "web_vitals_by_page",
  ]);
  eq("traffic", keys(C.traffic), [
    "avg_engagement_seconds", "bounce_rate", "engagement_rate", "identified_visitor_pct",
    "new_visitors", "pages_per_session", "pageviews",
    "prev", "returning_visitors", "sessions", "visitors",
  ]);
  eq("traffic.prev", keys(C.traffic.prev), ["pageviews", "sessions", "visitors"]);
  eq("sales", keys(C.sales), ["aov", "attributed_orders", "conversion_rate", "orders", "prev", "revenue"]);
  eq("sales.prev", keys(C.sales.prev), ["aov", "orders", "revenue"]);
  eq("customers", keys(C.customers), [
    "avg_lifetime_value", "avg_orders_per_customer", "lifetime_repeat_customers",
    "new_customers", "returning_customers", "total_customers",
  ]);
  eq("abandoned", keys(C.abandoned), ["abandoned_sessions", "checkout_sessions", "lost_revenue"]);
  eq("filters", keys(C.filters), ["attr", "device", "source"]);
  eq("daily row", keys(C.daily[0]), ["day", "orders", "pageviews", "revenue", "sessions", "visitors"]);
  eq("top_products row", keys(C.top_products[0]), [
    "add_to_carts", "cart_to_buy_pct", "name", "removals", "revenue", "units", "view_to_cart_pct", "views",
  ]);
  eq("accounts", keys(C.accounts), ["account_signups", "newsletter_signups", "sign_ins"]);
  eq("sources row", keys(C.sources[0]), ["orders", "revenue", "sessions", "source"]);
  eq("locations row", keys(C.locations[0]), ["city", "country", "orders", "revenue", "sessions"]);
  eq("top_pages row", keys(C.top_pages[0]), ["path", "sessions", "views"]);
  eq("landing_pages row", keys(C.landing_pages[0] ?? { path: "", purchased: 0, sessions: 0 }),
    ["path", "purchased", "sessions"]);
  eq("searches row", keys(C.searches[0] ?? { no_results: 0, searches: 0, sessions: 0, term: "" }),
    ["no_results", "searches", "sessions", "term"]);
  eq("devices row", keys(C.devices[0]), ["device", "sessions"]);
  eq("funnel row", keys(C.funnel[0]), ["sessions", "stage"]);
  // The gate block is null in this window, so its shape is checked where it exists.
  eq("signin_wall", keys(d.signin_wall ?? {}), [
    "blocked_basket_value", "gate_sessions", "passed_purchased", "passed_sessions",
    "walled_continued", "walled_purchased", "walled_sessions",
  ]);
  eq("web_vitals row", keys(vitalsWindow.web_vitals[0]), ["metric", "p75", "samples"]);
  eq("web_vitals_by_page row", keys(vitalsWindow.web_vitals_by_page[0]), ["metric", "p75", "path", "samples"]);


  // ── Junk in the props cannot take the page down ─────────────────────────────
  // `props` is whatever a browser posted, and Postgres does not fail softly on a
  // bad cast: '1.2.3'::numeric RAISES and aborts the whole statement. Every one
  // of those casts sits inside the admin dashboard's aggregates, and the ingest
  // route is public and unauthenticated — so ONE request was enough to take
  // Analytics down permanently for every date range containing the row.
  //
  // It didn't even fail honestly. 22P02 is the code sendServerError reports as
  // 404 "Not found" (right for a mistyped :id in a URL), so a broken dashboard
  // presented itself as a page that did not exist.
  console.log("\n\x1b[1mjunk in the props cannot take the page down\x1b[0m");

  const junkProps = async (visitor, type, props) => {
    await fetch(`${API}/api/analytics/events`, {
      method: "POST", headers: { "Content-Type": "application/json", Origin: COUNTED_ORIGIN },
      body: JSON.stringify({
        visitor_id: visitor, session_id: visitor, visitor_scope: "persistent",
        events: [{ type, path: "/", props }],
      }),
    });
    return rowsFor(visitor);
  };

  const cleanBefore = await get();
  eq("a web vital whose value is not a number is still STORED",
    await junkProps("junk-lcp", "web_vital", { metric: "LCP", value: "1.2.3" }), 1);
  const afterJunk1 = await (await fetch(`${API}/api/admin/analytics?start=${start}&end=${today}`, { headers: auth }));
  eq("…and the dashboard still answers", afterJunk1.status, 200);

  await junkProps("junk-cls", "web_vital", { metric: "CLS", value: "." });
  await junkProps("junk-inp", "web_vital", { metric: "INP", value: "1e9" });
  // The shape that catches a MIS-ESCAPED guard, and nothing else does. Written
  // as a JS template literal, `\.` reaches Postgres as a bare `.` — any
  // character — so the pattern still rejects "1.2.3" and "." and reads as
  // correct, while waving "1x9" through into ::numeric and raising the very
  // error it exists to prevent. This suite caught exactly that.
  await junkProps("junk-wildcard", "web_vital", { metric: "INP", value: "1x9" });
  await junkProps("junk-spaced", "web_vital", { metric: "INP", value: "1 9" });
  await junkProps("junk-total", "begin_checkout", { total: "9.9.9" });
  await junkProps("junk-neg", "begin_checkout", { total: "-5" });
  await junkProps("junk-results", "search", { query: "candle", results: "99999999999" });
  await junkProps("junk-huge", "web_vital", { metric: "LCP", value: "9".repeat(40) });

  const afterJunk = await get();
  eq("every shape of junk leaves the page working", typeof afterJunk.traffic.sessions, "number");
  // The unreadable values must be IGNORED, not guessed at — a basket of "9.9.9"
  // must not become 9.9 in the money the shop believes it lost.
  eq("…and unreadable numbers are ignored rather than half-read",
    afterJunk.abandoned.lost_revenue, cleanBefore.abandoned.lost_revenue);
  eq("…and don't invent a web-vitals sample",
    afterJunk.web_vitals.reduce((n, v) => n + v.samples, 0),
    cleanBefore.web_vitals.reduce((n, v) => n + v.samples, 0));
  // A search with an unreadable result count is still a search someone made.
  eq("…while a search with an unreadable result count still counts as a search",
    afterJunk.searches.find(t => t.term === "candle")?.searches, 1);
  eq("…and is not claimed to have found nothing",
    afterJunk.searches.find(t => t.term === "candle")?.no_results, 0);

  // ── Traffic that isn't a person ─────────────────────────────────────────────
  // Ingestion needs a browser that runs JavaScript, which keeps most crawlers out
  // by construction — but not anything scripted deliberately, and curl,
  // python-requests and node-fetch all landed in the visitor count as shoppers.
  //
  // The other half matters more: every entry in that filter is a chance to throw
  // away a REAL shopper. `facebook`, `instagram`, `linkedin`, `tiktok` and
  // `pinterest` all appear in the in-app browsers people actually shop from, and
  // "Cubot" is a phone, not a robot.
  console.log("\n\x1b[1mtraffic that isn't a person\x1b[0m");

  const asAgent = async (name, ua, shouldCount) => {
    // Padded because the ingest route validates the id's SHAPE before anything
    // else — ids under eight characters are rejected as junk, and "ua-curl" is
    // seven, which turned a user-agent test into a 400 about something else.
    const vid = `useragent-${name}`;
    const n = await send(vid, COUNTED_ORIGIN, { "User-Agent": ua });
    eq(`${shouldCount ? "counted" : "turned away"} — ${name}`, n > 0, shouldCount);
  };

  await asAgent("googlebot", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", false);
  await asAgent("headless-chrome", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/120 Safari/537.36", false);
  await asAgent("curl", "curl/8.4.0", false);
  await asAgent("python-requests", "python-requests/2.31.0", false);
  await asAgent("node-fetch", "node-fetch/1.0", false);
  await asAgent("facebook-preview", "facebookexternalhit/1.1", false);
  await asAgent("no-user-agent-at-all", "", false);

  await asAgent("safari-on-a-mac", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15", true);
  await asAgent("iphone-safari", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1", true);
  // The four that a careless filter costs you, and every one of them is a
  // shopper who arrived from the shop's own marketing.
  await asAgent("instagram-in-app-browser", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 302.0.0.23.113", true);
  await asAgent("facebook-in-app-browser", "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 [FBAN/FBIOS;FBAV/430.0.0.29.111]", true);
  await asAgent("tiktok-in-app-browser", "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 BytedanceWebview/d8a21c6", true);
  await asAgent("a-cubot-phone", "Mozilla/5.0 (Linux; Android 13; Cubot NOTE 30) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36", true);

  // ── The map still adds up past fifteen cities ───────────────────────────────
  // "Where visitors are" is read as a distribution: the reader tots the Sessions
  // column and compares it to the Sessions tile. A bare LIMIT 15 silently
  // dropped every city past the fifteenth, and their orders with them — so the
  // column stopped adding up to the headline above it, with nothing on screen
  // to say why. A shop trading in one country and a dozen towns passes fifteen
  // without noticing.
  console.log("\n\x1b[1mthe map still adds up past fifteen cities\x1b[0m");

  for (let i = 0; i < 20; i++) {
    await pool.query(
      `INSERT INTO analytics_events (visitor_id, session_id, event_type, path, geo_city, geo_country, visitor_scope, created_at)
       VALUES ($1,$1,'page_view','/',$2,'IE','persistent',NOW())`,
      [`manycity-v${i}`, `Town${String(i).padStart(2, "0")}`]);
  }
  const mapped = await get();
  eq("the table is capped at fifteen cities plus a fold row", mapped.locations.length, 16);
  eq("…and the fold names how many it stands for",
    /^\+ \d+ more$/.test(mapped.locations[mapped.locations.length - 1].city), true);
  eq("…so every session is still on the map",
    mapped.locations.reduce((n, l) => n + l.sessions, 0), mapped.traffic.sessions);
  eq("…and every order",
    mapped.locations.reduce((n, l) => n + l.orders, 0), mapped.sales.attributed_orders);


  // ── How long anyone actually spent here ─────────────────────────────────────
  // The metric the dashboard had no answer for, and the first one asked after
  // "how many people". Measured Google's way or it is worthless: a number called
  // "engagement time" is read against every benchmark the reader has ever seen,
  // so it has to be FOREGROUND, VISIBLE time rather than wall-clock session
  // length — a tab left open over lunch is not two hours of interest.
  console.log("\n\x1b[1mhow long anyone actually spent here\x1b[0m");

  const engaged = (visitor, ms, events) => fetch(`${API}/api/analytics/events`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: COUNTED_ORIGIN },
    body: JSON.stringify({
      visitor_id: visitor, session_id: visitor, visitor_scope: "persistent",
      engagement_ms: ms, events,
    }),
  });

  const pv = (path = "/") => ({ type: "page_view", path });
  const engagementOf = async (visitor) => (await pool.query(
    `SELECT COALESCE(SUM(engagement_ms), 0)::int AS ms FROM analytics_events WHERE visitor_id = $1`,
    [visitor])).rows[0].ms;

  await engaged("engagement-one", 12000, [pv("/"), pv("/shop"), pv("/basket")]);
  // The delta belongs to the BATCH. Written to every row it would be counted
  // once per event that happened to share a flush, so a busy visit would report
  // three times the engagement of a quiet one of identical length.
  eq("a batch's engagement is counted once, not once per event",
    await engagementOf("engagement-one"), 12000);

  await engaged("engagement-one", 8000, [pv("/checkout")]);
  eq("…and successive batches add up", await engagementOf("engagement-one"), 20000);

  // An unbounded value here would move the shop's average on its own.
  await engaged("engagement-huge", 999999999, [pv("/")]);
  eq("an impossible duration is clamped, not believed", await engagementOf("engagement-huge"), 60 * 60 * 1000);
  await engaged("engagement-neg", -5000, [pv("/")]);
  eq("a negative duration is refused", await engagementOf("engagement-neg"), 0);
  await engaged("engagement-junk", "not-a-number", [pv("/")]);
  eq("a non-numeric duration is refused", await engagementOf("engagement-junk"), 0);

  // Google's engaged-session rule: ten seconds, OR a second page view, OR a
  // purchase. Each limb has to work on its own, or the rate is not the rate the
  // benchmarks are quoted in.
  await engaged("engagement-brief", 2000, [pv("/")]);            // 2s, one page  -> not engaged
  await engaged("engagement-ten", 11000, [pv("/")]);             // 11s, one page -> engaged on time
  await engaged("engagement-pages", 1000, [pv("/"), pv("/shop")]); // 1s, two pages -> engaged on depth

  const eng = await get();
  eq("engagement rate is reported once there is anything to report",
    typeof eng.traffic.engagement_rate, "number");
  eq("…and an average engagement time with it",
    typeof eng.traffic.avg_engagement_seconds, "number");
  eq("…as a percentage that cannot exceed one hundred",
    eng.traffic.engagement_rate <= 100 && eng.traffic.engagement_rate >= 0, true);

  const sessionEngaged = async (sid) => (await pool.query(
    `SELECT (SUM(engagement_ms) >= 10000
             OR COUNT(*) FILTER (WHERE event_type = 'page_view') >= 2
             OR BOOL_OR(event_type = 'purchase')) AS engaged
       FROM analytics_events WHERE session_id = $1`, [sid])).rows[0].engaged;
  eq("eleven seconds on one page is an engaged session", await sessionEngaged("engagement-ten"), true);
  eq("a second page view is an engaged session", await sessionEngaged("engagement-pages"), true);
  eq("two seconds on one page is not", await sessionEngaged("engagement-brief"), false);

  // A window measured before any of this existed must say "not measured", never
  // 0%. They are opposite conclusions, and a confident zero gets acted on.
  const oldWindow = await (await fetch(
    `${API}/api/admin/analytics?start=2026-01-01&end=2026-01-31`, { headers: auth })).json();
  eq("a period from before this was measured reports nothing, not zero",
    [oldWindow.traffic.engagement_rate, oldWindow.traffic.avg_engagement_seconds], [null, null]);


  // ── Nothing recorded is reported nowhere ────────────────────────────────────
  // Five event types were being collected and shown in no section on the page:
  // taking a product back OUT of the basket, clicking a card in a grid, joining
  // the list, opening an account, and signing back in. Three of them existed
  // only inside the bounce rule — used as evidence that SOMETHING deliberate had
  // happened, with the number itself thrown away.
  //
  // Measuring something and never reporting it is the quietest gap of all: it
  // costs storage and answers nothing, and nobody asks after a number they have
  // never been shown.
  console.log("\n\x1b[1mnothing recorded is reported nowhere\x1b[0m");

  const act = (sid, vid, type, props = {}) => pool.query(
    `INSERT INTO analytics_events (visitor_id, session_id, event_type, path, props, visitor_scope, created_at)
     VALUES ($1,$2,$3,'/',$4,'persistent',NOW())`, [vid, sid, type, JSON.stringify(props)]);

  const beforeAccounts = (await get()).accounts;
  await act("acct-session-1", "acct-visitor-1", "newsletter_signup");
  await act("acct-session-1", "acct-visitor-1", "newsletter_signup"); // pressed twice
  await act("acct-session-2", "acct-visitor-2", "signup", { method: "email" });
  await act("acct-session-3", "acct-visitor-3", "login", { method: "email" });
  const afterAccounts = (await get()).accounts;

  eq("joining the list is reported at all",
    afterAccounts.newsletter_signups, beforeAccounts.newsletter_signups + 1);
  eq("…counted once per visit, however many times the form was pressed",
    afterAccounts.newsletter_signups - beforeAccounts.newsletter_signups, 1);
  eq("opening an account is reported", afterAccounts.account_signups, beforeAccounts.account_signups + 1);
  eq("coming back to sign in is reported", afterAccounts.sign_ins, beforeAccounts.sign_ins + 1);

  // Putting something back is a different problem from never adding it — price,
  // delivery cost, or a second look — and it had no column anywhere.
  await act("putback-session", "putback-visitor", "view_item", { product_id: "pb-1", name: "Putback Candle" });
  await act("putback-session", "putback-visitor", "add_to_cart", { product_id: "pb-1", name: "Putback Candle" });
  await act("putback-session", "putback-visitor", "remove_from_cart", { product_id: "pb-1" });
  const withPutback = await get();
  const pb = withPutback.top_products.find(p => p.name === "Putback Candle");
  eq("a product taken back out of the basket is reported", pb?.removals, 1);
  eq("…without being counted as never added", pb?.add_to_carts, 1);

  // select_item is GA4's own funnel stage and the only thing that separates a
  // shelf nobody scrolls from one whose products disappoint on the second click.
  await act("clicked-session", "clicked-visitor", "page_view");
  await act("clicked-session", "clicked-visitor", "view_item_list", { list_id: "all" });
  await act("clicked-session", "clicked-visitor", "select_item", { product_id: "pb-1", position: 1 });
  const withClick = await get();
  const stages = withClick.funnel.map(f => f.stage);
  eq("clicking a product is a funnel stage", stages.includes("Clicked a product"), true);
  eq("…in GA4's order, between the grid and the product page",
    stages.indexOf("Clicked a product") > stages.indexOf("Browsed a collection")
      && stages.indexOf("Clicked a product") < stages.indexOf("Viewed a product"), true);
  // The funnel's whole guarantee is that it cannot widen as it descends.
  const counts = withClick.funnel.map(f => f.sessions);
  eq("…and the funnel still never widens",
    counts.every((n, i) => i === 0 || n <= counts[i - 1]), true);

  // ── Tables that are read as totals must total ───────────────────────────────
  // Top products sits directly under the Revenue tile and Top pages under Page
  // views, and both were bare LIMIT 10s. The moment the shop listed an eleventh
  // product the two columns stopped agreeing, and the difference appeared
  // nowhere — the same defect already found and fixed on the location table.
  console.log("\n\x1b[1mtables read as totals must total\x1b[0m");

  const many = async (n, fn) => { for (let i = 0; i < n; i++) await fn(i); };
  await many(14, async (i) => {
    const id = `many-${String(i).padStart(2, "0")}`;
    await pool.query(
      `INSERT INTO analytics_events (visitor_id, session_id, event_type, path, props, visitor_scope, created_at)
       VALUES ($1,$1,'view_item','/products/x',$2,'persistent',NOW())`,
      [`manyprod-v${i}`, JSON.stringify({ product_id: id, name: `Many Candle ${i}` })]);
    await pool.query(
      `INSERT INTO analytics_events (visitor_id, session_id, event_type, path, visitor_scope, created_at)
       VALUES ($1,$1,'page_view',$2,'persistent',NOW())`, [`manypage-v${i}`, `/page-${i}`]);
  });

  const wide = await get();
  const prodFold = wide.top_products[wide.top_products.length - 1];
  const pageFold = wide.top_pages[wide.top_pages.length - 1];
  eq("top products folds instead of truncating", /^\+ \d+ more$/.test(prodFold.name), true);
  eq("…so product revenue still adds up to the Revenue tile",
    +wide.top_products.reduce((n, p) => n + p.revenue, 0).toFixed(2), wide.sales.revenue);
  eq("…and the fold quotes no blended rate, which would mean nothing",
    [prodFold.view_to_cart_pct, prodFold.cart_to_buy_pct], [null, null]);
  eq("top pages folds instead of truncating", /^\+ \d+ more$/.test(pageFold.path), true);
  eq("…so views still add up to the Page views tile",
    wide.top_pages.reduce((n, p) => n + p.views, 0), wide.traffic.pageviews);
  // Per-page session counts OVERLAP — one visitor reads several pages — so the
  // fold must refuse to add them rather than print a confident wrong total.
  eq("…and refuses to total a column that cannot be totalled", pageFold.sessions, null);

  // ── One shopper cannot cost another their measurement ──────────────────────
  // Ingestion's rate limit was keyed on req.ip, which behind Netlify + Railway is
  // the SAME address for every visitor — one shared bucket for the whole shop.
  // Past it, everyone's events were dropped, silently (the storefront swallows
  // ingestion errors by design), and the dashboard showed plausible-looking
  // numbers rather than an outage: sessions cut off mid-journey, carts and
  // checkouts missing while server-written purchases still arrived. It failed
  // hardest on the busiest days and never on the quiet ones.
  //
  // Runs LAST: it deliberately exhausts a bucket, and the rows it writes would
  // otherwise move the totals every check above is pinned to.
  console.log("\n\x1b[1mone shopper cannot throttle another\x1b[0m");

  const fromEdge = (edgeIp, n) => fetch(`${API}/api/analytics/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json", Origin: COUNTED_ORIGIN,
      "X-Og-Client-Ip": edgeIp,
      // Both shoppers arrive through the same pair of proxies, which is the
      // shape production has and the reason req.ip is useless here.
      "X-Forwarded-For": `${edgeIp}, 203.0.113.99`,
    },
    body: JSON.stringify({
      visitor_id: `rl-${n}`, session_id: `rl-${n}`, visitor_scope: "persistent",
      events: [{ type: "page_view", path: "/" }],
    }),
  });

  let busyBlocked = 0;
  for (let i = 0; i < 230; i++) {
    if ((await fromEdge("198.51.100.11", `busy-${i}`)).status === 429) busyBlocked++;
  }
  eq("a single visitor is still capped", busyBlocked > 0, true);
  eq("…and a different visitor is completely unaffected",
    (await fromEdge("192.0.2.77", "quiet-1")).status, 204);
  // The failure this replaces, stated as its own check: before the fix the line
  // above answered 429 — a shopper who had never visited before, turned away
  // because someone else had been browsing.
  eq("…even after the busy one has been cut off",
    (await fromEdge("192.0.2.77", "quiet-2")).status, 204);

  await pool.end();
  console.log(`\n${fails.length ? `\x1b[31m${fails.length} FAILED\x1b[0m` : "\x1b[32mall checks passed\x1b[0m"}`);
  if (fails.length) { fails.forEach(f => console.log(`\n  ${f}`)); process.exitCode = 1; }

  // `--serve` leaves the stack up so the panel can be opened against this exact
  // fixture data: start the "web-analytics-check" preview and sign in to /admin
  // with the credentials printed below. Ctrl-C tears everything down.
  if (process.argv.includes("--serve")) {
    console.log(`\nbackend http://localhost:${PORT} — admin ${ADMIN.email} / ${ADMIN.password}`);
    console.log("open the 'web-analytics-check' preview (frontend on :5199), then Ops → Analytics");
    await new Promise(() => {});
  }
}

let failed = false;

// The verdict, somewhere it cannot be overwritten.
//
// Two things had been quietly turning failures into a green run — the one bug a
// test suite must not have:
//
//   • embedded-postgres tears down by calling process.exit(0) itself, which
//     wins over any exit code set before it and even skipped the explicit
//     process.exit() that used to live in the `finally` below;
//   • a run where the stack never came up (a previous `--serve` still holding
//     the port) asserted NOTHING and exited 0 — green, and blind.
//
// An 'exit' listener is the last word: Node still honours a process.exitCode
// assigned from inside one, whoever called exit and with whatever code.
process.on("exit", () => {
  if (checks === 0 && !fails.length) {
    console.error(`\n\x1b[31mno checks ran\x1b[0m — the stack never came up. Is a previous ` +
      `\`npm run test:analytics -- --serve\` still holding port ${PG_PORT} or ${PORT}?`);
  }
  if (failed || fails.length || checks === 0) process.exitCode = 1;
});

try { await main(); failed = fails.length > 0; }
catch (e) { console.error(e); failed = true; }
finally {
  try {
    kids.forEach(c => { try { c.kill("SIGKILL"); } catch {} });
    await new Promise(r => setTimeout(r, 800)); // let backend pools close before PG goes
    if (pg) await pg.stop().catch(() => {});
    rmSync(PG_DIR, { recursive: true, force: true });
  } catch (e) {
    console.error("teardown:", e?.message || e); // cleanup must never mask the verdict
  }
  process.exit(failed ? 1 : 0);
}
