// Client-side validation for the checkout delivery address, tuned for a European
// storefront (EUR pricing, ships from Dublin). Country drives postal-code rules,
// county rules and phone rules, so Ireland gets true Eircode validation and true
// +353 number validation while other EU/EEA markets get their own — with a
// permissive fallback for anything not enumerated.
//
// The goal is an address that is *dispatchable at a glance*: a real street line,
// a real town, a real postcode for that country, and one dialable E.164 number.
// backend/addressRules.js mirrors these rules server-side — keep the two in sync.

export interface CountryOption {
  code: string; // ISO 3166-1 alpha-2 — used to look up postal/phone rules
  name: string; // stored on the address as free text (backend keeps it as a string)
  dialCode: string;
  // National significant number: the digits after the country code, once the
  // national trunk prefix is removed. Ranges are per-country on purpose — a
  // generic "7–15 digits" check happily accepts a 10-digit "Irish mobile".
  nsnMin: number;
  nsnMax: number;
  // The prefix subscribers write domestically that is *not* part of the
  // international number ("0" across most of Europe, "06" in Hungary, "8" in
  // Lithuania). Countries that have none — Italy above all, whose leading 0 is
  // part of the number — leave this undefined.
  trunkPrefix?: string;
  phoneExample: string; // in national format, the way a shopper would write it
}

// EU/EEA + UK, the realistic shipping footprint for an Irish candle studio.
// Ireland first so it's the natural default in the dropdown.
export const COUNTRIES: CountryOption[] = [
  { code: "IE", name: "Ireland",        dialCode: "+353", nsnMin: 7,  nsnMax: 9,  trunkPrefix: "0",  phoneExample: "087 123 4567" },
  { code: "GB", name: "United Kingdom", dialCode: "+44",  nsnMin: 9,  nsnMax: 10, trunkPrefix: "0",  phoneExample: "07700 900123" },
  { code: "AT", name: "Austria",        dialCode: "+43",  nsnMin: 7,  nsnMax: 13, trunkPrefix: "0",  phoneExample: "0664 1234567" },
  { code: "BE", name: "Belgium",        dialCode: "+32",  nsnMin: 8,  nsnMax: 9,  trunkPrefix: "0",  phoneExample: "0470 12 34 56" },
  { code: "BG", name: "Bulgaria",       dialCode: "+359", nsnMin: 8,  nsnMax: 9,  trunkPrefix: "0",  phoneExample: "087 123 4567" },
  { code: "HR", name: "Croatia",        dialCode: "+385", nsnMin: 8,  nsnMax: 9,  trunkPrefix: "0",  phoneExample: "091 234 5678" },
  { code: "CY", name: "Cyprus",         dialCode: "+357", nsnMin: 8,  nsnMax: 8,                     phoneExample: "96 123456" },
  { code: "CZ", name: "Czechia",        dialCode: "+420", nsnMin: 9,  nsnMax: 9,                     phoneExample: "601 123 456" },
  { code: "DK", name: "Denmark",        dialCode: "+45",  nsnMin: 8,  nsnMax: 8,                     phoneExample: "32 12 34 56" },
  { code: "EE", name: "Estonia",        dialCode: "+372", nsnMin: 7,  nsnMax: 8,                     phoneExample: "5123 4567" },
  { code: "FI", name: "Finland",        dialCode: "+358", nsnMin: 6,  nsnMax: 11, trunkPrefix: "0",  phoneExample: "050 123 4567" },
  { code: "FR", name: "France",         dialCode: "+33",  nsnMin: 9,  nsnMax: 9,  trunkPrefix: "0",  phoneExample: "06 12 34 56 78" },
  { code: "DE", name: "Germany",        dialCode: "+49",  nsnMin: 6,  nsnMax: 13, trunkPrefix: "0",  phoneExample: "0151 12345678" },
  { code: "GR", name: "Greece",         dialCode: "+30",  nsnMin: 10, nsnMax: 10,                    phoneExample: "694 123 4567" },
  { code: "HU", name: "Hungary",        dialCode: "+36",  nsnMin: 8,  nsnMax: 9,  trunkPrefix: "06", phoneExample: "06 20 123 4567" },
  { code: "IS", name: "Iceland",        dialCode: "+354", nsnMin: 7,  nsnMax: 7,                     phoneExample: "611 1234" },
  { code: "IT", name: "Italy",          dialCode: "+39",  nsnMin: 6,  nsnMax: 11,                    phoneExample: "320 123 4567" },
  { code: "LV", name: "Latvia",         dialCode: "+371", nsnMin: 8,  nsnMax: 8,                     phoneExample: "21 234 567" },
  { code: "LI", name: "Liechtenstein",  dialCode: "+423", nsnMin: 7,  nsnMax: 9,                     phoneExample: "660 234 567" },
  { code: "LT", name: "Lithuania",      dialCode: "+370", nsnMin: 8,  nsnMax: 8,  trunkPrefix: "8",  phoneExample: "612 34567" },
  { code: "LU", name: "Luxembourg",     dialCode: "+352", nsnMin: 6,  nsnMax: 9,                     phoneExample: "621 123 456" },
  { code: "MT", name: "Malta",          dialCode: "+356", nsnMin: 8,  nsnMax: 8,                     phoneExample: "9696 1234" },
  { code: "NL", name: "Netherlands",    dialCode: "+31",  nsnMin: 9,  nsnMax: 9,  trunkPrefix: "0",  phoneExample: "06 12345678" },
  { code: "NO", name: "Norway",         dialCode: "+47",  nsnMin: 8,  nsnMax: 8,                     phoneExample: "406 12 345" },
  { code: "PL", name: "Poland",         dialCode: "+48",  nsnMin: 9,  nsnMax: 9,                     phoneExample: "512 345 678" },
  { code: "PT", name: "Portugal",       dialCode: "+351", nsnMin: 9,  nsnMax: 9,                     phoneExample: "912 345 678" },
  { code: "RO", name: "Romania",        dialCode: "+40",  nsnMin: 9,  nsnMax: 9,  trunkPrefix: "0",  phoneExample: "0712 345 678" },
  { code: "SK", name: "Slovakia",       dialCode: "+421", nsnMin: 9,  nsnMax: 9,  trunkPrefix: "0",  phoneExample: "0912 123 456" },
  { code: "SI", name: "Slovenia",       dialCode: "+386", nsnMin: 8,  nsnMax: 8,  trunkPrefix: "0",  phoneExample: "031 234 567" },
  { code: "ES", name: "Spain",          dialCode: "+34",  nsnMin: 9,  nsnMax: 9,                     phoneExample: "612 345 678" },
  { code: "SE", name: "Sweden",         dialCode: "+46",  nsnMin: 7,  nsnMax: 10, trunkPrefix: "0",  phoneExample: "070 123 4567" },
  { code: "CH", name: "Switzerland",    dialCode: "+41",  nsnMin: 9,  nsnMax: 9,  trunkPrefix: "0",  phoneExample: "078 123 45 67" },
];

const COUNTRY_BY_NAME = new Map(COUNTRIES.map(c => [c.name.toLowerCase(), c]));
const COUNTRY_BY_CODE = new Map(COUNTRIES.map(c => [c.code, c]));

export const countryByName = (name?: string): CountryOption | undefined =>
  name ? COUNTRY_BY_NAME.get(name.trim().toLowerCase()) : undefined;

export const DEFAULT_COUNTRY = COUNTRY_BY_CODE.get("IE")!;

// Longest dial code first: +353 must win over +35 lookalikes when matching a
// stored E.164 number by prefix.
const DIAL_CODES_LONGEST_FIRST = [...COUNTRIES].sort((a, b) => b.dialCode.length - a.dialCode.length);

// Several countries share a dial code (none in this list today, but +44/+41-style
// collisions are one country addition away), so the picker de-duplicates by code.
export const DIAL_OPTIONS = COUNTRIES
  .filter((c, i, all) => all.findIndex(o => o.dialCode === c.dialCode) === i)
  .sort((a, b) => (a.code === "IE" ? -1 : b.code === "IE" ? 1 : a.name.localeCompare(b.name)));

// The 26 counties of the Republic of Ireland. Shown as a dropdown when Ireland is
// the selected country; other markets use a free-text region field.
export const IRISH_COUNTIES: string[] = [
  "Carlow", "Cavan", "Clare", "Cork", "Donegal", "Dublin", "Galway", "Kerry",
  "Kildare", "Kilkenny", "Laois", "Leitrim", "Limerick", "Longford", "Louth",
  "Mayo", "Meath", "Monaghan", "Offaly", "Roscommon", "Sligo", "Tipperary",
  "Waterford", "Westmeath", "Wexford", "Wicklow",
];

// Field length caps, applied as maxLength on the inputs *and* enforced here so a
// direct API call can't store a value that overflows a courier label.
export const MAX_LENGTHS = {
  full_name: 60,
  address_line1: 100,
  address_line2: 100,
  city: 60,
  state: 60,
  postal_code: 12,
} as const;

// ── Postal codes ───────────────────────────────────────────────────────────────

// Per-country postal-code rules. `label` names the field appropriately (Eircode,
// PLZ, etc.); `pattern` is matched case-insensitively after trimming. Countries
// without an entry fall back to a permissive alphanumeric check.
interface PostalRule {
  label: string;
  example: string;
  pattern: RegExp;
}

const POSTAL_RULES: Record<string, PostalRule> = {
  // Eircode: a routing key (a letter + two digits, or the special D6W) followed by
  // a 4-character unique identifier. Both halves draw from the Eircode alphabet,
  // which omits look-alike letters (B, G, I, J, L, M, O, Q, S, U, Z).
  IE: { label: "Eircode", example: "D18 K7W2", pattern: /^(?:[AC-FHKNPRTV-Y][0-9]{2}|D6W) ?[0-9AC-FHKNPRTV-Y]{4}$/i },
  GB: { label: "Postcode", example: "SW1A 1AA", pattern: /^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$/i },
  NL: { label: "Postcode", example: "1012 AB", pattern: /^[0-9]{4} ?[A-Z]{2}$/i },
  PT: { label: "Código postal", example: "1000-001", pattern: /^[0-9]{4}-[0-9]{3}$/ },
  PL: { label: "Kod pocztowy", example: "00-950", pattern: /^[0-9]{2}-[0-9]{3}$/ },
  SE: { label: "Postnummer", example: "114 55", pattern: /^[0-9]{3} ?[0-9]{2}$/ },
  MT: { label: "Post code", example: "VLT 1117", pattern: /^[A-Z]{3} ?[0-9]{4}$/i },
  // Five-digit countries
  DE: { label: "PLZ", example: "10115", pattern: /^[0-9]{5}$/ },
  FR: { label: "Code postal", example: "75008", pattern: /^[0-9]{5}$/ },
  ES: { label: "Código postal", example: "28013", pattern: /^[0-9]{5}$/ },
  IT: { label: "CAP", example: "00184", pattern: /^[0-9]{5}$/ },
  FI: { label: "Postinumero", example: "00100", pattern: /^[0-9]{5}$/ },
  GR: { label: "Postal code", example: "104 31", pattern: /^[0-9]{3} ?[0-9]{2}$/ },
  HR: { label: "Poštanski broj", example: "10000", pattern: /^[0-9]{5}$/ },
  EE: { label: "Sihtnumber", example: "10111", pattern: /^[0-9]{5}$/ },
  LT: { label: "Pašto kodas", example: "01100", pattern: /^(?:LT-)?[0-9]{5}$/i },
  LV: { label: "Pasta indekss", example: "LV-1050", pattern: /^(?:LV-)?[0-9]{4}$/i },
  SK: { label: "PSČ", example: "811 01", pattern: /^[0-9]{3} ?[0-9]{2}$/ },
  CZ: { label: "PSČ", example: "110 00", pattern: /^[0-9]{3} ?[0-9]{2}$/ },
  // Four-digit countries
  AT: { label: "PLZ", example: "1010", pattern: /^[0-9]{4}$/ },
  BE: { label: "Code postal", example: "1000", pattern: /^[0-9]{4}$/ },
  DK: { label: "Postnummer", example: "1050", pattern: /^[0-9]{4}$/ },
  NO: { label: "Postnummer", example: "0155", pattern: /^[0-9]{4}$/ },
  CH: { label: "PLZ", example: "8001", pattern: /^[0-9]{4}$/ },
  LU: { label: "Code postal", example: "1009", pattern: /^(?:L-)?[0-9]{4}$/i },
  BG: { label: "Пощенски код", example: "1000", pattern: /^[0-9]{4}$/ },
  HU: { label: "Irányítószám", example: "1051", pattern: /^[0-9]{4}$/ },
  SI: { label: "Poštna številka", example: "1000", pattern: /^[0-9]{4}$/ },
  CY: { label: "Postal code", example: "1010", pattern: /^[0-9]{4}$/ },
  RO: { label: "Cod poștal", example: "010011", pattern: /^[0-9]{6}$/ },
  LI: { label: "PLZ", example: "9490", pattern: /^[0-9]{4}$/ },
  IS: { label: "Póstnúmer", example: "101", pattern: /^[0-9]{3}$/ },
};

const FALLBACK_POSTAL_RULE: PostalRule = {
  label: "Postal code",
  example: "",
  // Anything plausibly a postcode: 3–10 letters/digits, with optional spaces/dashes.
  pattern: /^[A-Z0-9][A-Z0-9 -]{1,8}[A-Z0-9]$/i,
};

export const postalRuleFor = (countryName?: string): PostalRule => {
  const c = countryByName(countryName);
  return (c && POSTAL_RULES[c.code]) || FALLBACK_POSTAL_RULE;
};

export const isPostalValid = (countryName: string | undefined, value: string): boolean =>
  postalRuleFor(countryName).pattern.test(value.trim());

// Ireland uses counties (dropdown); every other market keeps region free-text.
export const usesCountyDropdown = (countryName?: string): boolean =>
  countryByName(countryName)?.code === "IE";

// Eircode is stored uppercased with a single space before the last 4 chars, the
// canonical presentation. Applied on blur so shoppers see the tidy form.
export const formatEircode = (value: string): string => {
  const cleaned = value.replace(/\s+/g, "").toUpperCase();
  if (/^(?:[AC-FHKNPRTV-Y][0-9]{2}|D6W)[0-9AC-FHKNPRTV-Y]{4}$/.test(cleaned)) {
    return `${cleaned.slice(0, 3)} ${cleaned.slice(3)}`;
  }
  return value.trim();
};

// County implied by an Eircode's routing key, where the mapping is unambiguous.
// Only the D keys qualify: every D routing key (D01–D24 plus D6W) is inside
// Dublin. The reverse is deliberately *not* asserted — County Dublin also holds
// A96 (Dún Laoghaire), K32 (Balbriggan), K67 (Swords) and friends, so "county is
// Dublin" implies nothing about the routing key. Anything outside that certainty
// returns undefined rather than risking a false rejection on a real address.
export const countyFromEircode = (postalCode?: string): string | undefined => {
  const key = (postalCode ?? "").replace(/\s+/g, "").toUpperCase().slice(0, 3);
  return /^D(?:[0-9]{2}|6W)$/.test(key) ? "Dublin" : undefined;
};

// ── Phone numbers ──────────────────────────────────────────────────────────────

// Phone is stored as E.164 ("+353871234567"): one unambiguous, dialable string
// for the courier and for ops, whatever the shopper typed. The UI splits it into
// a dial-code dropdown and a national-number box; these two functions are the
// bridge, and they round-trip: split(compose(d, n)) === { d, n-as-digits }.

export interface PhoneParts {
  dialCode: string;
  national: string;
}

const digitsOf = (value: string): string => value.replace(/[^0-9]/g, "");

// Drop the domestic trunk prefix. A valid national number never starts with it,
// so this is unconditional when the prefix is present and something remains.
const stripTrunk = (digits: string, country: CountryOption): string => {
  const p = country.trunkPrefix;
  if (p && digits.length > p.length && digits.startsWith(p)) return digits.slice(p.length);
  return digits;
};

export const countryByDialCode = (dialCode?: string): CountryOption | undefined =>
  dialCode ? DIAL_CODES_LONGEST_FIRST.find(c => c.dialCode === dialCode) : undefined;

// Split a stored number into dial code + national digits. A stored E.164 number
// picks its own dial code; a legacy bare number (everything saved before this
// existed) is read against the address's country, defaulting to Ireland.
export const splitPhone = (stored?: string, countryName?: string): PhoneParts => {
  const fallback = countryByName(countryName) ?? DEFAULT_COUNTRY;
  const raw = (stored ?? "").trim();
  if (raw.startsWith("+")) {
    const match = DIAL_CODES_LONGEST_FIRST.find(c => raw.startsWith(c.dialCode));
    if (match) return { dialCode: match.dialCode, national: digitsOf(raw.slice(match.dialCode.length)) };
    // An unknown +code: keep the digits, fall back to the address's dial code so
    // the shopper is asked to re-pick rather than silently losing the number.
    return { dialCode: fallback.dialCode, national: digitsOf(raw) };
  }
  return { dialCode: fallback.dialCode, national: stripTrunk(digitsOf(raw), fallback) };
};

// Recognise a number typed or pasted in international form — "+353 85…" or the
// "00353 85…" dialling prefix — so the UI can adopt its country code instead of
// appending it to whatever the dropdown happened to be showing. Returns
// undefined for anything that isn't yet a recognisable code, which is what a
// half-typed "+3" is: the field must not jump around mid-keystroke.
export const parseInternational = (input: string): PhoneParts | undefined => {
  const trimmed = input.trim();
  const e164 = trimmed.startsWith("+") ? trimmed
    : /^00[0-9]/.test(trimmed.replace(/[^0-9]/g, "")) ? `+${digitsOf(trimmed).slice(2)}`
    : "";
  if (!e164) return undefined;
  const match = DIAL_CODES_LONGEST_FIRST.find(c => e164.startsWith(c.dialCode));
  return match ? { dialCode: match.dialCode, national: digitsOf(e164.slice(match.dialCode.length)) } : undefined;
};

// Build the stored value. An empty national part stores nothing at all, so the
// "phone is required" check fires instead of persisting a lone dial code.
export const composePhone = (dialCode: string, national: string): string => {
  const country = countryByDialCode(dialCode) ?? DEFAULT_COUNTRY;
  const nsn = stripTrunk(digitsOf(national), country);
  return nsn ? `${country.dialCode}${nsn}` : "";
};

// Validates a stored (E.164) number against its *own* country's rules — an Irish
// delivery address with a UK mobile on it is a perfectly normal gift order.
export const phoneError = (stored?: string): string | undefined => {
  const raw = (stored ?? "").trim();
  if (!raw) return "Enter a mobile number the courier can reach.";
  if (!raw.startsWith("+")) return "Choose a country code for the phone number.";
  const country = DIAL_CODES_LONGEST_FIRST.find(c => raw.startsWith(c.dialCode));
  if (!country) return "Choose a country code for the phone number.";
  const nsn = digitsOf(raw.slice(country.dialCode.length));
  if (!nsn) return "Enter a mobile number the courier can reach.";
  if (nsn.startsWith("0"))
    return `Drop the leading 0 — ${country.name} numbers are stored without it (e.g. ${country.phoneExample}).`;
  if (nsn.length < country.nsnMin || nsn.length > country.nsnMax)
    return `That isn't a valid ${country.name} number. Expected ${describeLength(country)} digits after ${country.dialCode} (e.g. ${country.phoneExample}).`;
  return undefined;
};

const describeLength = (c: CountryOption): string =>
  c.nsnMin === c.nsnMax ? `${c.nsnMin}` : `${c.nsnMin}–${c.nsnMax}`;

// The digit-group sizes a country writes its numbers in, read off phoneExample
// with the trunk prefix removed: Ireland's "087 123 4567" becomes [2, 3, 4], so
// a stored +353 number prints as "+353 87 123 4567" the way anyone here reads it.
const nationalGrouping = (c: CountryOption): number[] | undefined => {
  const groups = c.phoneExample.split(/[\s-]+/).map(g => digitsOf(g).length).filter(Boolean);
  if (c.trunkPrefix) groups[0] -= c.trunkPrefix.length;
  return groups[0] > 0 && groups.reduce((a, b) => a + b, 0) > 0 ? groups : undefined;
};

// "+353871234567" → "+353 87 123 4567". Ops reads this on order cards and picking
// slips, so it's grouped rather than run together as one 12-digit wall.
export const formatPhoneDisplay = (stored?: string): string => {
  const raw = (stored ?? "").trim();
  if (!raw.startsWith("+")) return raw;
  const country = DIAL_CODES_LONGEST_FIRST.find(c => raw.startsWith(c.dialCode));
  if (!country) return raw;
  const nsn = digitsOf(raw.slice(country.dialCode.length));
  if (!nsn) return raw;

  // Use the national grouping when the number is exactly the length that grouping
  // describes; otherwise fall back to plain threes rather than mangling it.
  const grouping = nationalGrouping(country);
  const groups: string[] = [];
  if (grouping && grouping.reduce((a, b) => a + b, 0) === nsn.length) {
    let at = 0;
    for (const size of grouping) { groups.push(nsn.slice(at, at + size)); at += size; }
  } else {
    groups.push(...(nsn.match(/.{1,3}/g) ?? []));
  }
  return `${country.dialCode} ${groups.filter(Boolean).join(" ")}`;
};

// ── Free-text quality ──────────────────────────────────────────────────────────

// A single character typed over and over ("4444", "ddd", "aaaaaa") is the classic
// "just let me past this form" input. It reaches ops as an undeliverable address,
// so it's rejected everywhere a real word is expected.
const isRepeatedChar = (value: string): boolean => {
  const compact = value.replace(/[\s.,'’-]/g, "");
  return compact.length >= 3 && new Set(compact.toLowerCase()).size === 1;
};

const hasLetter = (value: string): boolean => /\p{L}/u.test(value);

// Collapse runs of whitespace and trim — what actually gets stored.
export const tidy = (value?: string): string => (value ?? "").replace(/\s+/g, " ").trim();

// ── Names ──────────────────────────────────────────────────────────────────────

// A name has to survive being printed on a courier label and read by a human:
// something with a letter in it, not one character mashed repeatedly, and short
// enough that the label doesn't truncate it. The substance is identical wherever
// a name is collected — only the copy changes, because "the recipient's name" is
// the wrong phrase when a shopper is editing their own account.
export interface NameCopy {
  missing: string;
  invalid: string;
  long: string;
}

export const RECIPIENT_NAME_COPY: NameCopy = {
  missing: "Enter the recipient's full name.",
  invalid: "Enter the recipient's real name, as it should appear on the parcel.",
  long: `Keep the name under ${MAX_LENGTHS.full_name} characters.`,
};

export const ACCOUNT_NAME_COPY: NameCopy = {
  missing: "Enter your full name.",
  invalid: "Enter your real name — it goes on your orders and on your parcels.",
  long: `Keep the name under ${MAX_LENGTHS.full_name} characters.`,
};

// Judges the tidied value, so what's checked is exactly what would be stored:
// "  Aoife   Byrne " passes and is stored as "Aoife Byrne", and a name that is
// only whitespace is missing rather than 3 characters long.
export const nameError = (raw?: string, copy: NameCopy = RECIPIENT_NAME_COPY): string | undefined => {
  const name = tidy(raw);
  if (!name) return copy.missing;
  if (name.length < 2 || !hasLetter(name) || isRepeatedChar(name)) return copy.invalid;
  if (name.length > MAX_LENGTHS.full_name) return copy.long;
  return undefined;
};

// ── Address validation ─────────────────────────────────────────────────────────

export interface AddressLike {
  full_name?: string;
  phone?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
}

export type AddressField =
  "full_name" | "phone" | "address_line1" | "address_line2" | "city" | "state" | "postal_code" | "country";
export type AddressErrors = Partial<Record<AddressField, string>>;

// Every field the form can surface an error on, in the order they're rendered —
// used to reveal all messages at once on a blocked submit.
export const ADDRESS_FIELDS: AddressField[] = [
  "full_name", "phone", "address_line1", "address_line2", "country", "city", "state", "postal_code",
];

// Validates the full delivery address. Returns a map of field → message for every
// field that fails; an empty object means the address is good to submit.
//
// The address is normalized first, so what's validated is exactly what would be
// stored — a legacy bare phone is judged as the E.164 number it becomes, not
// rejected for a missing country code the shopper was never shown. The backend
// twin (backend/addressRules.js validateAddress) is deliberately the same
// sequence, one message at a time; addressRulesParity.test.ts pins them together.
export const validateDeliveryAddress = (raw: AddressLike): AddressErrors => {
  const a = normalizeAddress(raw);
  const errors: AddressErrors = {};

  // Recipient — the name that goes on the label. Digits-only or one repeated
  // character isn't a person, and an over-long name gets truncated by couriers.
  errors.full_name = nameError(a.full_name);

  errors.phone = phoneError(a.phone);

  // Street line — must name a street, not just a house number. "4444" is the
  // single most common piece of junk that reaches dispatch as undeliverable.
  const line1 = a.address_line1;
  if (!line1) errors.address_line1 = "Enter your street address.";
  else if (!hasLetter(line1) || line1.length < 4 || isRepeatedChar(line1))
    errors.address_line1 = "Include the street name, e.g. 12 Beacon Court.";
  else if (line1.length > MAX_LENGTHS.address_line1)
    errors.address_line1 = `Keep line 1 under ${MAX_LENGTHS.address_line1} characters.`;

  // Line 2 is optional, but if it's filled in it has to mean something.
  const line2 = a.address_line2;
  if (line2 && (!hasLetter(line2) || isRepeatedChar(line2)))
    errors.address_line2 = "Use line 2 for an apartment, estate or townland — or leave it empty.";
  else if (line2.length > MAX_LENGTHS.address_line2)
    errors.address_line2 = `Keep line 2 under ${MAX_LENGTHS.address_line2} characters.`;

  const country = a.country;
  if (!country) errors.country = "Select a country.";
  else if (!countryByName(country)) errors.country = "Select a country we ship to from the list.";

  const city = a.city;
  if (!city) errors.city = "Enter your city or town.";
  else if (city.length < 2 || !hasLetter(city) || isRepeatedChar(city))
    errors.city = "Enter the full name of your city or town.";
  else if (city.length > MAX_LENGTHS.city)
    errors.city = `Keep the city under ${MAX_LENGTHS.city} characters.`;

  // Region: a required county in Ireland (it's part of the address and it's how
  // dispatch sorts the run), free-text and optional everywhere else.
  const state = a.state;
  if (usesCountyDropdown(country)) {
    if (!state) errors.state = "Select your county.";
    else if (!IRISH_COUNTIES.includes(state)) errors.state = "Select your county from the list.";
  } else if (state.length > MAX_LENGTHS.state) {
    errors.state = `Keep the region under ${MAX_LENGTHS.state} characters.`;
  }

  const rule = postalRuleFor(country);
  const postal = a.postal_code;
  if (!postal) {
    errors.postal_code = `Enter your ${rule.label.toLowerCase()}.`;
  } else if (!rule.pattern.test(postal)) {
    errors.postal_code = rule.example
      ? `Enter a valid ${rule.label} (e.g. ${rule.example}).`
      : `Enter a valid ${rule.label}.`;
  } else {
    // Cross-check the two Irish fields against each other, so a Cork county with
    // a Dublin Eircode can't reach dispatch looking plausible on both lines.
    const implied = usesCountyDropdown(country) ? countyFromEircode(postal) : undefined;
    if (implied && state && implied !== state)
      errors.postal_code = `That Eircode is in County ${implied}, not ${state}. Check the county and the Eircode.`;
  }

  // Drop the keys we set to undefined so callers can keep using "no keys = valid".
  for (const k of Object.keys(errors) as AddressField[]) if (!errors[k]) delete errors[k];
  return errors;
};

// The exact shape that gets persisted: trimmed, whitespace-collapsed, phone in
// E.164, Eircode in canonical form. Applied on both sides of the wire so the row
// in the database is the same whether it came from the form or from the API.
export type NormalizedAddress = Required<AddressLike>;

export const normalizeAddress = <T extends AddressLike>(a: T): T & NormalizedAddress => {
  const country = tidy(a.country);
  const postal = tidy(a.postal_code);
  const phone = splitPhone(a.phone, country);
  return {
    ...a,
    full_name: tidy(a.full_name),
    phone: composePhone(phone.dialCode, phone.national),
    address_line1: tidy(a.address_line1),
    address_line2: tidy(a.address_line2),
    city: tidy(a.city),
    state: tidy(a.state),
    postal_code: usesCountyDropdown(country) ? formatEircode(postal) : postal.toUpperCase(),
    country,
  };
};

// ── Ops-facing formatting ──────────────────────────────────────────────────────

// The address as a courier would read it, one element per line. Used on admin
// order cards and packing views so a dispatcher never has to reassemble it.
export const formatAddressBlock = (a: AddressLike): string[] =>
  [
    tidy(a.full_name),
    tidy(a.address_line1),
    tidy(a.address_line2),
    tidy(a.city),
    usesCountyDropdown(a.country) && tidy(a.state) ? `Co. ${tidy(a.state)}` : tidy(a.state),
    tidy(a.postal_code),
    tidy(a.country),
  ].filter(Boolean);

// Same content collapsed to a single line, for list rows and pickers.
export const formatAddressOneLine = (a: AddressLike): string =>
  formatAddressBlock(a).slice(1).join(", ");
