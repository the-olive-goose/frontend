/**
 * The Olive Goose — Mobile customer journey & UI/UX regression suite
 *
 * Every other e2e spec runs at desktop width, so the phone experience — which is
 * where most of the traffic actually is — had no automated cover at all. This
 * suite runs the whole journey at iPhone size with touch enabled, and pins the
 * mobile conventions the storefront is built on:
 *
 *   - no page scrolls sideways (the classic "everything is shifted" phone bug)
 *   - the hamburger menu opens, locks the page behind it, navigates, and closes
 *   - `--nav-h` measures the header rows ONLY, so opening the menu doesn't shove
 *     every page's top padding down
 *   - overlays (auth modal, cart drawer, mobile nav) freeze the page behind them
 *     via useBodyScrollLock, so dismissing one doesn't dump you elsewhere
 *   - form fields render at >= 16px, or iOS Safari zooms the page on focus and
 *     leaves the visitor pinched sideways
 *   - primary CTAs are big enough to hit with a thumb (44px)
 *   - the full buy flow works end to end on a phone, through to Stripe
 *
 * Runs against the ISOLATED test stack (backend :3002, frontend :8081).
 */

import { test, expect, devices, Page } from "@playwright/test";
import { fillDeliveryAddress } from "./address-form";

const BASE = process.env.E2E_BASE ?? "http://localhost:8080";
const API = process.env.E2E_API ?? "http://localhost:3001";

const SHOPPER = { email: "e2e-shopper@test.local", password: "E2eShopper123" };

// iPhone 13 viewport + touch. Keep the project's Chrome channel (the device
// preset's own userAgent is irrelevant here — layout and touch are what matter).
test.use({
  viewport: devices["iPhone 13"].viewport,
  hasTouch: true,
  isMobile: true,
});

// The storefront has two bottom-anchored overlays that both appear on a timer:
// the cookie banner (CookieConsent, z-110) and the newsletter card
// (SubscribePopupCard). On a phone each spans `left-4 right-4` and lands
// squarely over the mobile menu's "Sign In / Sign Up" button — so whether a test
// could click that button was a race against an animation, and Playwright would
// retry the click into the banner for the full 60s timeout when it lost.
//
// Seed both dismissal keys before any navigation. It has to be BOTH: the
// newsletter card deliberately holds itself back until the cookie key exists
// (it polls for it), so dismissing the banner alone would only swap one
// bottom-anchored overlay for the other and move the flake rather than fix it.
// Seeding, rather than clicking Accept, means there is no window in which the
// overlay exists at all.
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    try {
      localStorage.setItem("og_cookie_consent", "accepted");     // CookieConsent
      localStorage.setItem("og_subscribe_popup_dismissed", "1"); // SubscribePopupCard
    } catch { /* storage blocked — the overlays are this test's problem again */ }
  });
});

/** Pages every visitor can reach without signing in. */
const PUBLIC_PAGES = [
  ["home", "/"],
  ["shop", "/shop"],
  ["deals", "/deals"],
  ["about", "/about"],
  ["candle care", "/candle-care"],
  ["faq", "/faq"],
  ["basket (guest)", "/basket"],
  ["track order", "/track-order"],
  ["gift cards", "/gift-cards"],
  ["customer service", "/customer-service"],
  ["shipping policy", "/shipping-policy"],
  ["returns policy", "/returns"],
  ["privacy policy", "/privacy-policy"],
  ["terms", "/terms-of-service"],
] as const;

/** Sign in via the API, then reload so the app picks the session up. */
async function signIn(page: Page) {
  await page.goto(BASE);
  const res = await page.request.post(`${API}/api/user/login`, { data: SHOPPER });
  expect(res.ok(), "shopper login must succeed").toBeTruthy();
  await page.reload();
}

/** Widest horizontal overflow on the page, in px (0 = clean). */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return Math.max(0, Math.max(doc.scrollWidth, document.body.scrollWidth) - doc.clientWidth);
  });
}

/** The elements sticking out past the viewport — for a useful failure message. */
async function overflowingElements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > limit + 1 || r.left < -1) {
        const cls = typeof el.className === "string" ? el.className.slice(0, 60) : "";
        out.push(`<${el.tagName.toLowerCase()} class="${cls}"> right=${Math.round(r.right)} limit=${limit}`);
      }
      if (out.length >= 5) break;
    }
    return out;
  });
}

async function isScrollLocked(page: Page): Promise<boolean> {
  return page.evaluate(() => getComputedStyle(document.body).overflow === "hidden");
}

/**
 * Open the auth modal the way a phone visitor actually can. "Account & Lists"
 * is desktop-only (`hidden sm:flex`), so on a phone the only routes in are the
 * hamburger's "Sign In / Sign Up" button and tapping the basket while signed out.
 */
async function openAuthModalViaMenu(page: Page) {
  await page.getByRole("button", { name: /open menu/i }).first().click();
  const entry = page.getByRole("button", { name: /sign in \/ sign up/i });
  await expect(entry, "the mobile menu must offer a way to sign in").toBeVisible({ timeout: 10_000 });
  await entry.click();
  await expect(page.getByPlaceholder("you@example.com")).toBeVisible({ timeout: 10_000 });
}

// ─── 1. No page scrolls sideways ─────────────────────────────────────────────

test.describe("Layout integrity on a phone", () => {
  for (const [name, path] of PUBLIC_PAGES) {
    test(`${name} does not scroll horizontally`, async ({ page }) => {
      await page.goto(`${BASE}${path}`);
      await page.waitForLoadState("networkidle").catch(() => {});
      // Let late content (fonts, images, carousels) settle before measuring.
      await page.waitForTimeout(400);
      const overflow = await horizontalOverflow(page);
      const culprits = overflow > 0 ? await overflowingElements(page) : [];
      expect(overflow, `${path} overflows by ${overflow}px. Widest offenders:\n${culprits.join("\n")}`)
        .toBeLessThanOrEqual(1);
    });
  }

  test("the product detail page fits the viewport", async ({ page }) => {
    await page.goto(`${BASE}/shop`);
    const card = page.locator("a[href^='/products/']").first();
    if (!(await card.isVisible().catch(() => false))) {
      test.skip(true, "no product detail links rendered in this catalogue");
    }
    await card.click();
    await expect(page).toHaveURL(/\/products\//, { timeout: 10_000 });
    await page.waitForTimeout(400);
    const overflow = await horizontalOverflow(page);
    const culprits = overflow > 0 ? await overflowingElements(page) : [];
    expect(overflow, `product page overflows by ${overflow}px:\n${culprits.join("\n")}`)
      .toBeLessThanOrEqual(1);
  });
});

// ─── 2. The mobile navigation ────────────────────────────────────────────────

test.describe("Mobile navigation", () => {
  test("hamburger opens the menu, locks the page, and navigates", async ({ page }) => {
    await page.goto(BASE);

    const toggle = page.getByRole("button", { name: /open menu/i }).first();
    await expect(toggle, "a mobile menu toggle must be visible at phone width")
      .toBeVisible({ timeout: 10_000 });

    expect(await isScrollLocked(page), "page starts scrollable").toBe(false);
    await toggle.click();

    // The panel is open and the storefront behind it is frozen.
    await expect(async () => {
      expect(await isScrollLocked(page)).toBe(true);
    }).toPass({ timeout: 5_000 });

    const shopLink = page.getByRole("link", { name: /^shop$/i }).first();
    await expect(shopLink).toBeVisible({ timeout: 5_000 });
    await shopLink.click();

    await expect(page).toHaveURL(/\/shop/, { timeout: 10_000 });
    // Navigating must release the lock — otherwise the new page can't be scrolled.
    await expect(async () => {
      expect(await isScrollLocked(page), "menu must unlock the page after navigating").toBe(false);
    }).toPass({ timeout: 5_000 });
  });

  test("--nav-h measures the header only, so an open menu doesn't shove content down", async ({ page }) => {
    await page.goto(BASE);
    const navH = () =>
      page.evaluate(() =>
        parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--nav-h") || "0"));

    const closed = await navH();
    expect(closed, "--nav-h must be published for pages to pad against").toBeGreaterThan(0);

    await page.getByRole("button", { name: /open menu/i }).first().click();
    await page.waitForTimeout(500); // let the panel finish animating open
    const open = await navH();

    expect(Math.abs(open - closed), `--nav-h changed from ${closed} to ${open} when the menu opened`)
      .toBeLessThanOrEqual(2);
  });

  test("the menu can be closed again without navigating", async ({ page }) => {
    await page.goto(BASE);
    const toggle = page.getByRole("button", { name: /open menu/i }).first();
    await toggle.click();
    await expect(async () => { expect(await isScrollLocked(page)).toBe(true); }).toPass({ timeout: 5_000 });

    // Same control toggles closed (it flips to a close/X affordance).
    const closeBtn = page.getByRole("button", { name: /close|menu|navigation/i }).first();
    await closeBtn.click();
    await expect(async () => {
      expect(await isScrollLocked(page), "closing the menu must unfreeze the page").toBe(false);
    }).toPass({ timeout: 5_000 });
  });
});

// ─── 3. iOS focus-zoom guard ─────────────────────────────────────────────────

test.describe("Form fields on iOS", () => {
  test("every visible field renders at 16px or larger", async ({ page }) => {
    // The checkout form is the densest set of inputs on the site.
    await signIn(page);
    await page.goto(`${BASE}/checkout`);
    await page.waitForTimeout(500);

    const undersized = await page.evaluate(() => {
      const bad: string[] = [];
      const fields = document.querySelectorAll<HTMLElement>(
        'input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), select, textarea'
      );
      for (const f of Array.from(fields)) {
        const r = f.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const size = parseFloat(getComputedStyle(f).fontSize);
        if (size < 16) {
          bad.push(`${f.tagName.toLowerCase()}[${(f as HTMLInputElement).name || (f as HTMLInputElement).placeholder || "?"}] = ${size}px`);
        }
      }
      return bad;
    });

    expect(undersized, `these fields will make iOS Safari zoom on focus:\n${undersized.join("\n")}`)
      .toEqual([]);
  });

  test("the auth modal's fields are also zoom-safe", async ({ page }) => {
    await page.goto(BASE);
    await openAuthModalViaMenu(page);

    const size = await page.getByPlaceholder("you@example.com")
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size, "sign-in email field would trigger iOS zoom").toBeGreaterThanOrEqual(16);
  });
});

// ─── 4. Thumb-sized tap targets ──────────────────────────────────────────────

test.describe("Tap targets", () => {
  test("primary storefront CTAs are at least 44px tall", async ({ page }) => {
    await signIn(page);
    await page.goto(`${BASE}/shop`);
    await page.waitForTimeout(500);

    const cta = page.getByRole("button", { name: /add to cart|buy now/i }).first();
    await expect(cta).toBeVisible({ timeout: 10_000 });
    const box = await cta.boundingBox();
    expect(box, "the add-to-cart CTA must be laid out").toBeTruthy();
    expect(Math.round(box!.height), "add-to-cart is too small to hit with a thumb")
      .toBeGreaterThanOrEqual(44);
  });

  test("every control on the basket and checkout pages is thumb-sized", async ({ page }) => {
    // The two pages between a shopper and their money. A mis-tap here is a lost
    // order, so nothing interactive on them should fall under the 44px floor.
    await signIn(page);
    await page.request.delete(`${API}/api/cart`);
    await page.goto(`${BASE}/shop`);
    await page.getByRole("button", { name: /add to cart/i }).first().click();

    // Collect across BOTH pages before asserting, so one run reports everything
    // rather than hiding the checkout offenders behind the basket ones.
    const findings: string[] = [];

    for (const path of ["/basket", "/checkout"]) {
      await page.goto(`${BASE}${path}`);
      await page.waitForTimeout(800);

      const undersized = await page.evaluate(() => {
        const bad: string[] = [];
        const controls = document.querySelectorAll<HTMLElement>(
          'button, a[href], select, input[type="submit"], [role="button"]'
        );
        for (const el of Array.from(controls)) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;           // not rendered
          if (getComputedStyle(el).visibility === "hidden") continue;
          // Inline text links inside a paragraph are read, not tapped as targets.
          if (el.tagName === "A" && el.closest("p")) continue;
          // A product thumbnail is an image-only link sitting right beside the
          // product-title link to the same place. WCAG 2.5.8 exempts a target
          // that has an equivalent adjacent one, and padding the thumbnail out to
          // 44px would just distort the basket rows.
          if (el.tagName === "A" && !(el.textContent || "").trim() && el.querySelector("img")) continue;
          if (r.height < 44 || r.width < 24) {
            // Identify by text, then aria-label, then tag+class — an unlabelled
            // control is exactly the one that's hardest to find again by hand.
            const label = (el.textContent || "").trim()
              || el.getAttribute("aria-label")
              || el.getAttribute("title")
              || `<${el.tagName.toLowerCase()} class="${
                   (typeof el.className === "string" ? el.className : "").slice(0, 50)}">`;
            bad.push(`${label.slice(0, 60)} ${Math.round(r.width)}×${Math.round(r.height)}`);
          }
        }
        return bad;
      });

      findings.push(...undersized.map((u) => `${path}  ${u}`));
    }

    await page.request.delete(`${API}/api/cart`);

    expect(findings, `controls under the 44px touch floor:\n${findings.join("\n")}`).toEqual([]);
  });

  test("basket quantity steppers are thumb-sized", async ({ page }) => {
    await signIn(page);
    await page.request.delete(`${API}/api/cart`);
    await page.goto(`${BASE}/shop`);
    await page.getByRole("button", { name: /add to cart/i }).first().click();
    await page.goto(`${BASE}/basket`);

    const plus = page.getByRole("button", { name: "+" }).first();
    await expect(plus).toBeVisible({ timeout: 10_000 });
    const box = await plus.boundingBox();
    expect(box).toBeTruthy();
    // Steppers sit side by side, so both dimensions matter.
    expect(Math.min(box!.width, box!.height), "quantity stepper is too small for touch")
      .toBeGreaterThanOrEqual(44);

    await page.request.delete(`${API}/api/cart`);
  });
});

// ─── 5. Overlays freeze the page behind them ─────────────────────────────────

test.describe("Overlay scroll locking", () => {
  test("the auth modal freezes the storefront behind it", async ({ page }) => {
    await page.goto(BASE);
    expect(await isScrollLocked(page)).toBe(false);

    await openAuthModalViaMenu(page);

    // The menu closes as the modal opens; the counted lock must hand over
    // between them without ever leaving the page scrollable underneath.
    await expect(async () => {
      expect(await isScrollLocked(page), "auth modal must lock the page").toBe(true);
    }).toPass({ timeout: 5_000 });
  });

  test("signing in through the modal on a phone works and releases the lock", async ({ page }) => {
    await page.goto(BASE);
    await openAuthModalViaMenu(page);

    await page.getByPlaceholder("you@example.com").fill(SHOPPER.email);
    await page.getByPlaceholder("Your password").fill(SHOPPER.password);
    await page.getByRole("button", { name: /^sign in$/i }).click();

    await expect(page.getByPlaceholder("Your password")).toBeHidden({ timeout: 15_000 });
    await expect(async () => {
      expect(await isScrollLocked(page), "closing the modal must unfreeze the page").toBe(false);
    }).toPass({ timeout: 5_000 });

    const me = await page.request.get(`${API}/api/user/me`);
    expect(me.ok(), "the phone sign-in must produce a real session").toBeTruthy();
  });
});

// ─── 6. The whole purchase journey, on a phone ───────────────────────────────

test.describe("Mobile purchase journey", () => {
  test("browse → add to cart → basket → checkout → Stripe", async ({ page }) => {
    test.setTimeout(120_000);

    await signIn(page);
    await page.request.delete(`${API}/api/cart`);

    // Shop on a phone.
    await page.goto(`${BASE}/shop`);
    const addBtn = page.getByRole("button", { name: /add to cart/i }).first();
    await expect(addBtn).toBeVisible({ timeout: 15_000 });
    await addBtn.click();

    // The basket reflects it.
    await expect(async () => {
      const cart = await (await page.request.get(`${API}/api/cart`)).json();
      expect(cart.length).toBeGreaterThan(0);
    }).toPass({ timeout: 10_000 });

    await page.goto(`${BASE}/basket`);
    const checkoutCta = page.getByRole("button", { name: /proceed to checkout/i });
    await expect(checkoutCta).toBeVisible({ timeout: 15_000 });
    // The CTA must be reachable, not clipped off the side of a phone screen.
    const ctaBox = await checkoutCta.boundingBox();
    expect(ctaBox!.x).toBeGreaterThanOrEqual(0);
    expect(ctaBox!.x + ctaBox!.width).toBeLessThanOrEqual(devices["iPhone 13"].viewport.width + 1);
    await checkoutCta.click();

    await expect(page).toHaveURL(/\/checkout/, { timeout: 15_000 });

    // Fill the delivery address on a phone-width form.
    // Every field is labelled, so address them by label rather than placeholder.
    // Country first: it drives the county dropdown and the Eircode rules below it.
    await fillDeliveryAddress(page, "E2E Mobile Shopper");

    // No sideways scroll once the form is populated either.
    expect(await horizontalOverflow(page), "checkout overflows horizontally when filled")
      .toBeLessThanOrEqual(1);

    const pay = page.getByRole("button", { name: /continue to secure payment|pay|place order/i }).first();
    await expect(pay).toBeVisible({ timeout: 10_000 });
    await pay.click();

    // Reaching Stripe is the milestone our code owns; the hosted card widget
    // itself is Stripe's UI and is covered (best-effort) in customer-journey.
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 });
    expect(page.url()).toContain("checkout.stripe.com");

    await page.request.delete(`${API}/api/cart`);
  });

  test("the phone basket icon shows the count and opens the basket", async ({ page }) => {
    // The desktop basket button is `hidden sm:flex`, so this icon is the ONLY
    // way to the basket on a phone — if it regresses, mobile shoppers are stuck.
    await signIn(page);
    await page.request.delete(`${API}/api/cart`);
    await page.goto(`${BASE}/shop`);
    await page.getByRole("button", { name: /add to cart/i }).first().click();

    // The badge reflects the basket without a reload.
    const cartBtn = page.getByRole("button", { name: /^basket(,|$)/i }).first();
    await expect(cartBtn).toBeVisible({ timeout: 10_000 });
    await expect(cartBtn, "the icon must show how many items are in the basket")
      .toHaveAccessibleName(/basket,\s*\d+\s*item/i, { timeout: 10_000 });

    const box = await cartBtn.boundingBox();
    expect(Math.min(box!.width, box!.height), "the basket icon must be thumb-sized")
      .toBeGreaterThanOrEqual(44);

    await cartBtn.click();
    await expect(page).toHaveURL(/\/basket/, { timeout: 10_000 });

    await page.request.delete(`${API}/api/cart`);
  });

  test("a signed-out phone visitor tapping the basket reaches the basket", async ({ page }) => {
    await page.goto(BASE);
    const cartBtn = page.getByRole("button", { name: /^basket(,|$)/i }).first();
    await expect(cartBtn).toBeVisible({ timeout: 10_000 });
    await cartBtn.click();

    // The basket itself, not a sign-in wall: shopping doesn't require an account,
    // only checking out does.
    await expect(page).toHaveURL(/\/basket/, { timeout: 10_000 });
    await expect(page.getByRole("heading", { name: /your olive goose basket/i }))
      .toBeVisible({ timeout: 10_000 });
  });
});

// ─── 7. Signed-in account pages ──────────────────────────────────────────────

test.describe("Account pages on a phone", () => {
  for (const [name, path] of [
    ["account", "/account"],
    ["orders", "/orders"],
    ["addresses", "/account/addresses"],
    ["security", "/account/security"],
  ] as const) {
    test(`${name} renders without sideways scroll`, async ({ page }) => {
      await signIn(page);
      await page.goto(`${BASE}${path}`);
      await page.waitForTimeout(500);
      const overflow = await horizontalOverflow(page);
      const culprits = overflow > 0 ? await overflowingElements(page) : [];
      expect(overflow, `${path} overflows by ${overflow}px:\n${culprits.join("\n")}`)
        .toBeLessThanOrEqual(1);
    });
  }
});
