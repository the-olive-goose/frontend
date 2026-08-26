// Meta Conversions API — the matching half, and the only part of it that can be
// wrong without anything saying so.
//
// Lives in its own file for the reason backend/addressRules.js does: it is pure
// (no database, no network, no Express), the rules in it are exacting, and
// getting one wrong fails SILENTLY. A hash that doesn't match simply doesn't
// match — Meta accepts the event, Events Manager says "received", and the shop
// quietly gets worse attribution for ever. So it is importable by the unit
// suite, and src/lib/metaCapi.test.ts holds every rule below to Meta's published
// normalisation with hashes computed independently of this code.
//
// backend/index.js owns everything that touches the world: the pixel settings,
// the access token, the HTTP call and the purchase payload.

import crypto from 'crypto';
import { countryByName } from './addressRules.js';

// A pixel id is a plain 15- or 16-digit number. The cookies are Meta's own
// `fb.<subdomainIndex>.<timestamp>.<payload>` format — neither passes
// ANALYTICS_ID_RE, so they get their own guards rather than a loosened shared one.
const metaPixelId = (v) => (typeof v === 'string' && /^\d{15,16}$/.test(v.trim()) ? v.trim() : null);
const metaBrowserId = (v) => (typeof v === 'string' && /^fb\.\d\.\d{1,20}\.[A-Za-z0-9_-]{1,400}$/.test(v) ? v : null);
// Uppercased on the way through. Events Manager always writes the code as
// `TEST12345`, and an owner who retypes it in lower case would otherwise have
// their purchases tagged with a code Meta's Test Events tab is not watching for
// — a test that appears to have simply not worked.
const metaTestCode = (v) => (typeof v === 'string' && /^TEST\d{1,12}$/i.test(v.trim()) ? v.trim().toUpperCase() : null);


// ── Advanced matching, hashed ─────────────────────────────────────────────────
//
// Meta matches a server event to a person by comparing SHA-256 hashes against a
// graph it built from hashes ITS OWN pixel produced. So the only correct
// normalisation is the one fbevents.js performs, character for character. There
// is no error for getting it wrong — a hash that doesn't match simply doesn't
// match, Meta accepts the event, Events Manager reports it received, and the
// shop quietly gets worse attribution for ever.
//
// EVERY RULE BELOW WAS READ OFF THE WIRE, not taken from the documentation, and
// four of them are not what the documentation says. The method: load the pixel,
// call `fbq('init', <id>, {…})` with a known awkward value, and read the
// `ud[<field>]` parameter out of the resulting request to www.facebook.com/tr.
// The observations, each of which contradicted a plausible first guess:
//
//   ph   '+353 (0)87 123 4567'  → 3530871234567   digits, and ALL of them —
//                                                 the (0) survives
//   fn/ln "O'Súilleabháin-Smith" → osúilleabháinsmith
//                                                 letters only — ACCENTS KEPT
//   ct   'Dún Laoghaire'        → dnlaoghaire     [a-z] only — the accented
//                                                 letter is DELETED, not folded,
//                                                 and not the same rule as names
//   st   'Co. Dublin'           → co              [a-z], then the FIRST TWO
//   st   'California'           → ca              CHARACTERS. A US state code
//                                                 convention applied to everyone,
//                                                 which is why `st` is nearly
//                                                 worthless outside the US — and
//                                                 why sending our own idea of it
//                                                 would match nobody
//   zp   'D18 K7W2'             → d18 k7w2        lowercased, SPACE KEPT
//   zp   ' SW1A-1AA '           → sw1a            …but cut at the first hyphen:
//                                                 the US ZIP+4 rule, applied to
//                                                 everyone
//   country 'Ireland'           → ie              the NAME is mapped to ISO 3166
//   external_id ' MiXeD-Case '  → sha256('mixed-case')
//                                                 trimmed, lowercased, and HASHED
//                                                 — the pixel does not send it in
//                                                 clear, so neither may we
//
// src/lib/metaCapi.test.ts pins every one of these against a hash computed
// independently of this file.
//
// Anything that normalises to nothing is OMITTED, never sent as an empty hash:
// sha256("") is a perfectly valid-looking 64-character string that matches every
// other empty field Meta has ever received.

const sha256Hex = (value) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');

const hashEmail = (v) => {
  const email = String(v || '').trim().toLowerCase();
  // A value with no @ is not an email; hashing it would add noise to the match
  // pool that can never match anything and that nothing would ever report.
  return email.includes('@') ? sha256Hex(email) : null;
};

const hashPhone = (v) => {
  // Every digit, in order, and nothing else. Our numbers are stored E.164
  // ("+353871234567"), so this is that with the + gone.
  const digits = String(v || '').replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15 ? sha256Hex(digits) : null;
};

// Letters only, accents INTACT. Folding "Ní" to "Ni" would hash a different
// string than the pixel does for the same person — which is the whole failure
// this file exists to avoid.
const hashName = (v) => {
  const name = String(v || '').trim().toLowerCase().replace(/[^\p{L}]/gu, '');
  return name ? sha256Hex(name) : null;
};

// And here, deliberately NOT the name rule: the pixel drops anything outside
// a-z from a city, accented letters included.
const hashCity = (v) => {
  const city = String(v || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  return city ? sha256Hex(city) : null;
};

// Two characters, because Meta reads every region as a US state code.
const hashState = (v) => {
  const state = String(v || '').trim().toLowerCase().replace(/[^a-z]/g, '').slice(0, 2);
  return state ? sha256Hex(state) : null;
};

// Lowercased and cut at the first hyphen (ZIP+4). The space inside an Eircode or
// a UK postcode is KEPT — stripping it, which every "tidy the postcode" instinct
// says to do, produces a string the pixel never sends.
const hashZip = (v) => {
  const zip = String(v || '').trim().toLowerCase().split('-')[0].trim();
  return zip ? sha256Hex(zip) : null;
};

/** Country NAME ("Ireland") → hashed ISO code ("ie"), which is all Meta matches on. */
const hashCountry = (v) => {
  const name = String(v || '').trim();
  if (!name) return null;
  const match = countryByName(name);
  const code = match?.code || (/^[A-Za-z]{2}$/.test(name) ? name : null);
  return code ? sha256Hex(code.toLowerCase()) : null;
};

/**
 * The opaque first-party id, hashed exactly as the pixel hashes it.
 *
 * NOT sent in clear. The pixel puts `sha256(trim(lowercase(id)))` on the wire —
 * observed, not assumed — and this is the one field where the browser's value
 * and the server's have to be the same string, because it is what joins a
 * server-written purchase to the browsing that led to it. Send one hashed and
 * the other plain and the sale silently detaches from its own session.
 */
const hashExternalId = (v) => {
  const id = String(v || '').trim().toLowerCase();
  return id ? sha256Hex(id) : null;
};

/**
 * Build one Meta `user_data` block from an order and the ids the browser
 * forwarded at checkout.
 *
 * The order of preference matters: the SHIPPING ADDRESS wins over the account
 * profile, because the address on the parcel is the one the shopper typed for
 * this purchase, while the profile may be a year out of date.
 */
const metaUserData = ({ analytics = {}, profile = {}, address = {}, advancedMatching }) => {
  const out = {};

  // The browser identifiers first — these are the ones that actually attribute
  // the sale to a campaign, and they are not personal data in the way the rest
  // is, so they are sent whether or not advanced matching is switched on.
  const fbp = metaBrowserId(analytics.fbp);
  if (fbp) out.fbp = fbp;
  const fbc = metaBrowserId(analytics.fbc);
  if (fbc) out.fbc = fbc;

  // Captured in the browser's own request when checkout started — see
  // /api/checkout/session. Never req.ip/req.headers here: this usually runs from
  // Stripe's webhook.
  if (typeof analytics.ip === 'string' && analytics.ip) out.client_ip_address = analytics.ip;
  if (typeof analytics.ua === 'string' && analytics.ua) out.client_user_agent = analytics.ua;

  if (!advancedMatching) return out;

  const externalId = hashExternalId(analytics.visitor_id);
  if (externalId) out.external_id = externalId;

  const em = hashEmail(profile.email);
  if (em) out.em = [em];
  const ph = hashPhone(address.phone || profile.phone);
  if (ph) out.ph = [ph];

  const fullName = String(address.full_name || profile.full_name || '').trim();
  const parts = fullName.split(/\s+/).filter(Boolean);
  const fn = hashName(parts[0]);
  if (fn) out.fn = [fn];
  const ln = hashName(parts.slice(1).join(' '));
  if (ln) out.ln = [ln];

  const ct = hashCity(address.city || profile.city);
  if (ct) out.ct = [ct];
  const st = hashState(address.state || profile.state);
  if (st) out.st = [st];
  // Pickup orders carry an `eircode` rather than a `postal_code` — the studio's
  // own, which is still a real postcode for the person collecting.
  const zp = hashZip(address.postal_code || address.eircode || profile.postal_code);
  if (zp) out.zp = [zp];
  const country = hashCountry(address.country || profile.country);
  if (country) out.country = [country];

  return out;
};


export {
  metaPixelId, metaBrowserId, metaTestCode,
  metaUserData,
  // Exported for the unit suite: each rule is asserted on its own, because a
  // wrong one is invisible in the assembled block.
  hashEmail, hashPhone, hashName, hashCity, hashState, hashZip, hashCountry, hashExternalId,
};
