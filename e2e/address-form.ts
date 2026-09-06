import { expect, type Page } from "@playwright/test";

/**
 * Fill the shared delivery-address form (src/components/AddressFields.tsx) with a
 * valid Irish address.
 *
 * Addressed by label rather than placeholder: the placeholders are worked
 * examples ("e.g. 12 Beacon Court") that will keep being reworded, while the
 * labels are the field's actual name and are what a screen reader reads out too.
 *
 * Order matters. Country drives everything under it — it decides whether the
 * region is a county dropdown or free text, and which postal-code rules apply —
 * so it is selected before the city/county/Eircode row is touched.
 *
 * The phone box is a dial-code dropdown plus a national-number field over one
 * stored E.164 string, so only the national digits go in: typing the country code
 * as well is exactly the mistake the component now has to absorb.
 */
export async function fillDeliveryAddress(page: Page, fullName: string) {
  // A shopper who already has an address book sees the chosen address as a
  // read-only card, not a form — that's the whole point of the picker. Switch to
  // the new-address lane first so the fields exist, whatever state this fixture's
  // address book has accumulated from earlier suites.
  const useNew = page.getByRole("radio", { name: /use a new address/i });
  if (await useNew.count()) await useNew.check();

  // Exact labels throughout: the phone control's own "Phone country code" select
  // is a substring match for "Country" and would otherwise make it ambiguous.
  await page.getByLabel("Recipient's full name", { exact: true }).fill(fullName);
  await page.getByLabel("Mobile number", { exact: true }).fill("085 123 4567");
  await page.getByLabel("Address line 1", { exact: true }).fill("1 Test Street");
  await page.getByLabel("Country", { exact: true }).selectOption("Ireland");
  await page.getByLabel("City or town", { exact: true }).fill("Dublin");
  await page.getByLabel("County", { exact: true }).selectOption("Dublin");
  await page.getByLabel("Eircode", { exact: true }).fill("D18 K7W2");

  // The form is only submittable once every rule passes, so prove it got there
  // rather than letting a silent validation failure surface as a click timeout.
  await expect(page.getByText("Enter your street address.")).toHaveCount(0);
}

/**
 * Tick the "I have read and agree to the Terms of Service and Delivery &
 * Returns Policy" box that sits directly above the pay button.
 *
 * The box is unticked on every visit by design, and the pay button is disabled
 * until it is ticked — so every journey that reaches Stripe has to go through
 * here. The disabled/enabled assertions around the tick mean this helper also
 * proves the gate is still doing its job, in every suite that uses it.
 *
 * There are two copies of the checkbox — one in the desktop summary card, one in
 * the mobile sticky bar — and CSS shows exactly one at a time, so the visible
 * one is the one to click.
 */
export async function acceptCheckoutTerms(page: Page) {
  const pay = page.getByRole("button", { name: /continue to secure payment/i }).first();
  await expect(pay).toBeVisible({ timeout: 15_000 });
  await expect(pay, "the pay button must be disabled until the terms are accepted").toBeDisabled();

  const agree = page.getByRole("checkbox", { name: /terms of service/i }).first();
  await agree.check();

  await expect(pay, "ticking the terms box must enable the pay button").toBeEnabled();
}
