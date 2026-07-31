import { useEffect, useRef, useState } from "react";
import {
  DIAL_OPTIONS, COUNTRIES, splitPhone, composePhone, countryByName, parseInternational,
} from "@/lib/addressValidation";

// A dial-code dropdown plus a national-number box over a single stored E.164
// string ("+353871234567"). Shared by the delivery-address form and the pickup
// contact field so a phone number can only be entered one way on the site, and
// so ops always receives a number that can be dialled without guesswork.
//
// The split lives in local state on purpose: composePhone stores "" until there
// are digits to attach a code to, so a dial code picked before typing would be
// lost on the next render if it were derived from the stored value. `lastSent`
// tells our own echo apart from a genuinely external change (a saved address
// being selected, or the parent resetting the form).

const inputStyle = { border: "1px solid #ccc", background: "#fff", color: "#111" } as const;
const inputClass = "w-full px-3 py-2 rounded-lg font-sans text-sm outline-none";

interface PhoneInputProps {
  value?: string;
  /** Address country, used only to read legacy numbers stored without a + code. */
  country?: string;
  error?: string;
  id?: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
}

const PhoneInput = ({ value, country, error, id, onChange, onBlur }: PhoneInputProps) => {
  const [parts, setParts] = useState(() => splitPhone(value, country));
  const lastSent = useRef(value ?? "");

  useEffect(() => {
    const incoming = value ?? "";
    if (incoming === lastSent.current) return;
    lastSent.current = incoming;
    setParts(splitPhone(incoming, country));
  }, [value]);

  // Follow the address country while the number is still empty — a shopper
  // shipping to Germany almost certainly wants +49. Once digits are typed the
  // code is left alone: an Irish address with a UK mobile is a normal gift order.
  useEffect(() => {
    const dial = countryByName(country)?.dialCode;
    if (!dial || parts.national || dial === parts.dialCode) return;
    setParts({ dialCode: dial, national: "" });
  }, [country]);

  const update = (next: { dialCode: string; national: string }) => {
    // Someone pasting the number off their own contact card types the country
    // code too. Adopt it rather than stacking it on the dropdown's code and
    // producing "+353353…" — the classic undialable result of a split field.
    const resolved = parseInternational(next.national) ?? next;
    setParts(resolved);
    const composed = composePhone(resolved.dialCode, resolved.national);
    lastSent.current = composed;
    onChange(composed);
  };

  const style = error ? { ...inputStyle, border: "1px solid #C7511F" } : inputStyle;
  const dialCountry = COUNTRIES.find(c => c.dialCode === parts.dialCode);

  return (
    <div className="flex gap-2">
      <select aria-label="Phone country code" value={parts.dialCode}
        onChange={e => update({ ...parts, dialCode: e.target.value })} onBlur={onBlur}
        className="shrink-0 px-2 py-2 rounded-lg font-sans text-sm outline-none"
        style={{ ...style, width: "6.5rem" }}>
        {DIAL_OPTIONS.map(c => <option key={c.code} value={c.dialCode}>{c.code} {c.dialCode}</option>)}
      </select>
      <input id={id} placeholder={dialCountry?.phoneExample ?? "87 123 4567"} value={parts.national}
        inputMode="tel" autoComplete="tel-national" maxLength={16}
        onChange={e => update({ ...parts, national: e.target.value })} onBlur={onBlur}
        className={`${inputClass} flex-1 min-w-0`} style={style} />
    </div>
  );
};

export default PhoneInput;
