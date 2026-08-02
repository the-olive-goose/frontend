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

  // S1 — desktop, google, full journey. Order has a €10 discount on €110 of goods.
  await ev("s1", "v1", "page_view", at(3, 10), { path: "/", src: "google", dev: "desktop" });
  await ev("s1", "v1", "page_view", at(3, 10, 1), { path: "/shop", src: "google", dev: "desktop" });
  await ev("s1", "v1", "add_to_cart", at(3, 10, 2), { src: "google", dev: "desktop", props: { product_id: "p-a", name: "Candle A" } });
  await ev("s1", "v1", "begin_checkout", at(3, 10, 3), { src: "google", dev: "desktop", props: { total: 100 } });
  await order(O1, u1, 100, 110, 10, at(3, 10, 4), [line("p-a", "Candle A", 55, 2)]);
  await ev("s1", "v1", "purchase", at(3, 10, 4), { path: "/checkout/success", props: { order_id: O1, total: 100 } });

  // S2 — MOBILE, referred by www.instagram.com, lands straight on a product page
  // (never sees /shop) and buys. Trips: mobile-filter revenue, funnel monotonicity,
  // www-stripping, non-direct source revenue.
  await ev("s2", "v2", "page_view", at(2, 12), { path: "/products/candle-b", ref: "https://www.instagram.com/p/xyz", dev: "mobile" });
  await ev("s2", "v2", "add_to_cart", at(2, 12, 1), { path: "/products/candle-b", ref: "https://www.instagram.com/p/xyz", dev: "mobile", props: { product_id: "p-b", name: "Candle B" } });
  await ev("s2", "v2", "begin_checkout", at(2, 12, 2), { dev: "mobile", props: { total: 50 } });
  await order(O2, u2, 50, 50, 0, at(2, 12, 3), [line("p-b", "Candle B", 50, 1)]);
  await ev("s2", "v2", "purchase", at(2, 12, 3), { path: "/checkout/success", props: { order_id: O2, total: 50 } });

  // S3 — mobile, direct, single page view, no engagement → the only true bounce.
  await ev("s3", "v3", "page_view", at(2, 9), { path: "/", dev: "mobile" });

  // S4 — desktop/google, browses and carts a product it never buys.
  await ev("s4", "v4", "page_view", at(1, 14), { path: "/shop", src: "google", dev: "desktop" });
  await ev("s4", "v4", "add_to_cart", at(1, 14, 1), { src: "google", dev: "desktop", props: { product_id: "p-c", name: "Candle C" } });

  // S5 — desktop/google, reaches payment with a €75 basket and never pays.
  await ev("s5", "v5", "page_view", at(1, 16), { path: "/", src: "google", dev: "desktop" });
  await ev("s5", "v5", "add_to_cart", at(1, 16, 1), { src: "google", dev: "desktop", props: { product_id: "p-a", name: "Candle A" } });
  await ev("s5", "v5", "begin_checkout", at(1, 16, 2), { src: "google", dev: "desktop", props: { total: 75 } });

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
      STRIPE_SECRET_KEY: "", FRONTEND_URL: "http://localhost:8081", ANALYTICS_TZ: TZ,
      API_RATE_LIMIT_MAX: "100000", AUTH_RATE_LIMIT_MAX: "100000",
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
  eq("browsed credits a straight-to-product session", stage(1), 4);
  eq("added to cart", stage(2), 4);
  eq("reached payment", stage(3), 3);
  eq("purchased (sentinel excluded)", stage(4), 2);
  eq("funnel never widens", d.funnel.map(f => f.sessions), [6, 4, 4, 3, 2]);
  eq("conversion = purchased / sessions", d.sales.conversion_rate, +(2 / 6 * 100).toFixed(2));
  eq("bounce counts only the unengaged single-pager", d.traffic.bounce_rate, +(2 / 6 * 100).toFixed(1));
  eq("device split sums to sessions", d.devices.reduce((s, x) => s + x.sessions, 0), 6);
  eq("no phantom 'unknown' device", d.devices.filter(x => x.device === "unknown").length, 0);
  eq("desktop sessions", d.devices.find(x => x.device === "desktop")?.sessions, 4);
  eq("mobile sessions", d.devices.find(x => x.device === "mobile")?.sessions, 2);
  eq("abandoned at payment", d.abandoned.abandoned_sessions, 1);
  eq("value left at payment", d.abandoned.lost_revenue, 75);
  eq("sessions reaching payment", d.abandoned.checkout_sessions, 3);

  const src = Object.fromEntries(d.sources.map(s => [s.source, s]));
  eq("instagram host is normalised (www stripped)", Object.keys(src).sort(), ["direct", "google", "instagram.com"]);
  eq("google revenue", src.google?.revenue, 100);
  eq("instagram revenue is not zeroed", src["instagram.com"]?.revenue, 50);
  eq("attribution sessions sum to sessions KPI", d.sources.reduce((s, x) => s + x.sessions, 0), 6);

  const prod = Object.fromEntries(d.top_products.map(p => [p.name, p]));
  eq("product revenue is net of the order discount", prod["Candle A"]?.revenue, 190); // 100 (O1, prorated) + 30 (O3) + 60 (O5)
  eq("cart-only product is still listed", prod["Candle C"]?.units, 0);
  eq("cart-only product shows its demand", prod["Candle C"]?.add_to_carts, 1);
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
  eq("purchased stage is not zero", m.funnel[4]?.sessions, 1);
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
  eq("google abandoned at payment", g.abandoned.abandoned_sessions, 1);

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
