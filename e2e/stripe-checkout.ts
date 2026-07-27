import type { Page } from "@playwright/test";

/**
 * Drive Stripe's HOSTED checkout page with a test card.
 *
 * This automates Stripe's own UI, not ours, so it is inherently brittle and every
 * caller treats a `false` return as a reason to SKIP rather than fail — the part
 * our code owns (creating a correctly-priced Checkout Session and handing the
 * shopper over) has already been asserted by the time this is called.
 *
 * That contract only works if the return value is honest. An earlier version
 * returned `true` unconditionally after clicking Pay, which meant a page it had
 * failed to fill still reported success: the caller then waited 90s for a success
 * URL that could never arrive and the test died on its 180s timeout instead of
 * skipping. So this returns `true` only when a card number verifiably landed in
 * the form AND the submission actually left Stripe's page.
 *
 * Two hosted layouts exist and the difference matters:
 *   - single card form — the card fields are present immediately;
 *   - method accordion — every enabled payment method (Card / Revolut Pay /
 *     Klarna / MB WAY / wallets) is listed and the card fields do not exist until
 *     Card is selected. The control there is a RADIO, not a button; matching only
 *     a button named "Card" silently left the form collapsed. Enabling extra
 *     payment methods on the Stripe account is what switches layouts, so this is
 *     a configuration change away at any time.
 */
export async function payStripeTestCard(page: Page): Promise<boolean> {
  // ── 1. Make sure the card form is the one on screen ──
  const cardRadio = page.getByRole("radio", { name: /^card$/i }).first();
  if (await cardRadio.isVisible().catch(() => false)) {
    if (!(await cardRadio.isChecked().catch(() => false))) {
      await cardRadio.check({ timeout: 5_000 }).catch(() => {});
    }
  } else {
    // Older tabbed layout, where card selection really is a button.
    const cardTab = page.getByRole("button", { name: /pay with card|^card$/i }).first();
    if (await cardTab.isVisible().catch(() => false)) {
      await cardTab.click({ timeout: 5_000 }).catch(() => {});
    }
  }

  // ── 2. Fill the card, whichever shape the fields take ──
  const legacyNumber = page.locator("#cardNumber");
  let numberField = legacyNumber;

  if (await legacyNumber.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await legacyNumber.fill("4242424242424242");
    await page.locator("#cardExpiry").fill("12 / 34");
    await page.locator("#cardCvc").fill("123");
  } else {
    // Payment Element: each field lives inside a Stripe iframe.
    const fl = page.frameLocator(
      'iframe[title*="payment" i], iframe[name*="stripe" i], iframe[src*="stripe"]'
    );
    numberField = fl.locator('input[name="number"], input#Field-numberInput').first();
    if (!(await numberField.isVisible({ timeout: 15_000 }).catch(() => false))) return false;

    await numberField.fill("4242424242424242").catch(() => {});
    await fl.locator('input[name="expiry"], input#Field-expiryInput').first().fill("12 / 34").catch(() => {});
    await fl.locator('input[name="cvc"], input#Field-cvcInput').first().fill("123").catch(() => {});
  }

  // Optional billing details — present only on some configurations.
  const name = page.locator("#billingName");
  if (await name.isVisible().catch(() => false)) await name.fill("E2E Shopper");
  const postal = page.locator("#billingPostalCode");
  if (await postal.isVisible().catch(() => false)) await postal.fill("D01AB12");

  // ── 3. Confirm the card really landed before claiming we can pay ──
  // Read it back: a fill() into a cross-origin iframe can be silently dropped, and
  // submitting an empty form is what produced the endless "Processing" spinner.
  const entered = (await numberField.inputValue().catch(() => "")).replace(/\s/g, "");
  if (!entered.includes("4242")) return false;

  // ── 4. Submit, and decide the outcome here rather than leaving the caller to
  //       burn its timeout guessing ──
  await page.locator(".SubmitButton, button[type=submit]").first().click().catch(() => {});

  // Success means Stripe redirected back to us. Anything else — an inline card
  // error, a 3DS challenge we won't automate, a stuck spinner — is a skip.
  return await page
    .waitForURL(url => !/checkout\.stripe\.com/.test(url.href), { timeout: 60_000 })
    .then(() => true)
    .catch(() => false);
}
