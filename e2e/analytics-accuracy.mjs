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
const ok = (name) => console.log(`  \x1b[32m✓\x1b[0m ${name}`);
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) return ok(name);
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
  const fromIp = (visitor, ip) => send(visitor, COUNTED_ORIGIN, { "X-Forwarded-For": ip });

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

  // Saving one list must not silently blank the other — they are separate
  // controls on the same card, and losing the accounts by editing networks would
  // be invisible until the numbers moved.
  const both = await (await fetch(`${API}/api/admin/analytics/internal`, { headers: auth })).json();
  eq("saving networks kept the account list", both.emails, ["owner@test.local", "other@test.local"]);

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
try { await main(); failed = fails.length > 0; }
catch (e) { console.error(e); failed = true; }
finally {
  kids.forEach(c => { try { c.kill("SIGKILL"); } catch {} });
  await new Promise(r => setTimeout(r, 800)); // let backend pools close before PG goes
  if (pg) await pg.stop().catch(() => {});
  rmSync(PG_DIR, { recursive: true, force: true });
  // Explicit, and last: embedded-postgres' shutdown path resets process.exitCode,
  // so a failing run was reporting success — the one bug a test suite must not have.
  process.exit(failed ? 1 : 0);
}
