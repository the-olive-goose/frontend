// Client-side validation for the checkout delivery address, tuned for a European
// storefront (EUR pricing, ships from Dublin). Country drives postal-code rules,
// so Ireland gets true Eircode validation while other EU/EEA markets get their
// own postal formats — with a permissive fallback for anywhere not enumerated.

export interface CountryOption {
  code: string; // ISO 3166-1 alpha-2 — used only to look up postal/phone rules
  name: string; // stored on the address as free text (backend keeps it as a string)
  dialCode: string;
}

// EU/EEA + UK, the realistic shipping footprint for an Irish candle studio.
// Ireland first so it's the natural default in the dropdown.
export const COUNTRIES: CountryOption[] = [
  { code: "IE", name: "Ireland", dialCode: "+353" },
  { code: "GB", name: "United Kingdom", dialCode: "+44" },
  { code: "AT", name: "Austria", dialCode: "+43" },
  { code: "BE", name: "Belgium", dialCode: "+32" },
  { code: "BG", name: "Bulgaria", dialCode: "+359" },
  { code: "HR", name: "Croatia", dialCode: "+385" },
  { code: "CY", name: "Cyprus", dialCode: "+357" },
  { code: "CZ", name: "Czechia", dialCode: "+420" },
  { code: "DK", name: "Denmark", dialCode: "+45" },
  { code: "EE", name: "Estonia", dialCode: "+372" },
  { code: "FI", name: "Finland", dialCode: "+358" },
  { code: "FR", name: "France", dialCode: "+33" },
  { code: "DE", name: "Germany", dialCode: "+49" },
  { code: "GR", name: "Greece", dialCode: "+30" },
  { code: "HU", name: "Hungary", dialCode: "+36" },
  { code: "IS", name: "Iceland", dialCode: "+354" },
  { code: "IT", name: "Italy", dialCode: "+39" },
  { code: "LV", name: "Latvia", dialCode: "+371" },
  { code: "LI", name: "Liechtenstein", dialCode: "+423" },
  { code: "LT", name: "Lithuania", dialCode: "+370" },
  { code: "LU", name: "Luxembourg", dialCode: "+352" },
  { code: "MT", name: "Malta", dialCode: "+356" },
  { code: "NL", name: "Netherlands", dialCode: "+31" },
  { code: "NO", name: "Norway", dialCode: "+47" },
  { code: "PL", name: "Poland", dialCode: "+48" },
  { code: "PT", name: "Portugal", dialCode: "+351" },
  { code: "RO", name: "Romania", dialCode: "+40" },
  { code: "SK", name: "Slovakia", dialCode: "+421" },
  { code: "SI", name: "Slovenia", dialCode: "+386" },
  { code: "ES", name: "Spain", dialCode: "+34" },
  { code: "SE", name: "Sweden", dialCode: "+46" },
  { code: "CH", name: "Switzerland", dialCode: "+41" },
];

const COUNTRY_BY_NAME = new Map(COUNTRIES.map(c => [c.name.toLowerCase(), c]));

export const countryByName = (name?: string): CountryOption | undefined =>
  name ? COUNTRY_BY_NAME.get(name.trim().toLowerCase()) : undefined;

// The 26 counties of the Republic of Ireland. Shown as a dropdown when Ireland is
// the selected country; other markets use a free-text region field.
export const IRISH_COUNTIES: string[] = [
  "Carlow", "Cavan", "Clare", "Cork", "Donegal", "Dublin", "Galway", "Kerry",
  "Kildare", "Kilkenny", "Laois", "Leitrim", "Limerick", "Longford", "Louth",
  "Mayo", "Meath", "Monaghan", "Offaly", "Roscommon", "Sligo", "Tipperary",
  "Waterford", "Westmeath", "Wexford", "Wicklow",
];

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

// Phone: accept an optional leading + and common separators, then require 7–15
// digits (E.164's ceiling). Loose on formatting, strict on digit count so couriers
// always get a dialable number.
export const isPhoneValid = (value: string): boolean => {
  const trimmed = value.trim();
  if (!/^\+?[0-9 ()\-.]+$/.test(trimmed)) return false;
  const digits = trimmed.replace(/[^0-9]/g, "");
  return digits.length >= 7 && digits.length <= 15;
};

export interface AddressLike {
  full_name?: string;
  phone?: string;
  address_line1?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
}

export type AddressField = "full_name" | "phone" | "address_line1" | "city" | "state" | "postal_code" | "country";
export type AddressErrors = Partial<Record<AddressField, string>>;

// Validates the full delivery address. Returns a map of field → message for every
// field that fails; an empty object means the address is good to submit.
export const validateDeliveryAddress = (a: AddressLike): AddressErrors => {
  const errors: AddressErrors = {};

  if (!a.full_name?.trim()) errors.full_name = "Enter the recipient's full name.";

  if (!a.phone?.trim()) errors.phone = "Enter a contact phone number.";
  else if (!isPhoneValid(a.phone)) errors.phone = "Enter a valid phone number (7–15 digits).";

  if (!a.address_line1?.trim()) errors.address_line1 = "Enter your street address.";

  if (!a.city?.trim()) errors.city = "Enter your city or town.";

  if (!a.country?.trim()) {
    errors.country = "Select a country.";
  }

  const rule = postalRuleFor(a.country);
  if (!a.postal_code?.trim()) {
    errors.postal_code = `Enter your ${rule.label.toLowerCase()}.`;
  } else if (!rule.pattern.test(a.postal_code.trim())) {
    errors.postal_code = rule.example
      ? `Enter a valid ${rule.label} (e.g. ${rule.example}).`
      : `Enter a valid ${rule.label}.`;
  }

  return errors;
};

// Eircode is stored uppercased with a single space before the last 4 chars, the
// canonical presentation. Applied on blur so shoppers see the tidy form.
export const formatEircode = (value: string): string => {
  const cleaned = value.replace(/\s+/g, "").toUpperCase();
  if (/^(?:[AC-FHKNPRTV-Y][0-9]{2}|D6W)[0-9AC-FHKNPRTV-Y]{4}$/.test(cleaned)) {
    return `${cleaned.slice(0, 3)} ${cleaned.slice(3)}`;
  }
  return value.trim();
};
