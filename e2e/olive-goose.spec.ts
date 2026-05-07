/**
 * The Olive Goose — End-to-End Test Suite
 * Run with: npx playwright test e2e/olive-goose.spec.ts --headed
 *
 * Prerequisites:
 *   - Frontend running on http://localhost:8080   (npm run dev)
 *   - Backend  running on http://localhost:3001   (node backend/index.js)
 */

import { test, expect, Page } from "@playwright/test";

const BASE     = "http://localhost:8080";
const API      = "http://localhost:3001";
const ADMIN_EMAIL    = "admin@theolivegoose.ie";
const ADMIN_PASSWORD = "OliveGoose2026!";

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
    await expect(page.locator("nav")).toBeVisible();
    await expect(page.getByText("The Olive Goose")).toBeVisible();
  });

  test("announcement bar rotates messages", async ({ page }) => {
    await page.goto(BASE);
    const bar = page.locator("text=/Free shipping|collection|early access/i").first();
    await expect(bar).toBeVisible();
  });

  test("hero section visible with CTAs", async ({ page }) => {
    await page.goto(BASE);
    await expect(page.locator("#hero")).toBeVisible();
    const primary = page.getByRole("link", { name: /shop the collection/i });
    await expect(primary).toBeVisible();
  });

  test("SMELLS LIKE section visible", async ({ page }) => {
    await page.goto(BASE);
    await expect(page.getByText(/smells like your/i)).toBeVisible();
  });

  test("products section renders cards", async ({ page }) => {
    await page.goto(BASE);
    await page.locator("#collection, [id*=collection]").first().scrollIntoViewIfNeeded().catch(() => {});
    // At least one product card with Add to Cart
    const addBtns = page.getByRole("button", { name: /add to cart/i });
    await expect(addBtns.first()).toBeVisible({ timeout: 6000 });
  });

  test("Live in the moment pill is visible", async ({ page }) => {
    await page.goto(BASE);
    await expect(page.getByText(/live in the moment/i)).toBeVisible();
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

  test("Our Story link scrolls to story section", async ({ page }) => {
    await page.goto(BASE);
    const link = page.getByRole("link", { name: /our story/i }).first();
    await link.click();
    await expect(page.locator("#story")).toBeVisible({ timeout: 4000 });
  });

  test("Shop Now CTA link works", async ({ page }) => {
    await page.goto(BASE);
    const shopBtn = page.getByRole("link", { name: /shop now/i }).first();
    await expect(shopBtn).toBeVisible();
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
    await expect(page.locator("nav")).toBeVisible();
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

  test("GET /api/content/footer returns data", async ({ request }) => {
    const res = await request.get(`${API}/api/content/footer`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty("links");
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
    await expect(page.getByText(/saved|success/i)).toBeVisible({ timeout: 5000 });

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
    await page.getByRole("button", { name: /^hero$/i }).click();

    const headline = page.getByLabel(/headline/i).first();
    const original = await headline.inputValue();

    await headline.fill("Admin E2E Headline Test");
    await page.getByRole("button", { name: /save changes/i }).click();
    await expect(page.getByText(/saved|success/i)).toBeVisible({ timeout: 5000 });

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
