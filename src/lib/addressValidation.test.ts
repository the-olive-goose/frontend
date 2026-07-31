import { describe, it, expect } from "vitest";
import {
  splitPhone, composePhone, phoneError, formatPhoneDisplay, parseInternational,
  validateDeliveryAddress, normalizeAddress, countyFromEircode,
  formatAddressBlock, formatAddressOneLine, postalRuleFor,
  nameError, ACCOUNT_NAME_COPY, RECIPIENT_NAME_COPY,
} from "./addressValidation";

// A complete, dispatchable Irish address — the baseline every case below breaks
// exactly one field of, so a failure names the rule that actually regressed.
const GOOD = {
  full_name: "Aoife Byrne",
  phone: "+353871234567",
  address_line1: "12 Beacon Court",
  address_line2: "",
  city: "Sandyford",
  state: "Dublin",
  postal_code: "D18 K7W2",
  country: "Ireland",
};

describe("phone: split and compose", () => {
  it("round-trips an E.164 number", () => {
    const parts = splitPhone("+353871234567");
    expect(parts).toEqual({ dialCode: "+353", national: "871234567" });
    expect(composePhone(parts.dialCode, parts.national)).toBe("+353871234567");
  });

  it("reads a legacy bare number against the address country", () => {
    expect(splitPhone("087 123 4567", "Ireland")).toEqual({ dialCode: "+353", national: "871234567" });
    expect(splitPhone("07700 900123", "United Kingdom")).toEqual({ dialCode: "+44", national: "7700900123" });
  });

  it("defaults an unknown country to Ireland", () => {
    expect(splitPhone("871234567", undefined).dialCode).toBe("+353");
  });

  it("strips the domestic trunk prefix, including the multi-digit ones", () => {
    expect(composePhone("+353", "087 123 4567")).toBe("+353871234567");
    expect(composePhone("+36", "06 20 123 4567")).toBe("+36201234567"); // Hungary's 06
    expect(composePhone("+370", "861234567")).toBe("+37061234567");     // Lithuania's 8
  });

  it("keeps Italy's leading zero, which is part of the number", () => {
    expect(composePhone("+39", "06 1234 5678")).toBe("+390612345678");
  });

  it("stores nothing when there are no digits, so 'required' still fires", () => {
    expect(composePhone("+353", "")).toBe("");
    expect(composePhone("+353", "   ")).toBe("");
  });

  it("recognises a number pasted in international form", () => {
    expect(parseInternational("+353 85 123 4567")).toEqual({ dialCode: "+353", national: "851234567" });
    expect(parseInternational("00353 85 123 4567")).toEqual({ dialCode: "+353", national: "851234567" });
    expect(parseInternational("+44 7700 900123")).toEqual({ dialCode: "+44", national: "7700900123" });
  });

  it("ignores a half-typed code so the field can't jump mid-keystroke", () => {
    expect(parseInternational("+3")).toBeUndefined();
    expect(parseInternational("085 123 4567")).toBeUndefined();
    expect(parseInternational("")).toBeUndefined();
  });

  it("prefers the longest matching dial code", () => {
    expect(splitPhone("+3531234567").dialCode).toBe("+353");
    expect(splitPhone("+35796123456").dialCode).toBe("+357");
  });
});

describe("phone: validation", () => {
  it("accepts real numbers for their own country", () => {
    expect(phoneError("+353871234567")).toBeUndefined();  // IE mobile, 9
    expect(phoneError("+35316701234")).toBeUndefined();   // IE Dublin landline, 8
    expect(phoneError("+447700900123")).toBeUndefined();  // GB, 10
    expect(phoneError("+4915112345678")).toBeUndefined(); // DE, 11
  });

  it("rejects the ten-digit filler that used to pass the generic 7–15 check", () => {
    expect(phoneError("+3536666666666")).toBeTruthy();
    expect(phoneError("+3536666666666")).toMatch(/valid Ireland number/);
  });

  it("rejects a number with no country code at all", () => {
    expect(phoneError("6666666666")).toMatch(/country code/);
  });

  it("rejects an empty number", () => {
    expect(phoneError("")).toMatch(/courier/);
    expect(phoneError(undefined)).toMatch(/courier/);
  });

  it("rejects a trunk zero left inside the international number", () => {
    expect(phoneError("+3530871234567")).toMatch(/leading 0/);
  });

  it("names the country whose rules it applied", () => {
    expect(phoneError("+33123")).toMatch(/valid France number/);
  });

  it("groups a stored number the way its own country writes it", () => {
    expect(formatPhoneDisplay("+353871234567")).toBe("+353 87 123 4567");
    expect(formatPhoneDisplay("+33612345678")).toBe("+33 6 12 34 56 78");
    expect(formatPhoneDisplay("")).toBe("");
  });

  it("falls back to plain threes for a length the national grouping doesn't cover", () => {
    expect(formatPhoneDisplay("+35316701234")).toBe("+353 167 012 34");
  });
});

describe("address: the junk that used to reach dispatch", () => {
  it("accepts the good baseline", () => {
    expect(validateDeliveryAddress(GOOD)).toEqual({});
  });

  it("rejects a street line with no street in it", () => {
    expect(validateDeliveryAddress({ ...GOOD, address_line1: "4444" }).address_line1)
      .toMatch(/street name/);
  });

  it("rejects a one-letter city", () => {
    expect(validateDeliveryAddress({ ...GOOD, city: "d" }).city).toMatch(/full name/);
  });

  it("rejects a repeated-character value anywhere it expects a word", () => {
    expect(validateDeliveryAddress({ ...GOOD, full_name: "aaaa" }).full_name).toBeTruthy();
    expect(validateDeliveryAddress({ ...GOOD, city: "dddd" }).city).toBeTruthy();
    expect(validateDeliveryAddress({ ...GOOD, address_line2: "444" }).address_line2).toBeTruthy();
  });

  it("leaves an empty line 2 alone", () => {
    expect(validateDeliveryAddress({ ...GOOD, address_line2: "" }).address_line2).toBeUndefined();
    expect(validateDeliveryAddress({ ...GOOD, address_line2: "Apt 4" }).address_line2).toBeUndefined();
  });

  it("rejects an over-long value", () => {
    const tooLong = "Aoife Byrne ".repeat(6).trim(); // 71 chars, real words
    expect(validateDeliveryAddress({ ...GOOD, full_name: tooLong }).full_name).toMatch(/under 60/);
  });

  it("reports every broken field at once, not just the first", () => {
    const errors = validateDeliveryAddress({ country: "Ireland" });
    expect(Object.keys(errors).sort())
      .toEqual(["address_line1", "city", "full_name", "phone", "postal_code", "state"]);
  });
});

// The account holder's name and the parcel recipient's name are the same rule
// with different copy — the account page and PUT /api/user/me lean on this, so a
// name the address form rejects can't be smuggled in through the profile.
describe("names: account holder and parcel recipient", () => {
  it("accepts a real name", () => {
    expect(nameError("Aoife Byrne", ACCOUNT_NAME_COPY)).toBeUndefined();
    expect(nameError("Ní Bhraonáin")).toBeUndefined();
  });

  it("judges the tidied value, so padding is not length", () => {
    expect(nameError("   ", ACCOUNT_NAME_COPY)).toBe(ACCOUNT_NAME_COPY.missing);
    expect(nameError("  Aoife   Byrne ")).toBeUndefined();
  });

  it("rejects the same junk the address form rejects", () => {
    for (const junk of ["", " ", "a", "4444", "aaaa", "1234567"]) {
      expect([junk, !!nameError(junk, ACCOUNT_NAME_COPY)]).toEqual([junk, true]);
      expect([junk, !!nameError(junk)]).toEqual([junk, true]);
    }
  });

  it("caps the length at what a courier label holds", () => {
    const tooLong = "Aoife Byrne ".repeat(6).trim(); // 71 chars of real words
    expect(nameError(tooLong, ACCOUNT_NAME_COPY)).toMatch(/under 60/);
  });

  it("speaks to the account holder about their own name", () => {
    // Same verdict, different words: the parcel copy is wrong on /account.
    expect(nameError("", ACCOUNT_NAME_COPY)).not.toBe(nameError("", RECIPIENT_NAME_COPY));
    expect(nameError("", ACCOUNT_NAME_COPY)).toMatch(/your full name/i);
    expect(nameError("4444", RECIPIENT_NAME_COPY)).toMatch(/parcel/i);
  });

  it("is the rule the address form uses for the recipient", () => {
    for (const junk of ["", "a", "4444", "aaaa"]) {
      expect([junk, validateDeliveryAddress({ ...GOOD, full_name: junk }).full_name])
        .toEqual([junk, nameError(junk)]);
    }
  });
});

describe("address: country-driven rules", () => {
  it("requires a county in Ireland", () => {
    expect(validateDeliveryAddress({ ...GOOD, state: "" }).state).toMatch(/Select your county/);
  });

  it("rejects a county that isn't one of the 26", () => {
    expect(validateDeliveryAddress({ ...GOOD, state: "Yorkshire" }).state).toMatch(/from the list/);
  });

  it("leaves the region optional outside Ireland", () => {
    const de = { ...GOOD, country: "Germany", state: "", postal_code: "10115", city: "Berlin" };
    expect(validateDeliveryAddress(de)).toEqual({});
  });

  it("applies the country's own postal format", () => {
    expect(validateDeliveryAddress({ ...GOOD, postal_code: "10115" }).postal_code).toMatch(/Eircode/);
    const de = { ...GOOD, country: "Germany", state: "", city: "Berlin", postal_code: "D18 K7W2" };
    expect(validateDeliveryAddress(de).postal_code).toMatch(/PLZ/);
  });

  it("names the postal field the way that country does", () => {
    expect(postalRuleFor("Ireland").label).toBe("Eircode");
    expect(postalRuleFor("Germany").label).toBe("PLZ");
    expect(postalRuleFor("Narnia").label).toBe("Postal code");
  });

  it("rejects a country we don't ship to", () => {
    expect(validateDeliveryAddress({ ...GOOD, country: "Narnia" }).country).toMatch(/we ship to/);
  });
});

describe("Eircode ↔ county cross-check", () => {
  it("reads Dublin off a D routing key", () => {
    expect(countyFromEircode("D18 K7W2")).toBe("Dublin");
    expect(countyFromEircode("d6w1234")).toBe("Dublin");
  });

  it("stays silent on keys that don't unambiguously name a county", () => {
    // A96 is Dún Laoghaire — inside County Dublin — so the reverse implication
    // must never be asserted, or real Dublin addresses would be rejected.
    expect(countyFromEircode("A96 X5F3")).toBeUndefined();
    expect(countyFromEircode("T12 XY45")).toBeUndefined();
    expect(countyFromEircode("")).toBeUndefined();
  });

  it("catches a Dublin Eircode filed under the wrong county", () => {
    expect(validateDeliveryAddress({ ...GOOD, state: "Cork" }).postal_code)
      .toMatch(/in County Dublin, not Cork/);
  });

  it("does not object when the county is Dublin and the key isn't a D one", () => {
    // Dún Laoghaire: County Dublin, A96 routing key. Perfectly valid.
    expect(validateDeliveryAddress({ ...GOOD, postal_code: "A96 X5F3", city: "Dún Laoghaire" }))
      .toEqual({});
  });
});

describe("normalizeAddress", () => {
  it("produces one canonical shape from messy input", () => {
    expect(normalizeAddress({
      full_name: "  Aoife   Byrne ",
      phone: "087 123 4567",
      address_line1: " 12 Beacon Court  ",
      city: " Sandyford ",
      state: "Dublin",
      postal_code: "d18k7w2",
      country: " Ireland ",
    })).toMatchObject({
      full_name: "Aoife Byrne",
      phone: "+353871234567",
      address_line1: "12 Beacon Court",
      city: "Sandyford",
      postal_code: "D18 K7W2",
      country: "Ireland",
    });
  });

  it("is idempotent", () => {
    const once = normalizeAddress(GOOD);
    expect(normalizeAddress(once)).toEqual(once);
  });
});

describe("ops formatting", () => {
  it("lays the address out the way it goes on the parcel", () => {
    expect(formatAddressBlock(GOOD)).toEqual([
      "Aoife Byrne", "12 Beacon Court", "Sandyford", "Co. Dublin", "D18 K7W2", "Ireland",
    ]);
  });

  it("drops empty elements rather than leaving gaps", () => {
    expect(formatAddressBlock({ full_name: "Aoife Byrne", city: "Sandyford" }))
      .toEqual(["Aoife Byrne", "Sandyford"]);
  });

  it("collapses to one line without repeating the recipient", () => {
    expect(formatAddressOneLine(GOOD))
      .toBe("12 Beacon Court, Sandyford, Co. Dublin, D18 K7W2, Ireland");
  });
});
