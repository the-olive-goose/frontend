/**
 * The Olive Goose — Abandoned Cart E2E Suite
 *
 * The whole feature, end to end, on the isolated stack: a real basket left
 * behind, a real admin configuring the email in the real dashboard, the real
 * message read off the wire, the real link followed, a real Stripe payment, and
 * the recovered sale credited back to the reminder that earned it.
 *
 * Three things make this suite possible, and each is a fixture rather than a
 * mock of our own code:
 *
 *   - the basket is SEEDED with `updated_at` backdated 30 hours
 *     (seedAbandonedCart in e2e/setup/seed.mjs). The shortest delay the settings
 *     allow is an hour and no test can wait for one, and a basket touched during
 *     the run is by definition not idle;
 *   - the sender is pointed at e2e/setup/email-sink.mjs via RESEND_ORIGIN, so
 *     the message that would have gone to Resend is readable in full — recipient,
 *     subject, headers, HTML, plain text. With RESEND_API_KEY empty the sender
 *     only logs (nothing to assert); with a real key it emails a real person;
 *   - the sweep runs every few seconds instead of every quarter hour
 *     (ABANDONED_CART_SWEEP_MS), so the AUTOMATIC path — the half of this feature
 *     that runs while nobody is watching — is actually exercised.
 *
 * Run by phase 1c of e2e/run-e2e.mjs, which boots a backend with all three.
 *
 * Serial by necessity: every test moves the same basket one step further along
 * its life, and the guards under test are all "has this already happened?".
 */

import { test, expect, request as pwRequest, type APIRequestContext, type Page } from "@playwright/test";
import { readFileSync, existsSync } from "fs";
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { payStripeTestCard } from "./stripe-checkout";
import { fillDeliveryAddress } from "./address-form";

const API = process.env.E2E_API ?? "http://localhost:3001";
const BASE = process.env.E2E_BASE ?? "http://localhost:8080";
const ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL ?? "e2e-admin@test.local",
  password: process.env.E2E_ADMIN_PASSWORD ?? "E2eAdmin123!",
};
const SHOPPER = { email: "e2e-cart@test.local", password: "E2eShopper123" };
/** The name the seed gives that account — {first_name} has to resolve to this. */
const SHOPPER_FIRST_NAME = "Aoife";

/**
 * The template this suite writes, and then reads back out of the email.
 *
 * Every token in it is one the admin can type, and every assertion below is a
 * value only the SERVER can produce — the shopper's first name, their own item
 * lines, the subtotal, the live free-shipping clause. Re-applied after each
 * re-seed, because re-seeding clears the settings back to the shipped default.
 */
const TEMPLATE = {
  subject: "Still thinking it over, {first_name}?",
  preheader: "Your basket is still here.",
  body:
    "Hi {first_name},\n\n" +
    "Your {item_count} items are still here — {cart_total} in total.\n\n" +
    "{cart_items}\n\n" +
    "{cart_button}\n\n" +
    "Delivery is free {free_shipping}.",
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SINK_FILE = process.env.EMAIL_SINK_FILE ?? path.join(__dirname, "..", ".e2e-email-sink.jsonl");

const auth = (token: string) => ({ Authorization: `Bearer ${token}`, Origin: BASE });

let TOKEN = "";

/** What the suite leaves behind: the shipped default, switched off. */
const DEFAULTS_OFF = { enabled: false, quiet_hours_start: 22, quiet_hours_end: 8 };

// ── The sink ──────────────────────────────────────────────────────────────────

interface SentEmail {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}

/** Every message the backend has handed to the sender so far, oldest first. */
const sentEmails = (): SentEmail[] => {
  if (!existsSync(SINK_FILE)) return [];
  return readFileSync(SINK_FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line).body)
    .filter(Boolean);
};

/**
 * Wait for the next message to `address` after `from` in the log.
 *
 * Indexed rather than "the last one", because the sweep runs on its own clock
 * throughout this suite: "the newest email" can be one this test did not cause.
 */
const nextEmailTo = async (address: string, from: number): Promise<SentEmail> => {
  let found: SentEmail | undefined;
  await expect(async () => {
    found = sentEmails().slice(from).find((e) => e.to === address);
    expect(found, `an email to ${address} should have been sent`).toBeTruthy();
  }).toPass({ timeout: 20_000, intervals: [250, 500, 1000] });
  return found!;
};

/**
 * The newest basket REMINDER sent to an address.
 *
 * Not simply the newest email to them: this shopper also receives an order
 * confirmation when the recovery test pays for the basket, and "the last email"
 * quietly became that one — a test failure that looked like a missing opt-out
 * link. Reminders are the messages that carry the basket opt-out line, which is
 * also the thing that makes them marketing rather than transactional.
 */
const lastReminderTo = (address: string): SentEmail => {
  const found = sentEmails()
    .filter((e) => e.to === address && e.text.includes("Don't want basket reminders?"))
    .pop();
  expect(found, `a basket reminder should have been sent to ${address}`).toBeTruthy();
  return found!;
};

/** The opt-out token carried by one message — per recipient, never shared. */
const optOutToken = (email: SentEmail): string => {
  const match = email.text.match(/unsubscribe\?token=([a-z0-9]+)/i);
  expect(match, "every reminder must carry an opt-out link").toBeTruthy();
  return match![1];
};

// ── Fixtures ──────────────────────────────────────────────────────────────────

/**
 * Put the basket back the way it started: two items, idle 30 hours, no reminders
 * sent, nobody opted out, settings at their defaults.
 *
 * The same seeder globalSetup runs, called again mid-suite. Tests that consume
 * the basket one-way (a purchase empties it; a reminder arms the guards) reset it
 * rather than trying to undo what they did.
 */
const reseedBasket = async () => {
  const res = spawnSync(process.execPath, [path.join(__dirname, "setup", "seed.mjs"), "fixtures"], {
    stdio: "pipe",
    env: process.env,
  });
  expect(res.status, `re-seeding the basket failed: ${res.stderr?.toString()}`).toBe(0);
  // The seed clears the settings row, so the template goes back on. Automatic
  // sending stays off — the tests that want it turn it on deliberately.
  await putSettings({ ...TEMPLATE, enabled: false });
};

interface Candidate {
  user_id: string;
  email: string;
  full_name: string;
  items: Array<{ product_id: string; name: string; quantity: number; unit_price: number; line_total: number; image_url: string }>;
  cart_total: number;
  idle_hours: number;
  reminders_sent: number;
  is_abandoned: boolean;
  blocked_reason: string | null;
  quiet_hours: boolean;
  due: boolean;
}

interface Overview {
  settings: Record<string, unknown>;
  sample_context: { first_name: string; cart_total: string; cart_url: string; items: unknown[] };
  sample_is_real: boolean;
  discount_problem: string | null;
  discount_value: string;
  email_configured: boolean;
  carts: Candidate[];
  stats: { sent_total: number; recovered_total: number; recovered_revenue: number };
  history: Array<{ email: string; trigger_source: string; delivered: boolean; recovered_at: string | null; recovered_order_number: string | null; reminder_number: number }>;
}

let admin: APIRequestContext;

const overview = async (): Promise<Overview> => {
  const res = await admin.get(`${API}/api/admin/abandoned-carts`, { headers: auth(TOKEN) });
  expect(res.ok(), "the abandoned-cart overview should load").toBeTruthy();
  return res.json();
};

const ourCart = async (): Promise<Candidate> => {
  const found = (await overview()).carts.find((c) => c.email === SHOPPER.email);
  expect(found, `${SHOPPER.email} should have a basket waiting — check the seed`).toBeTruthy();
  return found!;
};

const putSettings = async (patch: Record<string, unknown>) => {
  const current = (await overview()).settings;
  const res = await admin.put(`${API}/api/admin/abandoned-carts/settings`, {
    headers: auth(TOKEN),
    data: { ...current, ...patch },
  });
  expect(res.ok(), "saving the settings should succeed").toBeTruthy();
  return res.json();
};

/**
 * Open the dashboard already signed in.
 *
 * The token goes into localStorage rather than through the login form: the auth
 * endpoint is rate-limited per IP, and this suite opens the dashboard in several
 * tests. The overlays are seeded away for the reason mobile-journey documents —
 * the cookie banner and the newsletter card both anchor to the bottom of the
 * viewport and will happily eat a click meant for a button underneath them.
 */
const openPanel = async (page: Page) => {
  await page.context().addInitScript(([token]) => {
    try {
      localStorage.setItem("admin_token", token as string);
      localStorage.setItem("og_cookie_consent", "declined");
      localStorage.setItem("og_subscribe_popup_dismissed", "1");
    } catch { /* storage blocked — the overlays become this test's problem */ }
  }, [TOKEN]);
  await page.goto(`${BASE}/admin`);
  // The group button's accessible name carries its icon ("⚙️ Ops"), and the item
  // under it is "Ops Overview" — hence anchoring on the end of the name.
  await page.getByRole("button", { name: /ops$/i }).first().click();
  await page.getByRole("button", { name: /abandoned carts/i }).click();
  await expect(page.getByRole("heading", { name: /abandoned carts/i })).toBeVisible({ timeout: 15_000 });
};

test.beforeAll(async () => {
  admin = await pwRequest.newContext();
  const res = await admin.post(`${API}/api/auth/login`, { data: ADMIN, headers: { Origin: BASE } });
  expect(res.ok(), "admin login should succeed — seed the isolated stack first").toBeTruthy();
  TOKEN = (await res.json()).token;
});

test.describe.configure({ mode: "serial" });

// ═══ 1. Authorization ═════════════════════════════════════════════════════════
// This panel lists customer email addresses and can email them. Neither is
// something an anonymous request or a customer session may reach.

test.describe("authorization", () => {
  test("anonymous and customer requests are refused", async ({ request }) => {
    const routes: Array<[string, string]> = [
      ["GET", "/api/admin/abandoned-carts"],
      ["PUT", "/api/admin/abandoned-carts/settings"],
      ["POST", "/api/admin/abandoned-carts/send"],
      ["POST", "/api/admin/abandoned-carts/test"],
    ];
    for (const [method, route] of routes) {
      const res = method === "GET"
        ? await request.get(`${API}${route}`)
        : method === "PUT"
          ? await request.put(`${API}${route}`, { data: {} })
          : await request.post(`${API}${route}`, { data: { confirm: true } });
      expect(res.status(), `${method} ${route} anonymous`).toBe(401);
    }

    // And with a real customer session cookie rather than no credentials at all.
    const shopper = await pwRequest.newContext({ baseURL: API, extraHTTPHeaders: { Origin: BASE } });
    expect((await shopper.post(`/api/user/login`, { data: SHOPPER })).ok()).toBeTruthy();
    expect((await shopper.get(`/api/admin/abandoned-carts`)).status()).toBe(401);
    await shopper.dispose();
  });

  test("a send must be confirmed explicitly", async () => {
    const res = await admin.post(`${API}/api/admin/abandoned-carts/send`, {
      headers: auth(TOKEN), data: {},
    });
    expect(res.status(), "an unconfirmed send is refused").toBe(400);
    expect((await res.json()).error).toMatch(/not confirmed/i);
  });
});

// ═══ 2. What the server sees ══════════════════════════════════════════════════

test.describe("the waiting basket", () => {
  test("is listed, priced from the live catalogue, and due", async () => {
    const cart = await ourCart();
    expect(cart.items.length, "both seeded items are in it").toBe(2);
    expect(cart.idle_hours, "seeded 30 hours idle").toBeGreaterThanOrEqual(29);
    expect(cart.is_abandoned).toBe(true);
    expect(cart.reminders_sent).toBe(0);
    expect(cart.blocked_reason).toBeNull();

    // The money is the catalogue's, recomputed — not the snapshot the browser
    // stored on the cart row, which goes stale the moment a price is edited.
    const products = await (await admin.get(`${API}/api/content/products`)).json();
    const priceOf = (id: string) => {
      const p = (products.items ?? []).find((x: { id: string }) => String(x.id) === String(id));
      return parseFloat(String(p?.price ?? "").replace(/[^0-9.]/g, "")) || 0;
    };
    const expected = cart.items.reduce((sum, i) => sum + priceOf(i.product_id) * i.quantity, 0);
    expect(cart.cart_total).toBeCloseTo(expected, 2);
    for (const item of cart.items) {
      expect(item.name, "names come from the catalogue").toBeTruthy();
      expect(item.line_total).toBeCloseTo(priceOf(item.product_id) * item.quantity, 2);
    }
  });

  test("the preview context is built from that real basket", async () => {
    const data = await overview();
    expect(data.sample_is_real, "a real basket is waiting, so preview it").toBe(true);
    expect(data.sample_context.first_name).toBe(SHOPPER_FIRST_NAME);
    expect(data.sample_context.items).toHaveLength(2);
    expect(data.sample_context.cart_total).toMatch(/^€\d+\.\d{2}$/);
    // The tags Google and Meta read the recovery by.
    expect(data.sample_context.cart_url).toContain("/basket?");
    expect(data.sample_context.cart_url).toContain("utm_medium=email");
    expect(data.sample_context.cart_url).not.toMatch(/gclid|fbclid/i);
    expect(data.email_configured, "this phase runs with the email sink").toBe(true);
  });
});

// ═══ 3. The dashboard ═════════════════════════════════════════════════════════

test.describe("the Ops panel", () => {
  test("shows the basket, and previews the email it would send", async ({ page }) => {
    await openPanel(page);
    const cart = await ourCart();

    // The waiting list — the shopper, their basket, and the verdict.
    const row = page.locator("tr", { hasText: SHOPPER.email });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText(cart.items[0].name);
    await expect(row).toContainText("Due now");

    // The preview, rendered from that same basket: every item, and the subtotal.
    const preview = page.getByRole("region", { name: /email preview/i });
    for (const item of cart.items) await expect(preview).toContainText(item.name);
    await expect(preview).toContainText(`€${cart.cart_total.toFixed(2)}`);
    await expect(preview).toContainText(`Hi ${SHOPPER_FIRST_NAME},`);
    // The opt-out line is part of what goes out, so it is part of the preview.
    await expect(preview).toContainText(/stop basket reminders/i);
  });

  test("the admin can rewrite the email, and the tokens resolve", async ({ page }) => {
    await openPanel(page);

    await page.getByLabel("Subject", { exact: true }).fill(TEMPLATE.subject);
    await page.getByLabel("Preheader", { exact: true }).fill(TEMPLATE.preheader);
    // The one textarea on this panel — the composer, with its B/I/U toolbar.
    await expect(page.locator("textarea")).toHaveCount(1);
    await page.locator("textarea").fill(TEMPLATE.body);
    await page.getByRole("button", { name: /save settings/i }).click();

    // Saved, and normalised by the server rather than trusted from the browser.
    await expect(async () => {
      const data = await overview();
      expect(data.settings.subject).toBe(TEMPLATE.subject);
      expect(String(data.settings.body)).toContain("{cart_items}");
    }).toPass({ timeout: 10_000 });

    // And the preview now speaks in that shopper's own numbers.
    const cart = await ourCart();
    const preview = page.getByRole("region", { name: /email preview/i });
    await expect(preview).toContainText(`Your ${cart.items.reduce((n, i) => n + i.quantity, 0)} items are still here`);
    await expect(preview).toContainText(`€${cart.cart_total.toFixed(2)} in total`);
    await expect(preview).toContainText(/delivery is free on (all orders|orders over €)/i);
  });

  test("a mistyped discount code is reported before anything is sent", async () => {
    const saved = await putSettings({ discount_code: "no-such-code" });
    expect(saved.settings.discount_code, "normalised to the shape the codes table uses").toBe("NO-SUCH-CODE");
    expect(saved.discount_problem).toMatch(/no discount code by that name/i);
    await putSettings({ discount_code: "" });
  });
});

// ═══ 4. The test send ═════════════════════════════════════════════════════════

test.describe("the rehearsal", () => {
  test("a test send reaches the sender, marked as a test and with a sample basket", async ({ page }) => {
    const before = sentEmails().length;
    await openPanel(page);
    await page.getByLabel("Test recipient", { exact: true }).fill(ADMIN.email);
    await page.getByRole("button", { name: /send test/i }).click();

    const email = await nextEmailTo(ADMIN.email, before);
    expect(email.subject, "a test is labelled as one in the inbox").toMatch(/^\[TEST\]/);
    expect(email.subject).toContain("Still thinking it over");
    // A sample basket, not a customer's — the admin needs the layout, not
    // somebody's shopping.
    expect(email.html).toMatch(/Subtotal/);
    // The opt-out link in a test belongs to nobody, and the page says so.
    expect(email.text).toContain("unsubscribe?token=preview");
  });
});

// ═══ 5. The real thing ════════════════════════════════════════════════════════

test.describe("sending for real", () => {
  test("Send now emails that shopper their own basket", async ({ page }) => {
    const before = sentEmails().length;
    const cart = await ourCart();

    await openPanel(page);
    // The button asks first — naming the person and the amount, not "are you sure".
    page.once("dialog", (d) => {
      expect(d.message()).toContain(SHOPPER.email);
      expect(d.message()).toContain(cart.cart_total.toFixed(2));
      d.accept();
    });
    await page.locator("tr", { hasText: SHOPPER.email }).getByRole("button", { name: /send now/i }).click();

    const email = await nextEmailTo(SHOPPER.email, before);

    // Addressed to them, in their own words.
    expect(email.subject, "the subject's tokens resolve too").toBe(`Still thinking it over, ${SHOPPER_FIRST_NAME}?`);
    expect(email.text).toContain(`Hi ${SHOPPER_FIRST_NAME},`);

    // Their actual basket: every line, with quantity and money, and the subtotal.
    for (const item of cart.items) {
      expect(email.html, `${item.name} should be in the email`).toContain(item.name);
      expect(email.text).toContain(`${item.name} × ${item.quantity} — €${item.line_total.toFixed(2)}`);
    }
    expect(email.text).toContain(`Subtotal: €${cart.cart_total.toFixed(2)}`);
    expect(email.text).toContain(`Your ${cart.items.reduce((n, i) => n + i.quantity, 0)} items are still here`);

    // The way back, tagged so the sale can be told apart from an ad click.
    expect(email.text).toContain(`${BASE}/basket?`);
    expect(email.text).toContain("utm_medium=email");
    expect(email.text).toContain("utm_campaign=abandoned_cart");
    expect(email.text, "no ad click id is ever invented").not.toMatch(/gclid|fbclid|wbraid/i);

    // Marketing mail, so: a working opt-out and the headers Gmail and Yahoo
    // expect from a bulk sender. A domain that omits these is not rejected, it
    // is quietly filtered — which looks like "nobody opens our emails".
    const token = optOutToken(email);
    expect(token).not.toBe("preview");
    expect(email.headers?.["List-Unsubscribe"]).toBe(`<${BASE}/unsubscribe?token=${token}>`);
    expect(email.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");

    // The preheader — the grey line beside the subject — is hidden in the body.
    expect(email.html).toMatch(/display:none[^>]*>[^<]+</);
  });

  test("the same basket cannot be emailed twice", async () => {
    const cart = await ourCart();
    expect(cart.reminders_sent, "the send was recorded").toBe(1);
    expect(cart.due).toBe(false);
    expect(cart.blocked_reason).toMatch(/already had 1 reminder/i);

    const before = sentEmails().length;
    const res = await admin.post(`${API}/api/admin/abandoned-carts/send`, {
      headers: auth(TOKEN), data: { confirm: true },
    });
    expect(res.status(), "with nobody due, a bulk send refuses").toBe(400);
    expect((await res.json()).error).toMatch(/nothing is due/i);

    // Belt and braces: nothing left the building in the meantime.
    await new Promise((r) => setTimeout(r, 6_000)); // longer than one sweep
    expect(sentEmails().slice(before).filter((e) => e.to === SHOPPER.email)).toHaveLength(0);
  });

  test("the send is in the history, attributed to the button that caused it", async () => {
    const { history, stats } = await overview();
    const row = history.find((h) => h.email === SHOPPER.email);
    expect(row, "the reminder should be listed").toBeTruthy();
    expect(row!.trigger_source).toBe("manual");
    expect(row!.delivered, "the sink accepted it, so it counts as delivered").toBe(true);
    expect(row!.reminder_number).toBe(1);
    expect(row!.recovered_at, "nothing has been bought yet").toBeNull();
    expect(stats.sent_total).toBeGreaterThanOrEqual(1);
  });
});

// ═══ 6. Following the link, and buying ════════════════════════════════════════

test.describe("the shopper comes back", () => {
  test("the link in the email lands on their basket, tags intact", async ({ page }) => {
    const link = lastReminderTo(SHOPPER.email).text.match(/(https?:\/\/\S*\/basket\?\S+)/)![1];

    await page.context().addInitScript(() => {
      try {
        localStorage.setItem("og_cookie_consent", "accepted");
        localStorage.setItem("og_subscribe_popup_dismissed", "1");
      } catch { /* overlays stay — see mobile-journey */ }
    });
    // Sign in first: the basket lives server-side under their account.
    await page.request.post(`${API}/api/user/login`, { data: SHOPPER, headers: { Origin: BASE } });
    await page.goto(link);

    // The shopper is on the basket page, and the campaign tags survived the trip —
    // this is what GA4 reads to credit the recovery to email rather than to
    // whichever ad happened to touch them last.
    expect(page.url()).toContain("/basket");
    expect(page.url()).toContain("utm_campaign=abandoned_cart");

    const cart = await ourCart();
    for (const item of cart.items) {
      await expect(page.getByText(item.name, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    }
  });

  test("buying afterwards credits the reminder with the sale", async ({ page }) => {
    test.setTimeout(240_000);

    await page.context().addInitScript(() => {
      try {
        localStorage.setItem("og_cookie_consent", "accepted");
        localStorage.setItem("og_subscribe_popup_dismissed", "1");
      } catch { /* overlays stay */ }
    });
    await page.request.post(`${API}/api/user/login`, { data: SHOPPER, headers: { Origin: BASE } });
    await page.goto(`${BASE}/basket`);

    await page.getByRole("button", { name: /proceed to checkout/i }).click();
    await page.waitForURL(/\/checkout/, { timeout: 30_000 });
    await fillDeliveryAddress(page, "Aoife Cartwright");
    await page.getByRole("button", { name: /pay|place order|continue to payment/i }).first().click();
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 45_000 });

    // Stripe's own hosted widget — testing their UI, not ours, so a failure to
    // drive it skips rather than fails, exactly as customer-journey does.
    const paid = await payStripeTestCard(page).catch(() => false);
    test.skip(!paid, "Stripe hosted card widget not automatable in this run — the reminder and its tagged link are already proven above.");

    await page.waitForURL(new RegExp(`${BASE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/checkout/success`), { timeout: 90_000 });

    // The sale is credited to the reminder that brought them back — server-side
    // and by shopper, so opening the link on a phone and paying on a laptop still
    // counts.
    await expect(async () => {
      const { history, stats } = await overview();
      const row = history.find((h) => h.email === SHOPPER.email);
      expect(row?.recovered_at, "the reminder should be marked as recovered").toBeTruthy();
      expect(row?.recovered_order_number, "and name the order it recovered").toMatch(/^OG/);
      expect(Number(row?.["recovered_total" as keyof typeof row] ?? 0)).toBeGreaterThan(0);
      expect(stats.recovered_total).toBeGreaterThanOrEqual(1);
      expect(stats.recovered_revenue).toBeGreaterThan(0);
    }).toPass({ timeout: 90_000 });
  });
});

// ═══ 7. The automatic path ════════════════════════════════════════════════════
// The half of this feature nobody is watching when it runs.

test.describe("sending on its own", () => {
  test("nothing goes out while automatic sending is off", async () => {
    await reseedBasket();
    const before = sentEmails().length;
    const cart = await ourCart();
    expect(cart.due, "a fresh basket, due again").toBe(true);
    expect((await overview()).settings.enabled, "off by default").toBe(false);

    await new Promise((r) => setTimeout(r, 8_000)); // two sweeps
    expect(
      sentEmails().slice(before).filter((e) => e.to === SHOPPER.email),
      "the sweep must not send while the switch is off",
    ).toHaveLength(0);
  });

  test("quiet hours hold the sweep back even when it is on", async () => {
    // Quiet from this hour to the next, on the shop's own clock — so "now" is
    // inside the window whatever time the suite happens to run.
    const hour = Number(new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Dublin", hour: "numeric", hourCycle: "h23",
    }).format(new Date()));
    await putSettings({ enabled: true, quiet_hours_start: hour, quiet_hours_end: (hour + 1) % 24 });

    const cart = await ourCart();
    expect(cart.quiet_hours).toBe(true);
    expect(cart.is_abandoned, "still abandoned — it is simply the wrong hour").toBe(true);
    expect(cart.blocked_reason, "and not a block: nothing is wrong").toBeNull();
    expect(cart.due).toBe(false);

    const before = sentEmails().length;
    await new Promise((r) => setTimeout(r, 8_000));
    expect(sentEmails().slice(before).filter((e) => e.to === SHOPPER.email)).toHaveLength(0);
  });

  test("with the window open, the sweep sends it without anyone pressing anything", async () => {
    const before = sentEmails().length;
    // No quiet window at all: start === end means "no window", never "all day".
    await putSettings({ enabled: true, quiet_hours_start: 0, quiet_hours_end: 0 });

    const email = await nextEmailTo(SHOPPER.email, before);
    expect(email.subject).toContain("Still thinking it over");
    expect(email.text).toContain("Subtotal: €");

    const { history } = await overview();
    const row = history.find((h) => h.email === SHOPPER.email);
    expect(row?.trigger_source, "recorded as the sweep's doing, not an admin's").toBe("automatic");
    expect(row?.delivered).toBe(true);
  });

  test("and it does not send the same basket again on the next sweep", async () => {
    const before = sentEmails().length;
    await new Promise((r) => setTimeout(r, 9_000)); // two more sweeps
    expect(
      sentEmails().slice(before).filter((e) => e.to === SHOPPER.email),
      "the cadence guards hold across sweeps",
    ).toHaveLength(0);

    const cart = await ourCart();
    expect(cart.due).toBe(false);
    expect(cart.blocked_reason).toMatch(/already had 1 reminder|follow-up isn't due/i);
  });
});

// ═══ 8. Opting out ════════════════════════════════════════════════════════════

test.describe("opting out", () => {
  test("the link in the email stops basket reminders — and only those", async ({ page }) => {
    // On the newsletter list as well, so the two can be told apart afterwards.
    const subscribe = await admin.post(`${API}/api/subscribers`, {
      headers: { Origin: BASE }, data: { email: SHOPPER.email },
    });
    expect(subscribe.ok(), "the shopper joins the newsletter list").toBeTruthy();

    const token = optOutToken(lastReminderTo(SHOPPER.email));

    // The page describes the link before acting on it — mail clients and scanners
    // prefetch every URL in an email, so a page that opted out on load would
    // remove people who never clicked.
    await page.goto(`${BASE}/unsubscribe?token=${token}`);
    await expect(page.getByRole("heading", { name: /stop basket reminders/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(SHOPPER.email)).toBeVisible();
    await page.getByRole("button", { name: /yes, stop basket reminders/i }).click();
    await expect(page.getByRole("heading", { name: /no more basket reminders/i })).toBeVisible({ timeout: 15_000 });

    // Still on the newsletter list: "stop nagging me about my basket" and "stop
    // emailing me entirely" are different requests.
    const subscribers = await (await admin.get(`${API}/api/subscribers`, { headers: auth(TOKEN) })).json();
    const row = (subscribers as Array<{ email: string; unsubscribed_at: string | null }>)
      .find((s) => s.email === SHOPPER.email);
    expect(row, "the shopper is on the newsletter list").toBeTruthy();
    expect(row!.unsubscribed_at, "and has NOT been unsubscribed from it").toBeNull();
  });

  test("nothing reaches them after that — not the sweep, not the admin", async () => {
    // Deliberately NOT re-seeded: re-seeding would clear the opt-out, which is
    // the one thing under test here.
    const cart = await ourCart();
    expect(cart.blocked_reason, "the opt-out is reported ahead of every other reason").toMatch(/opted out/i);
    expect(cart.due).toBe(false);

    // A manual send ignores the cadence, the cooldown and quiet hours — timing is
    // the admin's call once they have clicked. So a manual send that still
    // refuses is the proof that the opt-out, and nothing else, is what stopped it.
    const before = sentEmails().length;
    const manual = await admin.post(`${API}/api/admin/abandoned-carts/send`, {
      headers: auth(TOKEN), data: { confirm: true, user_id: cart.user_id },
    });
    expect(manual.ok(), "the endpoint answers rather than erroring").toBeTruthy();
    expect((await manual.json()).skipped, "skipped because they opted out").toBe(1);

    // And the sweep — still switched on from the tests above — leaves them alone.
    await new Promise((r) => setTimeout(r, 9_000)); // two sweeps
    expect(
      sentEmails().slice(before).filter((e) => e.to === SHOPPER.email),
      "no reminder may reach an opted-out shopper by any route",
    ).toHaveLength(0);
  });
});

// ═══ 9. Put the shop back ═════════════════════════════════════════════════════

test.afterAll(async () => {
  // Automatic sending is off in the shipped defaults, and this suite turned it
  // on. Leaving it on would arm a live-looking feature in whatever state this
  // database is handed to next.
  if (TOKEN) {
    await admin.put(`${API}/api/admin/abandoned-carts/settings`, {
      headers: auth(TOKEN), data: { ...DEFAULTS_OFF },
    }).catch(() => {});
  }
  await admin?.dispose();
});
