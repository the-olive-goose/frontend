import { describe, it, expect } from "vitest";
import * as backend from "../../backend/addressRules.js";
import {
  validateDeliveryAddress, normalizeAddress, phoneError, ADDRESS_FIELDS,
  nameError, ACCOUNT_NAME_COPY, RECIPIENT_NAME_COPY,
} from "./addressValidation";

// The address rules exist twice — once in TypeScript for the storefront, once in
// plain JS for the API (backend/addressRules.js), because the backend deploys on
// its own and can't import the app's TS. Duplication like this drifts silently:
// the frontend tightens a rule, the API keeps accepting the old junk, and the
// gap only shows up as an undeliverable parcel. These cases pin the two together.

// Enough shapes to exercise every rule that differs by country or by field.
const CASES: Record<string, unknown>[] = [
  { full_name: "Aoife Byrne", phone: "+353871234567", address_line1: "12 Beacon Court", city: "Sandyford", state: "Dublin", postal_code: "D18 K7W2", country: "Ireland" },
  // The exact junk from the screenshot that started this: numeric street, one-letter town.
  { full_name: "akash bhardwaj", phone: "6666666666", address_line1: "4444", address_line2: "444", city: "d", state: "Dublin", postal_code: "D18 V5FD", country: "Ireland" },
  { full_name: "", phone: "", address_line1: "", city: "", state: "", postal_code: "", country: "" },
  { full_name: "Jan Novák", phone: "+420601123456", address_line1: "Karlova 12", city: "Praha", state: "", postal_code: "110 00", country: "Czechia" },
  { full_name: "Lena Fischer", phone: "+4915112345678", address_line1: "Torstraße 1", city: "Berlin", state: "", postal_code: "10115", country: "Germany" },
  // County missing in Ireland; region missing elsewhere is fine.
  { full_name: "Sean Kelly", phone: "+353851234567", address_line1: "3 Main Street", city: "Bandon", state: "", postal_code: "P72 XY45", country: "Ireland" },
  // Dublin Eircode filed under the wrong county.
  { full_name: "Sean Kelly", phone: "+353851234567", address_line1: "3 Main Street", city: "Cork", state: "Cork", postal_code: "D18 K7W2", country: "Ireland" },
  // Postal code in the wrong country's format.
  { full_name: "Marie Dupont", phone: "+33612345678", address_line1: "5 Rue de Rivoli", city: "Paris", state: "", postal_code: "D18 K7W2", country: "France" },
  { full_name: "Nobody", phone: "+353871234567", address_line1: "1 Elm Road", city: "Nowhere", state: "", postal_code: "12345", country: "Narnia" },
  // Untrimmed, lowercase, legacy bare phone — the normalization path.
  { full_name: "  Aoife   Byrne ", phone: "087 123 4567", address_line1: " 12 Beacon Court ", city: " Sandyford ", state: "Dublin", postal_code: "d18k7w2", country: " Ireland " },
];

const PHONES = [
  "+353871234567", "+3536666666666", "6666666666", "", "+3530871234567",
  "+447700900123", "+390612345678", "+36201234567", "not a phone",
];

// Real names, blank, too short, digits-only, one character mashed, untrimmed,
// and one that overflows a courier label.
const NAMES = [
  "Aoife Byrne", "Ní Bhraonáin", "", "   ", "a", "4444", "aaaa",
  "  Aoife   Byrne ", "Aoife Byrne ".repeat(6).trim(),
];

describe("backend/addressRules.js matches src/lib/addressValidation.ts", () => {
  it.each(CASES.map((c, i) => [i, c] as const))("case %i: same verdict", (_i, addr) => {
    const frontFirstError = firstError(addr);
    expect(backend.validateAddress(addr)).toBe(frontFirstError ?? null);
  });

  it.each(CASES.map((c, i) => [i, c] as const))("case %i: same stored shape", (_i, addr) => {
    const front = normalizeAddress(addr);
    const back = backend.normalizeAddress(addr);
    // The frontend keeps unknown keys off the input object; compare the eight
    // fields that are actually written to the row.
    for (const key of ["full_name", "phone", "address_line1", "address_line2", "city", "state", "postal_code", "country"] as const) {
      expect([key, back[key]]).toEqual([key, front[key] ?? ""]);
    }
  });

  it.each(PHONES)("phone %s: same verdict", phone => {
    expect(backend.phoneError(phone)).toBe(phoneError(phone) ?? undefined);
  });

  // The account name is validated on PUT /api/user/me with the backend copy and
  // in the account page with the frontend copy. If those two ever diverge, a name
  // the form accepts gets a 400 from the API (or worse, the reverse).
  it.each(NAMES)("name %s: same verdict, both copies", name => {
    expect(backend.nameError(name)).toBe(nameError(name, RECIPIENT_NAME_COPY));
    expect(backend.nameError(name, backend.ACCOUNT_NAME_COPY))
      .toBe(nameError(name, ACCOUNT_NAME_COPY));
  });

  it("uses the same words for the same problem", () => {
    expect(backend.ACCOUNT_NAME_COPY).toEqual({ ...ACCOUNT_NAME_COPY });
    expect(backend.RECIPIENT_NAME_COPY).toEqual({ ...RECIPIENT_NAME_COPY });
  });

  it("agrees on which Eircodes name a county", () => {
    for (const code of ["D18 K7W2", "d6w1234", "A96 X5F3", "T12 XY45", ""]) {
      expect(backend.countyFromEircode(code)).toBe(
        // The frontend returns undefined; so does the backend.
        code.replace(/\s+/g, "").toUpperCase().startsWith("D") && /^D(?:[0-9]{2}|6W)$/.test(code.replace(/\s+/g, "").toUpperCase().slice(0, 3))
          ? "Dublin" : undefined
      );
    }
  });

  it("renders the same address block for ops", () => {
    for (const addr of CASES) {
      expect(backend.formatAddressBlock(addr)).toEqual(
        // The backend normalizes inside the formatter; do the same on this side.
        formatBlockFront(addr)
      );
    }
  });
});

// The frontend returns a field→message map; the backend returns the first problem
// only. Walk the fields in render order to get the frontend's equivalent.
const firstError = (addr: Record<string, unknown>): string | undefined => {
  const errors = validateDeliveryAddress(addr);
  for (const f of ADDRESS_FIELDS) if (errors[f]) return errors[f];
  return undefined;
};

const formatBlockFront = (addr: Record<string, unknown>): string[] => {
  const a = normalizeAddress(addr);
  return [
    a.full_name, a.address_line1, a.address_line2, a.city,
    a.country?.trim().toLowerCase() === "ireland" && a.state ? `Co. ${a.state}` : a.state,
    a.postal_code, a.country,
  ].filter(Boolean) as string[];
};
