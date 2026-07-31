// Server-side mirror of src/lib/addressValidation.ts. The storefront can't be the
// only thing standing between a shopper and an undeliverable parcel: anything that
// speaks to /api/user/addresses or /api/checkout/session goes through the same
// rules here, and every address is normalized to one shape before it is stored —
// phone in E.164, Eircode canonical, whitespace collapsed.
//
// Keep in sync with src/lib/addressValidation.ts (same arrangement as
// computeBundleSavings, which is likewise duplicated across the two runtimes).

// code, name, dial code, national-number digit range, domestic trunk prefix, example.
const COUNTRIES = [
  { code: 'IE', name: 'Ireland',        dialCode: '+353', nsnMin: 7,  nsnMax: 9,  trunkPrefix: '0',  phoneExample: '087 123 4567' },
  { code: 'GB', name: 'United Kingdom', dialCode: '+44',  nsnMin: 9,  nsnMax: 10, trunkPrefix: '0',  phoneExample: '07700 900123' },
  { code: 'AT', name: 'Austria',        dialCode: '+43',  nsnMin: 7,  nsnMax: 13, trunkPrefix: '0',  phoneExample: '0664 1234567' },
  { code: 'BE', name: 'Belgium',        dialCode: '+32',  nsnMin: 8,  nsnMax: 9,  trunkPrefix: '0',  phoneExample: '0470 12 34 56' },
  { code: 'BG', name: 'Bulgaria',       dialCode: '+359', nsnMin: 8,  nsnMax: 9,  trunkPrefix: '0',  phoneExample: '087 123 4567' },
  { code: 'HR', name: 'Croatia',        dialCode: '+385', nsnMin: 8,  nsnMax: 9,  trunkPrefix: '0',  phoneExample: '091 234 5678' },
  { code: 'CY', name: 'Cyprus',         dialCode: '+357', nsnMin: 8,  nsnMax: 8,                     phoneExample: '96 123456' },
  { code: 'CZ', name: 'Czechia',        dialCode: '+420', nsnMin: 9,  nsnMax: 9,                     phoneExample: '601 123 456' },
  { code: 'DK', name: 'Denmark',        dialCode: '+45',  nsnMin: 8,  nsnMax: 8,                     phoneExample: '32 12 34 56' },
  { code: 'EE', name: 'Estonia',        dialCode: '+372', nsnMin: 7,  nsnMax: 8,                     phoneExample: '5123 4567' },
  { code: 'FI', name: 'Finland',        dialCode: '+358', nsnMin: 6,  nsnMax: 11, trunkPrefix: '0',  phoneExample: '050 123 4567' },
  { code: 'FR', name: 'France',         dialCode: '+33',  nsnMin: 9,  nsnMax: 9,  trunkPrefix: '0',  phoneExample: '06 12 34 56 78' },
  { code: 'DE', name: 'Germany',        dialCode: '+49',  nsnMin: 6,  nsnMax: 13, trunkPrefix: '0',  phoneExample: '0151 12345678' },
  { code: 'GR', name: 'Greece',         dialCode: '+30',  nsnMin: 10, nsnMax: 10,                    phoneExample: '694 123 4567' },
  { code: 'HU', name: 'Hungary',        dialCode: '+36',  nsnMin: 8,  nsnMax: 9,  trunkPrefix: '06', phoneExample: '06 20 123 4567' },
  { code: 'IS', name: 'Iceland',        dialCode: '+354', nsnMin: 7,  nsnMax: 7,                     phoneExample: '611 1234' },
  { code: 'IT', name: 'Italy',          dialCode: '+39',  nsnMin: 6,  nsnMax: 11,                    phoneExample: '320 123 4567' },
  { code: 'LV', name: 'Latvia',         dialCode: '+371', nsnMin: 8,  nsnMax: 8,                     phoneExample: '21 234 567' },
  { code: 'LI', name: 'Liechtenstein',  dialCode: '+423', nsnMin: 7,  nsnMax: 9,                     phoneExample: '660 234 567' },
  { code: 'LT', name: 'Lithuania',      dialCode: '+370', nsnMin: 8,  nsnMax: 8,  trunkPrefix: '8',  phoneExample: '612 34567' },
  { code: 'LU', name: 'Luxembourg',     dialCode: '+352', nsnMin: 6,  nsnMax: 9,                     phoneExample: '621 123 456' },
  { code: 'MT', name: 'Malta',          dialCode: '+356', nsnMin: 8,  nsnMax: 8,                     phoneExample: '9696 1234' },
  { code: 'NL', name: 'Netherlands',    dialCode: '+31',  nsnMin: 9,  nsnMax: 9,  trunkPrefix: '0',  phoneExample: '06 12345678' },
  { code: 'NO', name: 'Norway',         dialCode: '+47',  nsnMin: 8,  nsnMax: 8,                     phoneExample: '406 12 345' },
  { code: 'PL', name: 'Poland',         dialCode: '+48',  nsnMin: 9,  nsnMax: 9,                     phoneExample: '512 345 678' },
  { code: 'PT', name: 'Portugal',       dialCode: '+351', nsnMin: 9,  nsnMax: 9,                     phoneExample: '912 345 678' },
  { code: 'RO', name: 'Romania',        dialCode: '+40',  nsnMin: 9,  nsnMax: 9,  trunkPrefix: '0',  phoneExample: '0712 345 678' },
  { code: 'SK', name: 'Slovakia',       dialCode: '+421', nsnMin: 9,  nsnMax: 9,  trunkPrefix: '0',  phoneExample: '0912 123 456' },
  { code: 'SI', name: 'Slovenia',       dialCode: '+386', nsnMin: 8,  nsnMax: 8,  trunkPrefix: '0',  phoneExample: '031 234 567' },
  { code: 'ES', name: 'Spain',          dialCode: '+34',  nsnMin: 9,  nsnMax: 9,                     phoneExample: '612 345 678' },
  { code: 'SE', name: 'Sweden',         dialCode: '+46',  nsnMin: 7,  nsnMax: 10, trunkPrefix: '0',  phoneExample: '070 123 4567' },
  { code: 'CH', name: 'Switzerland',    dialCode: '+41',  nsnMin: 9,  nsnMax: 9,  trunkPrefix: '0',  phoneExample: '078 123 45 67' },
];

const COUNTRY_BY_NAME = new Map(COUNTRIES.map(c => [c.name.toLowerCase(), c]));
const DEFAULT_COUNTRY = COUNTRIES[0]; // Ireland
// Longest first so +353 wins over any shorter prefix it starts with.
const BY_DIAL_LENGTH = [...COUNTRIES].sort((a, b) => b.dialCode.length - a.dialCode.length);

const countryByName = name => (name ? COUNTRY_BY_NAME.get(String(name).trim().toLowerCase()) : undefined);

const IRISH_COUNTIES = [
  'Carlow', 'Cavan', 'Clare', 'Cork', 'Donegal', 'Dublin', 'Galway', 'Kerry',
  'Kildare', 'Kilkenny', 'Laois', 'Leitrim', 'Limerick', 'Longford', 'Louth',
  'Mayo', 'Meath', 'Monaghan', 'Offaly', 'Roscommon', 'Sligo', 'Tipperary',
  'Waterford', 'Westmeath', 'Wexford', 'Wicklow',
];

const MAX_LENGTHS = {
  full_name: 60, address_line1: 100, address_line2: 100, city: 60, state: 60, postal_code: 12,
};

const POSTAL_RULES = {
  IE: { label: 'Eircode', example: 'D18 K7W2', pattern: /^(?:[AC-FHKNPRTV-Y][0-9]{2}|D6W) ?[0-9AC-FHKNPRTV-Y]{4}$/i },
  GB: { label: 'Postcode', example: 'SW1A 1AA', pattern: /^[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}$/i },
  NL: { label: 'Postcode', example: '1012 AB', pattern: /^[0-9]{4} ?[A-Z]{2}$/i },
  PT: { label: 'Código postal', example: '1000-001', pattern: /^[0-9]{4}-[0-9]{3}$/ },
  PL: { label: 'Kod pocztowy', example: '00-950', pattern: /^[0-9]{2}-[0-9]{3}$/ },
  SE: { label: 'Postnummer', example: '114 55', pattern: /^[0-9]{3} ?[0-9]{2}$/ },
  MT: { label: 'Post code', example: 'VLT 1117', pattern: /^[A-Z]{3} ?[0-9]{4}$/i },
  DE: { label: 'PLZ', example: '10115', pattern: /^[0-9]{5}$/ },
  FR: { label: 'Code postal', example: '75008', pattern: /^[0-9]{5}$/ },
  ES: { label: 'Código postal', example: '28013', pattern: /^[0-9]{5}$/ },
  IT: { label: 'CAP', example: '00184', pattern: /^[0-9]{5}$/ },
  FI: { label: 'Postinumero', example: '00100', pattern: /^[0-9]{5}$/ },
  GR: { label: 'Postal code', example: '104 31', pattern: /^[0-9]{3} ?[0-9]{2}$/ },
  HR: { label: 'Poštanski broj', example: '10000', pattern: /^[0-9]{5}$/ },
  EE: { label: 'Sihtnumber', example: '10111', pattern: /^[0-9]{5}$/ },
  LT: { label: 'Pašto kodas', example: '01100', pattern: /^(?:LT-)?[0-9]{5}$/i },
  LV: { label: 'Pasta indekss', example: 'LV-1050', pattern: /^(?:LV-)?[0-9]{4}$/i },
  SK: { label: 'PSČ', example: '811 01', pattern: /^[0-9]{3} ?[0-9]{2}$/ },
  CZ: { label: 'PSČ', example: '110 00', pattern: /^[0-9]{3} ?[0-9]{2}$/ },
  AT: { label: 'PLZ', example: '1010', pattern: /^[0-9]{4}$/ },
  BE: { label: 'Code postal', example: '1000', pattern: /^[0-9]{4}$/ },
  DK: { label: 'Postnummer', example: '1050', pattern: /^[0-9]{4}$/ },
  NO: { label: 'Postnummer', example: '0155', pattern: /^[0-9]{4}$/ },
  CH: { label: 'PLZ', example: '8001', pattern: /^[0-9]{4}$/ },
  LU: { label: 'Code postal', example: '1009', pattern: /^(?:L-)?[0-9]{4}$/i },
  BG: { label: 'Пощенски код', example: '1000', pattern: /^[0-9]{4}$/ },
  HU: { label: 'Irányítószám', example: '1051', pattern: /^[0-9]{4}$/ },
  SI: { label: 'Poštna številka', example: '1000', pattern: /^[0-9]{4}$/ },
  CY: { label: 'Postal code', example: '1010', pattern: /^[0-9]{4}$/ },
  RO: { label: 'Cod poștal', example: '010011', pattern: /^[0-9]{6}$/ },
  LI: { label: 'PLZ', example: '9490', pattern: /^[0-9]{4}$/ },
  IS: { label: 'Póstnúmer', example: '101', pattern: /^[0-9]{3}$/ },
};

const FALLBACK_POSTAL_RULE = {
  label: 'Postal code', example: '', pattern: /^[A-Z0-9][A-Z0-9 -]{1,8}[A-Z0-9]$/i,
};

const postalRuleFor = countryName => {
  const c = countryByName(countryName);
  return (c && POSTAL_RULES[c.code]) || FALLBACK_POSTAL_RULE;
};

const usesCountyDropdown = countryName => countryByName(countryName)?.code === 'IE';

const tidy = v => String(v ?? '').replace(/\s+/g, ' ').trim();
const digitsOf = v => String(v ?? '').replace(/[^0-9]/g, '');
const hasLetter = v => /\p{L}/u.test(v);

const isRepeatedChar = value => {
  const compact = value.replace(/[\s.,'’-]/g, '');
  return compact.length >= 3 && new Set(compact.toLowerCase()).size === 1;
};

const stripTrunk = (digits, country) => {
  const p = country.trunkPrefix;
  return p && digits.length > p.length && digits.startsWith(p) ? digits.slice(p.length) : digits;
};

// Name rules, shared by the parcel recipient and the account holder — same
// substance, different copy. See the frontend twin for the reasoning.
const RECIPIENT_NAME_COPY = {
  missing: "Enter the recipient's full name.",
  invalid: "Enter the recipient's real name, as it should appear on the parcel.",
  long: `Keep the name under ${MAX_LENGTHS.full_name} characters.`,
};

const ACCOUNT_NAME_COPY = {
  missing: 'Enter your full name.',
  invalid: 'Enter your real name — it goes on your orders and on your parcels.',
  long: `Keep the name under ${MAX_LENGTHS.full_name} characters.`,
};

// Judges the tidied value, so what's checked is exactly what would be stored.
function nameError(raw, copy = RECIPIENT_NAME_COPY) {
  const name = tidy(raw);
  if (!name) return copy.missing;
  if (name.length < 2 || !hasLetter(name) || isRepeatedChar(name)) return copy.invalid;
  if (name.length > MAX_LENGTHS.full_name) return copy.long;
  return undefined;
}

const formatEircode = value => {
  const cleaned = String(value ?? '').replace(/\s+/g, '').toUpperCase();
  return /^(?:[AC-FHKNPRTV-Y][0-9]{2}|D6W)[0-9AC-FHKNPRTV-Y]{4}$/.test(cleaned)
    ? `${cleaned.slice(0, 3)} ${cleaned.slice(3)}`
    : String(value ?? '').trim();
};

// Only the D routing keys are unambiguously Dublin; see the note on the frontend
// twin for why the reverse implication is deliberately not asserted.
const countyFromEircode = postalCode => {
  const key = String(postalCode ?? '').replace(/\s+/g, '').toUpperCase().slice(0, 3);
  return /^D(?:[0-9]{2}|6W)$/.test(key) ? 'Dublin' : undefined;
};

// Store one dialable string. A legacy bare number is read against the address's
// country; anything already in E.164 keeps its own code.
function toE164(stored, countryName) {
  const fallback = countryByName(countryName) || DEFAULT_COUNTRY;
  const raw = String(stored ?? '').trim();
  if (raw.startsWith('+')) {
    const match = BY_DIAL_LENGTH.find(c => raw.startsWith(c.dialCode));
    if (match) {
      const nsn = digitsOf(raw.slice(match.dialCode.length));
      return nsn ? `${match.dialCode}${nsn}` : '';
    }
    const nsn = digitsOf(raw);
    return nsn ? `${fallback.dialCode}${nsn}` : '';
  }
  const nsn = stripTrunk(digitsOf(raw), fallback);
  return nsn ? `${fallback.dialCode}${nsn}` : '';
}

function phoneError(stored) {
  const raw = String(stored ?? '').trim();
  if (!raw) return 'Enter a mobile number the courier can reach.';
  if (!raw.startsWith('+')) return 'Choose a country code for the phone number.';
  const country = BY_DIAL_LENGTH.find(c => raw.startsWith(c.dialCode));
  if (!country) return 'Choose a country code for the phone number.';
  const nsn = digitsOf(raw.slice(country.dialCode.length));
  if (!nsn) return 'Enter a mobile number the courier can reach.';
  if (nsn.startsWith('0'))
    return `Drop the leading 0 — ${country.name} numbers are stored without it (e.g. ${country.phoneExample}).`;
  if (nsn.length < country.nsnMin || nsn.length > country.nsnMax) {
    const len = country.nsnMin === country.nsnMax ? `${country.nsnMin}` : `${country.nsnMin}–${country.nsnMax}`;
    return `That isn't a valid ${country.name} number. Expected ${len} digits after ${country.dialCode} (e.g. ${country.phoneExample}).`;
  }
  return undefined;
}

// The exact shape that gets written to the database.
function normalizeAddress(a) {
  const country = tidy(a && a.country);
  const postal = tidy(a && a.postal_code);
  return {
    full_name: tidy(a && a.full_name),
    phone: toE164(a && a.phone, country),
    address_line1: tidy(a && a.address_line1),
    address_line2: tidy(a && a.address_line2),
    city: tidy(a && a.city),
    state: tidy(a && a.state),
    postal_code: usesCountyDropdown(country) ? formatEircode(postal) : postal.toUpperCase(),
    country,
  };
}

// Returns the first problem with a normalized address, or null when it's
// dispatchable. Field order matches the form so the message the shopper sees on
// a rejected API call is the one their first broken field would have shown.
function validateAddress(a) {
  const addr = normalizeAddress(a);

  const nameProblem = nameError(addr.full_name);
  if (nameProblem) return nameProblem;

  const phoneProblem = phoneError(addr.phone);
  if (phoneProblem) return phoneProblem;

  if (!addr.address_line1) return 'Enter your street address.';
  if (!hasLetter(addr.address_line1) || addr.address_line1.length < 4 || isRepeatedChar(addr.address_line1))
    return 'Include the street name, e.g. 12 Beacon Court.';
  if (addr.address_line1.length > MAX_LENGTHS.address_line1)
    return `Keep line 1 under ${MAX_LENGTHS.address_line1} characters.`;

  if (addr.address_line2 && (!hasLetter(addr.address_line2) || isRepeatedChar(addr.address_line2)))
    return 'Use line 2 for an apartment, estate or townland — or leave it empty.';
  if (addr.address_line2.length > MAX_LENGTHS.address_line2)
    return `Keep line 2 under ${MAX_LENGTHS.address_line2} characters.`;

  if (!addr.country) return 'Select a country.';
  if (!countryByName(addr.country)) return 'Select a country we ship to from the list.';

  if (!addr.city) return 'Enter your city or town.';
  if (addr.city.length < 2 || !hasLetter(addr.city) || isRepeatedChar(addr.city))
    return 'Enter the full name of your city or town.';
  if (addr.city.length > MAX_LENGTHS.city) return `Keep the city under ${MAX_LENGTHS.city} characters.`;

  if (usesCountyDropdown(addr.country)) {
    if (!addr.state) return 'Select your county.';
    if (!IRISH_COUNTIES.includes(addr.state)) return 'Select your county from the list.';
  } else if (addr.state.length > MAX_LENGTHS.state) {
    return `Keep the region under ${MAX_LENGTHS.state} characters.`;
  }

  const rule = postalRuleFor(addr.country);
  if (!addr.postal_code) return `Enter your ${rule.label.toLowerCase()}.`;
  if (!rule.pattern.test(addr.postal_code)) {
    return rule.example
      ? `Enter a valid ${rule.label} (e.g. ${rule.example}).`
      : `Enter a valid ${rule.label}.`;
  }
  const implied = usesCountyDropdown(addr.country) ? countyFromEircode(addr.postal_code) : undefined;
  if (implied && addr.state && implied !== addr.state)
    return `That Eircode is in County ${implied}, not ${addr.state}. Check the county and the Eircode.`;

  return null;
}

// One-line rendering for emails and admin lists; the courier-order block for
// picking slips. Both take an already-normalized (or raw) address.
function formatAddressBlock(a) {
  const addr = normalizeAddress(a);
  return [
    addr.full_name,
    addr.address_line1,
    addr.address_line2,
    addr.city,
    usesCountyDropdown(addr.country) && addr.state ? `Co. ${addr.state}` : addr.state,
    addr.postal_code,
    addr.country,
  ].filter(Boolean);
}

const formatAddressOneLine = a => formatAddressBlock(a).slice(1).join(', ');

export {
  COUNTRIES, IRISH_COUNTIES, MAX_LENGTHS,
  RECIPIENT_NAME_COPY, ACCOUNT_NAME_COPY,
  countryByName, usesCountyDropdown, postalRuleFor, countyFromEircode, formatEircode,
  tidy, nameError, toE164, phoneError, normalizeAddress, validateAddress,
  formatAddressBlock, formatAddressOneLine,
};
