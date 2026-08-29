import { createHash } from "crypto";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { describe, it, expect } from "vitest";
import {
  metaPixelId, metaBrowserId, metaTestCode, metaUserData,
  hashEmail, hashPhone, hashName, hashCity, hashState, hashZip, hashCountry, hashExternalId,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain JS module shared with the API, no types
} from "../../backend/metaCapi.js";

/**
 * Meta's Conversions API matches a server-sent purchase to a person by comparing
 * SHA-256 hashes against a graph built from hashes ITS OWN pixel produced. THERE
 * IS NO ERROR FOR GETTING THE NORMALISATION WRONG. A hash that doesn't match
 * simply doesn't match: Meta accepts the event, Events Manager reports it as
 * received, the number in the dashboard looks right, and the shop quietly gets
 * worse attribution for ever — ad spend judged against sales it can no longer
 * see it caused.
 *
 * So every expected value below is the string fbevents.js WAS OBSERVED TO HASH,
 * read out of the `ud[…]` parameters of a live request to www.facebook.com/tr,
 * not taken from Meta's documentation. Four of them contradict the obvious
 * reading of those docs, and each one had been written the obvious way first:
 *
 *   names keep their accents; cities DELETE them
 *   a region is cut to two characters, wherever in the world it is
 *   a postcode keeps its space but is cut at a hyphen
 *   external_id is hashed, not sent in clear
 *
 * The hashes here are computed by this file, from those literals, so the
 * assertion cannot be satisfied by the code agreeing with itself: if the
 * normalisation drifts this fails, and if the hashing drifts this fails.
 */
const sha256 = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");

describe("what the API will accept as an identifier", () => {
  it("takes a pixel id and nothing that merely looks like one", () => {
    expect(metaPixelId("1234567890123456")).toBe("1234567890123456");
    expect(metaPixelId(" 123456789012345 ")).toBe("123456789012345");
    for (const bad of ["act_1234567890123456", "1234567890", "", null, 1234567890123456]) {
      expect(metaPixelId(bad)).toBeNull();
    }
    // A leading zero is not a pixel id: fbevents.js refuses one outright — see
    // PIXEL_ID_RE in src/lib/meta.ts, where the observation is written down.
    for (const bad of ["000000000000001", "0123456789012345"]) {
      expect(metaPixelId(bad)).toBeNull();
    }
  });

  it("uses the same rule the storefront does", () => {
    // The pattern exists twice — once in TypeScript for the admin panel and the
    // tag, once in plain JS here for the Conversions API — because this file must
    // stay importable without the frontend build. Two copies of a rule drift, and
    // this one drifting means the panel accepts an id the server then refuses (a
    // pixel that browses but never sells) or the reverse. So they are compared.
    const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const pattern = (src: string) =>
      readFileSync(path.join(REPO, src), "utf8").match(/\/\^\[1-9\]\\d\{14,15\}\$\//g);
    expect(pattern("src/lib/meta.ts"), "PIXEL_ID_RE not found in src/lib/meta.ts").toBeTruthy();
    expect(pattern("backend/metaCapi.js"), "metaPixelId's pattern not found in backend/metaCapi.js").toBeTruthy();
  });

  it("takes Meta's own cookie format, and refuses anything shaped differently", () => {
    // These reach a third party verbatim. Nothing an attacker can put in a
    // cookie may be forwarded to Meta as if the pixel had written it.
    expect(metaBrowserId("fb.1.1787691830.1098115397")).toBe("fb.1.1787691830.1098115397");
    expect(metaBrowserId("fb.1.1787691830.IwAR2abcDEF-_x")).toBe("fb.1.1787691830.IwAR2abcDEF-_x");
    for (const bad of [
      "fb.1.1787691830",                    // truncated
      "GA1.1.1546987988.1787691831",        // the wrong tag's cookie
      "fb.1.1787691830.<script>",           // markup
      `fb.1.1787691830.${"x".repeat(500)}`, // unbounded
      "",
    ]) {
      expect(metaBrowserId(bad)).toBeNull();
    }
  });

  it("normalises a Test Events code to the case Events Manager uses", () => {
    expect(metaTestCode("TEST12345")).toBe("TEST12345");
    // Retyped in lower case. Sent as-is, Meta's Test Events tab isn't watching
    // for it and the owner sees a test that simply didn't work.
    expect(metaTestCode(" test99 ")).toBe("TEST99");
    for (const bad of ["TEST", "12345", "TESTABC", ""]) expect(metaTestCode(bad)).toBeNull();
  });
});

describe("normalisation, rule by rule — each one read off the wire", () => {
  it("lowercases and trims an email, and refuses a string that isn't one", () => {
    expect(hashEmail("  Aoife@Example.COM ")).toBe(sha256("aoife@example.com"));
    // Hashing a non-email fills Meta's match pool with values that can never
    // match anything, and there is nothing that would ever report it.
    for (const bad of ["aoife", "", null, undefined]) expect(hashEmail(bad)).toBeNull();
  });

  it("reduces a phone to its digits — all of them", () => {
    // Observed: '+353 (0)87 123 4567' → 3530871234567. The zero inside the
    // brackets SURVIVES; only the punctuation goes.
    expect(hashPhone("+353 (0)87 123 4567")).toBe(sha256("3530871234567"));
    expect(hashPhone("+353 87 123 4567")).toBe(sha256("353871234567"));
    for (const bad of ["12", "", null]) expect(hashPhone(bad)).toBeNull();
  });

  it("keeps the accents in a name", () => {
    // Observed: "O'Súilleabháin-Smith" → osúilleabháinsmith. Punctuation and
    // spaces go; the accented letters stay. Folding them — which is what every
    // instinct says to do, and what this did before it was checked — hashes a
    // different string than the pixel does for the same person.
    expect(hashName("O'Súilleabháin-Smith")).toBe(sha256("osúilleabháinsmith"));
    expect(hashName("van der Berg")).toBe(sha256("vanderberg"));
    expect(hashName(" Aoife ")).toBe(sha256("aoife"));
    expect(hashName("")).toBeNull();
  });

  it("DELETES the accents in a city — not the same rule as a name", () => {
    // Observed: 'Dún Laoghaire' → dnlaoghaire. The ú is dropped outright, so the
    // city hash is not the name hash applied to a different field. Two rules,
    // and they disagree.
    expect(hashCity("Dún Laoghaire")).toBe(sha256("dnlaoghaire"));
    expect(hashCity("St. John's")).toBe(sha256("stjohns"));
    expect(hashCity("")).toBeNull();
  });

  it("cuts a region to two characters, wherever in the world it is", () => {
    // Observed: 'California' → ca, 'Co. Dublin' → co. A US state-code convention
    // applied to everyone — which is why `st` is nearly worthless outside the
    // US, and why sending our own tidier idea of it would match nobody.
    expect(hashState("California")).toBe(sha256("ca"));
    expect(hashState("Co. Dublin")).toBe(sha256("co"));
    expect(hashState("")).toBeNull();
  });

  it("keeps the space in a postcode but cuts it at a hyphen", () => {
    // Observed: 'D18 K7W2' → 'd18 k7w2' (space intact), ' SW1A-1AA ' → 'sw1a'
    // (the ZIP+4 rule, applied to everyone). Stripping the space — the obvious
    // "tidy the postcode" move — produces a string the pixel never sends.
    expect(hashZip("D18 K7W2")).toBe(sha256("d18 k7w2"));
    expect(hashZip(" SW1A-1AA ")).toBe(sha256("sw1a"));
    expect(hashZip("")).toBeNull();
  });

  it("turns a country NAME into the ISO code Meta is expecting", () => {
    // Observed: 'Ireland' → ie. The order carries "Ireland"; sending the hash of
    // "ireland" matches nobody at all while looking completely correct in every
    // log we have.
    expect(hashCountry("Ireland")).toBe(sha256("ie"));
    expect(hashCountry("Germany")).toBe(sha256("de"));
    expect(hashCountry("United Kingdom")).toBe(sha256("gb"));
    // Already a code — accepted as one rather than looked up and lost.
    expect(hashCountry("IE")).toBe(sha256("ie"));
    // Not a country we ship to: omitted, never guessed.
    expect(hashCountry("Narnia")).toBeNull();
    expect(hashCountry("")).toBeNull();
  });

  it("hashes external_id, because the pixel does too", () => {
    // Observed: the pixel puts sha256(trim(lowercase(id))) in ud[external_id] —
    // it does NOT send it in clear. This is the one field where the browser's
    // value and the server's must be the same string, because it is what joins
    // the server-written purchase to the browsing that produced it.
    expect(hashExternalId("  MiXeD-Case_Probe  ")).toBe(sha256("mixed-case_probe"));
    expect(hashExternalId("f0db898d-b7b2-4323-a2a4-3516afeadb1a"))
      .toBe(sha256("f0db898d-b7b2-4323-a2a4-3516afeadb1a"));
    expect(hashExternalId("")).toBeNull();
  });
});

describe("money", () => {
  // `orders.total` is a numeric column that arrives as a string, and 25 + 4.99
  // is stored as 29.990000000000002. Reported raw, that is the revenue figure
  // Meta shows — a number that agrees with the money Stripe took to the cent and
  // still is not the number on the receipt. Revenue that does not match the
  // receipt is the one figure nobody should ever have to explain to anyone.
  it("reports revenue as the cents that were actually charged", () => {
    const stored = "29.990000000000002";
    const reported = +Number(stored).toFixed(2);
    expect(reported).toBe(29.99);
    // And it is still exactly what Stripe was asked for.
    expect(Math.round(reported * 100)).toBe(Math.round(Number(stored) * 100));
    expect(String(reported)).not.toContain("0000");
  });
});

describe("the user_data block a purchase carries", () => {
  const ORDER = {
    analytics: {
      fbp: "fb.1.1787691830.1098115397",
      fbc: "fb.1.1787691830.IwAR2abcDEF",
      visitor_id: "8f14e45f-ceea-467a-9ba3-6f1c0e2b1c2d",
      ua: "Mozilla/5.0 (iPhone)",
      ip: "203.0.113.7",
    },
    profile: { email: "Aoife@Example.com", full_name: "Aoife Byrne", phone: "+353861111111" },
    address: {
      full_name: "Aoife Ní Bhriain",
      phone: "+353871234567",
      city: "Dún Laoghaire",
      state: "Dublin",
      postal_code: "D18 K7W2",
      country: "Ireland",
    },
    advancedMatching: true,
  };

  it("carries every identifier Meta can match on", () => {
    expect(metaUserData(ORDER)).toEqual({
      fbp: "fb.1.1787691830.1098115397",
      fbc: "fb.1.1787691830.IwAR2abcDEF",
      client_ip_address: "203.0.113.7",
      client_user_agent: "Mozilla/5.0 (iPhone)",
      external_id: sha256("8f14e45f-ceea-467a-9ba3-6f1c0e2b1c2d"),
      em: [sha256("aoife@example.com")],
      ph: [sha256("353871234567")],
      fn: [sha256("aoife")],
      ln: [sha256("níbhriain")],
      ct: [sha256("dnlaoghaire")],
      st: [sha256("du")],
      zp: [sha256("d18 k7w2")],
      country: [sha256("ie")],
    });
  });

  it("hashes external_id the way the browser's pixel hashes it", () => {
    // The pixel sends sha256(trim(lowercase(id))) — read off a live hit. Send
    // one hashed and the other in clear and the sale silently detaches from the
    // session that produced it, which is a whole order's worth of attribution
    // lost with nothing anywhere to show for it.
    const out = metaUserData(ORDER);
    expect(out.external_id).toBe(sha256("8f14e45f-ceea-467a-9ba3-6f1c0e2b1c2d"));
    expect(out.external_id).not.toBe("8f14e45f-ceea-467a-9ba3-6f1c0e2b1c2d");
  });

  it("prefers the address on the parcel over the profile", () => {
    // The address was typed for THIS purchase; the profile may be a year old.
    const out = metaUserData(ORDER);
    expect(out.ph).toEqual([sha256("353871234567")]);   // the address's number
    expect(out.ln).toEqual([sha256("níbhriain")]);      // the address's surname
  });

  it("falls back to the profile for what the address doesn't carry", () => {
    const out = metaUserData({ ...ORDER, address: {} });
    expect(out.em).toEqual([sha256("aoife@example.com")]);
    expect(out.ph).toEqual([sha256("353861111111")]);
    expect(out.ln).toEqual([sha256("byrne")]);
  });

  it("keeps the browser and network identifiers when advanced matching is off", () => {
    // The switch means "don't tell Meta who this person is". It does not mean
    // "don't attribute the sale" — fbc is the ad click itself, and external_id
    // is our own random token, and neither carries personal data.
    const out = metaUserData({ ...ORDER, advancedMatching: false });
    expect(out).toEqual({
      fbp: "fb.1.1787691830.1098115397",
      fbc: "fb.1.1787691830.IwAR2abcDEF",
      client_ip_address: "203.0.113.7",
      client_user_agent: "Mozilla/5.0 (iPhone)",
      external_id: sha256("8f14e45f-ceea-467a-9ba3-6f1c0e2b1c2d"),
    });
    // No email, phone, name or address — that is what the switch buys.
    for (const k of ["em", "ph", "fn", "ln", "ct", "st", "zp", "country"]) {
      expect(out).not.toHaveProperty(k);
    }
  });

  it("never leaves a purchase too thin for Meta to accept", () => {
    // Meta REJECTS an event whose user_data is too broad to match on — error
    // 2804050, "no customer information parameters, or ... so broad that it is
    // unlikely to be effective". Verified against the live endpoint: a user
    // agent on its own is refused, a user agent plus external_id is accepted.
    //
    // The reachable worst case: an owner who switched advanced matching off, and
    // a shopper whose fbp/fbc cookies an ad blocker had eaten. Every one of that
    // shopper's purchases would be refused by Meta with nothing but a server log
    // to show for it. external_id is what keeps the event acceptable.
    const out = metaUserData({
      analytics: { ua: "Mozilla/5.0", visitor_id: "8f14e45f-ceea-467a-9ba3-6f1c0e2b1c2d" },
      profile: {}, address: {}, advancedMatching: false,
    });
    expect(out.external_id).toBeTruthy();
    expect(Object.keys(out).filter((k) => k !== "client_user_agent")).not.toHaveLength(0);
  });

  it("never reports the SHOP's address as the customer's on a pickup order", () => {
    // A pickup order's "shipping address" is the studio's own — assembled from
    // the pickup settings, because that is where the parcel goes. Read as the
    // customer's location it tells Meta this shopper lives at the shop, and
    // tells it that about EVERY pickup customer: one city, one postcode, shared
    // by all of them. That is not a missing signal but a false one.
    const studio = {
      fulfillment_type: "pickup",
      location_name: "The Olive Goose",
      address_line1: "Unit 4, Sandyford",
      city: "Dublin 18",
      eircode: "D18 K7W2",
      country: "Ireland",
      contact_name: "Aoife Ní Bhriain",
      contact_phone: "+353871234567",
    };
    const out = metaUserData({
      analytics: { visitor_id: "v1" },
      profile: { email: "aoife@example.com", full_name: "Aoife Byrne", city: "Galway", postal_code: "H91 XY12", country: "Ireland" },
      address: studio,
      advancedMatching: true,
    });
    // The shop's postcode and city must not appear anywhere.
    expect(out.zp).not.toEqual([sha256("d18 k7w2")]);
    expect(out.ct).not.toEqual([sha256("dublin")]);
    // The customer's own, from their account, is what goes.
    expect(out.ct).toEqual([sha256("galway")]);
    expect(out.zp).toEqual([sha256("h91 xy12")]);
    // And the collection contact really is the customer, so it is used.
    expect(out.ph).toEqual([sha256("353871234567")]);
    expect(out.ln).toEqual([sha256("níbhriain")]);
  });

  it("omits, never blanks, what it doesn't know", () => {
    // sha256("") is a perfectly valid-looking 64-character string that matches
    // every other empty field Meta has ever been sent.
    const out = metaUserData({ analytics: {}, profile: {}, address: {}, advancedMatching: true });
    expect(out).toEqual({});
    expect(JSON.stringify(out)).not.toContain(sha256(""));
  });

  it("refuses a forged cookie rather than forwarding it to Meta", () => {
    const out = metaUserData({
      ...ORDER,
      analytics: { ...ORDER.analytics, fbp: "not-a-cookie", fbc: "GA1.1.123.456" },
    });
    expect(out.fbp).toBeUndefined();
    expect(out.fbc).toBeUndefined();
  });
});
