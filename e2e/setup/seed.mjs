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
  // CONTENT ONLY — the `content_` prefix, which is the same line backend/index.js
  // already draws for /api/content and for exactly this reason: everything
  // without it is either a credential or internal state.
  //
  // `site_settings` holds two access tokens — `meta_capi_token` (Meta's
  // Conversions API) and `ga4_api_secret` — and the default seed source is
  // backend/.env's DATABASE_URL, which is the LIVE database. A blanket
  // `SELECT key, value FROM site_settings` therefore copied the shop's real ad
  // credentials onto this machine, into a throwaway Postgres, on every e2e run.
  //
  // The consequence was not theoretical. With the real Meta pixel id and the
  // real token both present, any e2e spec that accepts cookies and completes a
  // Stripe test payment reports that fabricated order to the shop's LIVE Meta
  // pixel: invented revenue in Events Manager, and ad delivery taught to go
  // looking for more people like a Playwright script. An allow-list rather than
  // a deny-list, so the next credential added to this table is safe on the day
  // it is added rather than on the day someone remembers this file.
  const settings = await source.query(
    `SELECT key, value FROM site_settings WHERE key LIKE 'content\\_%'`
  );
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

/**
 * Overwrite whatever the source said about the two advertising tags.
 *
 * Belt to copyContent's braces. The pixel id and the GA4 measurement id are not
 * credentials — they ship in the page source of every site that has them — so
 * they arrive with the content above, and a test run that loaded the shop's REAL
 * pixel id would be one intercept away from writing into its real ad account.
 *
 * So the ids are replaced with test ones. The Meta pixel is left ENABLED and its
 * consent gate switched off, because e2e/__meta-purchase.spec.ts exists to watch
 * the funnel actually reach the wire and can then assert on a pixel id no real
 * account has ever owned. GA4 stays off: nothing asserts on it end to end, and a
 * tag nobody is watching should not be running.
 */
async function pinAdTagsToTest() {
  const metaPixel = {
    enabled: true,
    // 16 digits, no leading zero — the shape fbevents.js accepts (one that starts
    // with a zero it rejects outright with `Invalid PixelID: null`), and not an id
    // Meta has issued to anyone. A placeholder is enough to prove the pixel loads
    // and is gated correctly; it is NOT enough to watch events on the wire, because
    // fbevents.js sends nothing for a pixel Meta does not recognise. Set
    // E2E_META_PIXEL_ID to a scratch pixel you own to assert that half too — see
    // the note at the top of e2e/__meta-purchase.spec.ts.
    pixel_id: process.env.E2E_META_PIXEL_ID || "9999999999999999",
    // As production has it, so every other suite — none of which answers the
    // cookie banner — never loads fbevents.js at all. Only the spec that is
    // watching the pixel seeds a consent choice, and it seeds "accepted".
    require_consent: true,
    // The one setting that has to differ. The e2e storefront is served from
    // localhost, which is exactly what exclude_internal exists to keep the pixel
    // away from, so leaving it on would mean the suite watched a pixel that had
    // correctly refused to load.
    exclude_internal: false,
    track_ecommerce: true,
    advanced_matching: true,
    test_event_code: "",
  };
  await local.query(
    `INSERT INTO site_settings (key, value) VALUES ('content_metaPixel', $1)
     ON CONFLICT (key) DO UPDATE SET value = site_settings.value || $1::jsonb`,
    [JSON.stringify(metaPixel)]
  );
  await local.query(
    `INSERT INTO site_settings (key, value) VALUES ('content_googleAnalytics', '{"enabled": false}')
     ON CONFLICT (key) DO UPDATE SET value = site_settings.value || '{"enabled": false}'::jsonb`
  );
  // And the credentials themselves, in case a database from an older seed is
  // being reused: they can only have come from the source.
  await local.query(
    `DELETE FROM site_settings WHERE key IN ('meta_capi_token', 'ga4_api_secret')`
  );
  console.log("[seed] ad tags pinned to test ids; no credentials copied");
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
    await pinAdTagsToTest();
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
