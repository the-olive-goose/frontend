/**
 * The Olive Goose — End-to-End Test Suite
 * Run with: npx playwright test e2e/olive-goose.spec.ts --headed
 *
 * Prerequisites:
 *   - Frontend running on http://localhost:8080   (npm run dev)
 *   - Backend  running on http://localhost:3001   (node backend/index.js)
 */

import { test, expect, Page } from "@playwright/test";

const BASE     = process.env.E2E_BASE ?? "http://localhost:8080";
const API      = process.env.E2E_API ?? "http://localhost:3001";
const ADMIN_EMAIL    = process.env.E2E_ADMIN_EMAIL ?? "admin@theolivegoose.ie";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "OliveGoose2026!";

// ─── helpers ───────────────────────────────────────────────────────────────────

async function adminLogin(page: Page) {
  await page.goto(`${BASE}/admin`);
  await page.getByPlaceholder(/email/i).fill(ADMIN_EMAIL);
  await page.getByPlaceholder(/password/i).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /log in|sign in|submit/i }).click();
  // Wait for dashboard to appear
  await expect(page.getByText(/announcement bar|hero|footer/i).first()).toBeVisible({ timeout: 8000 });
}

// ─── 1. HOMEPAGE ───────────────────────────────────────────────────────────────

test.describe("Homepage", () => {
  test("loads and shows navbar", async ({ page }) => {
    await page.goto(BASE);
    // The page has two <nav> landmarks (header + footer), so scope to the first.
    await expect(page.locator("nav").first()).toBeVisible();
    await expect(page.getByText("The Olive Goose").first()).toBeVisible();
  });

  test("announcement bar rotates messages", async ({ page }) => {
    await page.goto(BASE);
    const bar = page.locator("text=/Free shipping|collection|early access/i").first();
    await expect(bar).toBeVisible();
  });

  test("hero section visible with CTAs", async ({ page }) => {
    await page.goto(BASE);
    await expect(page.locator("#hero")).toBeVisible();
    // The hero CTA renders as a <button> (opens the auth modal) for guests and an
    // <a> to /shop once signed in — so assert by its text, not a fixed role.
    const primary = page.locator("#hero").getByText(/shop the collection/i).first();
    await expect(primary).toBeVisible();
  });

  test("SMELLS LIKE section visible", async ({ page }) => {
    await page.goto(BASE);
    await expect(page.getByText(/smells like your/i)).toBeVisible();
  });

  test("products section renders cards", async ({ page }) => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    // Product cards load after their content fetch. A guest sees "Buy Now"; a
    // signed-in shopper sees "Add to Cart" (ScrapbookSection renders one per card).
    const addBtns = page.getByRole("button", { name: /add to cart|buy now/i });
    await expect(addBtns.first()).toBeVisible({ timeout: 20_000 });
  });

  test("moment pill renders its configured copy", async ({ page, request }) => {
    // The pill's text is admin-editable content, so assert whatever line 1 is
    // currently configured actually renders — rather than a hardcoded phrase
    // that breaks the moment marketing edits the copy.
    const pill = await (await request.get(`${API}/api/content/momentPill`)).json();
    const line1 = (pill?.text1 || "").trim();
    await page.goto(BASE);
    if (line1) {
      await expect(page.getByText(line1, { exact: false }).first()).toBeVisible({ timeout: 10_000 });
    } else {
      // No content configured — the section still renders from defaults.
      await expect(page.getByText(/welcome to the olive goose/i)).toBeVisible();
    }
  });

  test("Welcome / Our Story section visible", async ({ page }) => {
    await page.goto(BASE);
    await expect(page.getByText(/welcome to the olive goose/i)).toBeVisible();
  });

  test("Footer quick links visible", async ({ page }) => {
    await page.goto(BASE);
    await expect(page.getByText(/quick links/i)).toBeVisible();
  });

  test("Footer payment icons visible", async ({ page }) => {
    await page.goto(BASE);
    await expect(page.getByTitle("Visa")).toBeVisible();
    await expect(page.getByTitle("Mastercard")).toBeVisible();
  });

  test("Footer policy bar visible", async ({ page }) => {
    await page.goto(BASE);
    await expect(page.getByText(/privacy policy/i)).toBeVisible();
    await expect(page.getByText(/terms of service/i)).toBeVisible();
  });
});

// ─── 2. NAVIGATION ─────────────────────────────────────────────────────────────

test.describe("Navigation", () => {
  test("Candle Care nav link goes to /candle-care", async ({ page }) => {
    await page.goto(BASE);
    await page.getByRole("link", { name: /candle care/i }).click();
    await expect(page).toHaveURL(/\/candle-care/);
    await expect(page.getByText(/candle care|burn it right|first light/i).first()).toBeVisible();
  });

  test("Our Story link takes the visitor to the story", async ({ page }) => {
    await page.goto(BASE);
    const link = page.getByRole("link", { name: /our story/i }).first();
    // The story lives either as an in-page anchor (#story) or on the dedicated
    // /about page, depending on the configured CTA. Follow whichever this build
    // uses and assert the visitor actually lands on story content — that's the
    // guarantee; which of the two implements it is a content decision.
    const href = (await link.getAttribute("href")) ?? "";
    await link.click();
    if (href.startsWith("#")) {
      await expect(page.locator(href)).toBeVisible({ timeout: 4000 });
    } else {
      await expect(page).toHaveURL(new RegExp(href.replace(/^\//, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      await expect(page.getByText(/our story|the olive goose began|slow living/i).first())
        .toBeVisible({ timeout: 10_000 });
    }
  });

  test("Shop nav link points to /shop", async ({ page }) => {
    await page.goto(BASE);
    // The navbar carries a top-level "Shop" link to the storefront.
    const shopLink = page.locator("nav").first().getByRole("link", { name: /^shop$/i }).first();
    await expect(shopLink).toBeVisible();
    await expect(shopLink).toHaveAttribute("href", /\/shop/);
  });
});

// ─── 3. CANDLE CARE PAGE ───────────────────────────────────────────────────────

test.describe("Candle Care page", () => {
  test("loads correctly", async ({ page }) => {
    await page.goto(`${BASE}/candle-care`);
    await expect(page.getByText(/candle care|love it long|burn it right/i).first()).toBeVisible();
  });

  test("has navbar and footer", async ({ page }) => {
    await page.goto(`${BASE}/candle-care`);
    await expect(page.locator("nav").first()).toBeVisible();
    await expect(page.locator("footer")).toBeVisible();
  });
});

// ─── 4. BACKEND API ────────────────────────────────────────────────────────────

test.describe("Backend API", () => {
  test("health check returns ok", async ({ request }) => {
    const res = await request.get(`${API}/api/health`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  test("login with correct credentials returns token", async ({ request }) => {
    const res = await request.post(`${API}/api/auth/login`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.token).toBeTruthy();
  });

  test("login with wrong password returns 401", async ({ request }) => {
    const res = await request.post(`${API}/api/auth/login`, {
      data: { email: ADMIN_EMAIL, password: "wrong-password" },
    });
    expect(res.status()).toBe(401);
  });

  test("login with wrong email returns 401", async ({ request }) => {
    const res = await request.post(`${API}/api/auth/login`, {
      data: { email: "wrong@test.com", password: ADMIN_PASSWORD },
    });
    expect(res.status()).toBe(401);
  });

  test("GET /api/content/navbar returns data", async ({ request }) => {
    const res = await request.get(`${API}/api/content/navbar`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.brand_name).toBeTruthy();
  });

  test("GET /api/content/hero returns data", async ({ request }) => {
    const res = await request.get(`${API}/api/content/hero`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty("headline");
  });

  test("GET /api/content/footer responds (null until an admin saves it)", async ({ request }) => {
    // Footer content is optional managed content: the storefront renders a
    // hardcoded footer when none is saved, so the endpoint returns null until
    // an admin edits it. Assert it responds cleanly, and that when content DOES
    // exist it carries links — never a 500.
    const res = await request.get(`${API}/api/content/footer`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    if (body !== null) expect(body).toHaveProperty("links");
  });

  test("PUT /api/content/hero requires auth", async ({ request }) => {
    const res = await request.put(`${API}/api/content/hero`, {
      data: { headline: "Unauthorized attempt" },
    });
    expect(res.status()).toBe(401);
  });

  test("PUT /api/content/hero saves with valid token", async ({ request }) => {
    // Get token
    const loginRes = await request.post(`${API}/api/auth/login`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    const { token } = await loginRes.json();

    // Fetch current hero
    const currentRes = await request.get(`${API}/api/content/hero`);
    const current = await currentRes.json();

    // Update with a test headline
    const updateRes = await request.put(`${API}/api/content/hero`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { ...current, headline: "E2E Test Headline ✓" },
    });
    expect(updateRes.ok()).toBeTruthy();

    // Verify it persisted
    const verifyRes = await request.get(`${API}/api/content/hero`);
    const verified = await verifyRes.json();
    expect(verified.headline).toBe("E2E Test Headline ✓");

    // Restore original
    await request.put(`${API}/api/content/hero`, {
      headers: { Authorization: `Bearer ${token}` },
      data: current,
    });
  });
});

// ─── 5. ADMIN DASHBOARD ────────────────────────────────────────────────────────

test.describe("Admin Dashboard", () => {
  test("redirects to login if not authenticated", async ({ page }) => {
    await page.goto(`${BASE}/admin`);
    await expect(page.getByPlaceholder(/email/i)).toBeVisible({ timeout: 5000 });
  });

  test("login form works", async ({ page }) => {
    await adminLogin(page);
    await expect(page.url()).toContain("/admin");
  });

  test("Announcement Bar tab saves and reflects on homepage", async ({ page }) => {
    await adminLogin(page);

    // Click Announcement Bar tab
    await page.getByRole("button", { name: /announcement bar/i }).click();

    // Edit first message
    const firstMsg = page.getByPlaceholder(/message 1/i).first();
    await firstMsg.clear();
    await firstMsg.fill("E2E test message 🧪");

    // Save
    await page.getByRole("button", { name: /save changes/i }).click();
    // Both an inline confirmation and a toast render "Saved!" — assert either.
    await expect(page.getByText(/saved|success/i).first()).toBeVisible({ timeout: 5000 });

    // Check homepage shows it
    const homePage = await page.context().newPage();
    await homePage.goto(BASE);
    await expect(homePage.getByText(/E2E test message/i)).toBeVisible({ timeout: 5000 });
    await homePage.close();

    // Restore original message
    await page.getByPlaceholder(/message 1/i).first().fill("✨ Free shipping on orders over $65");
    await page.getByRole("button", { name: /save changes/i }).click();
  });

  test("Hero tab saves headline", async ({ page }) => {
    await adminLogin(page);
    // Sidebar item is labelled "Hero Banner" (with an icon prefix).
    await page.getByRole("button", { name: /hero banner/i }).click();

    // The Field component doesn't associate <label> with its control (no htmlFor),
    // so getByLabel can't resolve it — target the control inside the "Headline"
    // Field. It's a RichInput (<textarea> behind a formatting toolbar), nested one
    // level deeper than a plain <Input>, so match either shape at any depth.
    const headline = page
      .locator('div:has(> label:text-is("Headline"))')
      .locator("textarea, input")
      .first();
    await expect(headline).toBeVisible({ timeout: 10_000 });
    const original = await headline.inputValue();

    await headline.fill("Admin E2E Headline Test");
    await page.getByRole("button", { name: /save changes/i }).click();
    await expect(page.getByText(/saved|success/i).first()).toBeVisible({ timeout: 5000 });

    // Restore
    await headline.fill(original);
    await page.getByRole("button", { name: /save changes/i }).click();
  });

  test("Footer tab is accessible", async ({ page }) => {
    await adminLogin(page);
    await page.getByRole("button", { name: /footer/i }).click();
    await expect(page.getByText(/policy links|footer links|social links/i).first()).toBeVisible();
  });

  test("Logout button works", async ({ page }) => {
    await adminLogin(page);
    await page.getByRole("button", { name: /log out|logout|sign out/i }).click();
    await expect(page.getByPlaceholder(/email/i)).toBeVisible({ timeout: 5000 });
  });
});
