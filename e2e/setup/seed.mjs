// Seed the isolated test database.
//   node e2e/setup/seed.mjs           → full seed (content + users + fixtures)
//   node e2e/setup/seed.mjs fixtures  → only re-create the OGE2E* fixture orders
//
// Fixtures are re-created idempotently, so this is safe to run before every
// suite invocation (the admin cancellation/return tests consume orders one-way).
import pg from "pg";
import {
  TEST_DATABASE_URL, SEED_SOURCE_DATABASE_URL, SHOPPER, SHOPPER2,
} from "./config.mjs";

// bcrypt("E2eShopper123", cost 10) — same password for both seeded shoppers.
const SHOPPER_PW_HASH = "$2a$10$6bzn9/2asZz4WocYTYXP2uIdJ/L/K/DOCH3xGlktj/WRznHPeO.5u";

const local = new pg.Pool({ connectionString: TEST_DATABASE_URL });

async function copyContent() {
  if (!SEED_SOURCE_DATABASE_URL) {
    console.log("[seed] no SEED_SOURCE_DATABASE_URL — using backend default content");
    return;
  }
  const source = new pg.Pool({
    connectionString: SEED_SOURCE_DATABASE_URL,
    ssl: /railway|amazonaws|supabase|neon/i.test(SEED_SOURCE_DATABASE_URL) ? { rejectUnauthorized: false } : false,
    options: "-c default_transaction_read_only=on", // hard guarantee: never writes to the source
  });
  const settings = await source.query(`SELECT key, value FROM site_settings`);
  for (const row of settings.rows) {
    await local.query(
      `INSERT INTO site_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2`,
      [row.key, JSON.stringify(row.value)]
    );
  }
  for (const table of ["shop_categories", "shop_candles"]) {
    const { rows } = await source.query(`SELECT * FROM ${table}`);
    for (const r of rows) {
      const cols = Object.keys(r);
      const vals = cols.map((_, i) => `$${i + 1}`).join(",");
      await local.query(
        `INSERT INTO ${table} (${cols.join(",")}) VALUES (${vals}) ON CONFLICT (id) DO NOTHING`,
        cols.map((c) => (r[c] !== null && typeof r[c] === "object" ? JSON.stringify(r[c]) : r[c]))
      );
    }
  }
  await source.end();
  console.log(`[seed] copied ${settings.rows.length} content rows from source (read-only)`);
}

async function seedUsers() {
  for (const u of [SHOPPER, SHOPPER2]) {
    await local.query(
      `INSERT INTO users (email, password_hash, full_name, provider, email_verified)
       VALUES ($1, $2, $3, 'email', true)
       ON CONFLICT (email) DO UPDATE SET password_hash = $2, provider = 'email', email_verified = true`,
      [u.email, SHOPPER_PW_HASH, u.email === SHOPPER.email ? "E2E Shopper" : "E2E Shopper Two"]
    );
  }
  console.log("[seed] shopper accounts ready");
}

async function seedFixtures() {
  const { rows: userRows } = await local.query(
    `SELECT id, email FROM users WHERE email IN ($1, $2)`, [SHOPPER.email, SHOPPER2.email]
  );
  const shopper = userRows.find((u) => u.email === SHOPPER.email);
  const shopper2 = userRows.find((u) => u.email === SHOPPER2.email);
  if (!shopper || !shopper2) throw new Error("[seed] shopper accounts missing — run full seed first");

  const { rows: catRows } = await local.query(`SELECT value FROM site_settings WHERE key = 'content_products'`);
  const products = catRows[0]?.value?.items || [];
  if (products.length < 2) throw new Error(`[seed] need >=2 catalog products, have ${products.length} — provide SEED_SOURCE_DATABASE_URL`);
  const [p1, p2] = products;
  const price = (p) => parseFloat(String(p.price).replace(/[^0-9.]/g, "")) || 10;
  const item = (p, qty = 1) => ({ product_id: p.id, product_data: p, quantity: qty });

  // Wipe previous fixtures (events/returns/refund_reminders/decisions cascade or are cleared).
  await local.query(`DELETE FROM refund_reminders WHERE order_id IN (SELECT id FROM orders WHERE tracking_number LIKE 'OGE2E%')`);
  await local.query(`DELETE FROM admin_decisions WHERE order_id IN (SELECT id FROM orders WHERE tracking_number LIKE 'OGE2E%')`);
  await local.query(`DELETE FROM order_events WHERE order_id IN (SELECT id FROM orders WHERE tracking_number LIKE 'OGE2E%')`);
  await local.query(`DELETE FROM returns WHERE order_id IN (SELECT id FROM orders WHERE tracking_number LIKE 'OGE2E%')`);
  await local.query(`DELETE FROM orders WHERE tracking_number LIKE 'OGE2E%'`);

  const insert = (o) => local.query(
    `INSERT INTO orders (user_id, items, subtotal, shipping, total, tracking_number, shipping_address,
                         fulfillment_type, status, payment_status, stripe_session_id, stripe_payment_intent_id,
                         refund_status, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, NOW() - ($14 || ' days')::interval)`,
    [o.user_id, JSON.stringify(o.items), o.subtotal, o.shipping, o.total, o.tracking, JSON.stringify(o.address),
     o.fulfillment, o.status, o.payment, o.sess, o.intent, o.refund ?? "not_applicable", String(o.ageDays ?? 0)]
  );

  const delivery = { fulfillment_type: "delivery", full_name: "E2E Shopper", phone: "+353851234567", address_line1: "1 Test Street", city: "Dublin", postal_code: "D01AB12", country: "Ireland" };
  const pickup = { fulfillment_type: "pickup", location_name: "The Olive Goose", city: "Dublin 18", country: "Ireland" };
  const s1 = price(p1), s2 = price(p2);

  await insert({ user_id: shopper.id, items: [item(p1)], subtotal: s1, shipping: 0, total: s1, tracking: "OGE2EUNPAID", address: pickup, fulfillment: "pickup", status: "Order Placed", payment: "unpaid", sess: null, intent: null });
  await insert({ user_id: shopper.id, items: [item(p1)], subtotal: s1, shipping: 4.99, total: s1 + 4.99, tracking: "OGE2ESTRIPE", address: delivery, fulfillment: "delivery", status: "Processing", payment: "paid", sess: "cs_e2e_fixture_1", intent: "pi_e2e_fixture_1" });
  await insert({ user_id: shopper.id, items: [item(p1)], subtotal: s1, shipping: 4.99, total: s1 + 4.99, tracking: "OGE2ECANA", address: delivery, fulfillment: "delivery", status: "Order Placed", payment: "paid", sess: "cs_e2e_fixture_2", intent: "pi_e2e_fixture_2" });
  await insert({ user_id: shopper.id, items: [item(p1)], subtotal: s1, shipping: 4.99, total: s1 + 4.99, tracking: "OGE2ECANB", address: delivery, fulfillment: "delivery", status: "Order Placed", payment: "paid", sess: "cs_e2e_fixture_3", intent: "pi_e2e_fixture_3" });
  await insert({ user_id: shopper.id, items: [item(p1), item(p2, 2)], subtotal: s1 + 2 * s2, shipping: 0, total: s1 + 2 * s2, tracking: "OGE2ERETURN", address: delivery, fulfillment: "delivery", status: "Delivered", payment: "paid", sess: "cs_e2e_fixture_4", intent: "pi_e2e_fixture_4" });
  await insert({ user_id: shopper.id, items: [item(p2)], subtotal: s2, shipping: 4.99, total: s2 + 4.99, tracking: "OGE2ESTUCK", address: delivery, fulfillment: "delivery", status: "Processing", payment: "paid", sess: "cs_e2e_fixture_5", intent: "pi_e2e_fixture_5", ageDays: 10 });
  await insert({ user_id: shopper2.id, items: [item(p2)], subtotal: s2, shipping: 4.99, total: s2 + 4.99, tracking: "OGE2EIDOR", address: delivery, fulfillment: "delivery", status: "Order Placed", payment: "paid", sess: "cs_e2e_fixture_6", intent: "pi_e2e_fixture_6" });
  console.log("[seed] fixture orders ready (OGE2E*)");
}

const mode = process.argv[2] || "full";
try {
  if (mode === "full") {
    await copyContent();
    await seedUsers();
    await seedFixtures();
  } else if (mode === "fixtures") {
    await seedFixtures();
  } else {
    throw new Error(`unknown seed mode: ${mode}`);
  }
} finally {
  await local.end();
}
