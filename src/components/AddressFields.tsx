import { useId, type ReactNode } from "react";
import {
  COUNTRIES, IRISH_COUNTIES, MAX_LENGTHS, usesCountyDropdown, postalRuleFor,
  formatEircode, countyFromEircode,
  type AddressErrors, type AddressField,
} from "@/lib/addressValidation";
import PhoneInput from "@/components/PhoneInput";
import type { DeliveryAddress } from "@/lib/userApi";

// The delivery-address form, shared verbatim by checkout and the account address
// book so both enforce identical validation UX: every field labelled (not just
// placeholder-hinted — a filled-in form has to stay readable), a dial-code
// dropdown that stores one E.164 number, a country dropdown that drives the
// county and postal-code rules below it, and inline per-field errors.
// Validation itself lives in lib/addressValidation; this only renders it. The
// parent owns `value`/`errors`/`touched` and the change handlers.

const inputStyle = { border: "1px solid #ccc", background: "#fff", color: "#111" } as const;
const inputClass = "w-full px-3 py-2 rounded-lg font-sans text-sm outline-none";

// Red border when a field has a surfaced error, the shared input look otherwise.
const errStyle = (error?: string) =>
  error ? { ...inputStyle, border: "1px solid #C7511F" } : inputStyle;

// A labelled control with its validation message (or a quiet hint) beneath it.
const Field = ({ label, htmlFor, optional, error, hint, children }: {
  label: string;
  htmlFor?: string;
  optional?: boolean;
  error?: string;
  hint?: string;
  children: ReactNode;
}) => (
  <div>
    <label htmlFor={htmlFor} className="font-sans text-xs font-semibold block mb-1" style={{ color: "#555" }}>
      {label}
      {optional && <span className="font-normal" style={{ color: "#888" }}> (optional)</span>}
    </label>
    {children}
    {error
      ? <p className="font-sans text-xs mt-1" style={{ color: "#C7511F" }}>{error}</p>
      : hint && <p className="font-sans text-xs mt-1" style={{ color: "#888" }}>{hint}</p>}
  </div>
);

interface AddressFieldsProps {
  value: DeliveryAddress;
  errors: AddressErrors;
  touched: Partial<Record<AddressField, boolean>>;
  onChange: (next: DeliveryAddress) => void;
  onTouch: (field: AddressField) => void;
}

const AddressFields = ({ value, errors, touched, onChange, onTouch }: AddressFieldsProps) => {
  const id = useId();
  // Show a field's error once the shopper has left it, or after the parent marks
  // every field touched on a submit attempt — never on a pristine, untouched field.
  const fieldError = (f: AddressField): string | undefined => (touched[f] ? errors[f] : undefined);
  const setField = (f: AddressField, v: string) => onChange({ ...value, [f]: v });
  const postalRule = postalRuleFor(value.country);
  const isIreland = usesCountyDropdown(value.country);

  // Switching country flips the region field between the county dropdown and free
  // text; the stale region is dropped so an Irish county can't linger on a German
  // address. (PhoneInput follows the country on its own while the number is empty.)
  const onCountryChange = (nextCountry: string) => {
    const modeChanged = usesCountyDropdown(nextCountry) !== usesCountyDropdown(value.country);
    onChange({ ...value, country: nextCountry, state: modeChanged ? "" : value.state });
  };

  // Eircodes carry their county: filling one in settles the county field for the
  // shopper instead of asking them to agree with it. Only the unambiguous Dublin
  // keys resolve (see countyFromEircode), and only into an empty county.
  const onPostalBlur = () => {
    onTouch("postal_code");
    if (!isIreland || !value.postal_code) return;
    const tidied = formatEircode(value.postal_code);
    const implied = countyFromEircode(tidied);
    onChange({
      ...value,
      postal_code: tidied,
      state: !value.state && implied ? implied : value.state,
    });
  };

  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Recipient's full name" htmlFor={`${id}-name`} error={fieldError("full_name")}>
          <input id={`${id}-name`} placeholder="e.g. Aoife Byrne" value={value.full_name ?? ""}
            autoComplete="name" maxLength={MAX_LENGTHS.full_name}
            onChange={e => setField("full_name", e.target.value)} onBlur={() => onTouch("full_name")}
            className={inputClass} style={errStyle(fieldError("full_name"))} />
        </Field>

        <Field label="Mobile number" htmlFor={`${id}-phone`} error={fieldError("phone")}
          hint="Used only for delivery updates from the courier.">
          <PhoneInput id={`${id}-phone`} value={value.phone} country={value.country}
            error={fieldError("phone")}
            onChange={next => onChange({ ...value, phone: next })} onBlur={() => onTouch("phone")} />
        </Field>
      </div>

      <Field label="Address line 1" htmlFor={`${id}-line1`} error={fieldError("address_line1")}
        hint="House or apartment number and street name.">
        <input id={`${id}-line1`} placeholder="e.g. 12 Beacon Court" value={value.address_line1 ?? ""}
          autoComplete="address-line1" maxLength={MAX_LENGTHS.address_line1}
          onChange={e => setField("address_line1", e.target.value)} onBlur={() => onTouch("address_line1")}
          className={inputClass} style={errStyle(fieldError("address_line1"))} />
      </Field>

      <Field label="Address line 2" htmlFor={`${id}-line2`} optional error={fieldError("address_line2")}>
        <input id={`${id}-line2`} placeholder="Apartment, estate or townland" value={value.address_line2 ?? ""}
          autoComplete="address-line2" maxLength={MAX_LENGTHS.address_line2}
          onChange={e => setField("address_line2", e.target.value)} onBlur={() => onTouch("address_line2")}
          className={inputClass} style={errStyle(fieldError("address_line2"))} />
      </Field>

      {/* Country first: it drives the region field and the postal-code rules below it. */}
      <Field label="Country" htmlFor={`${id}-country`} error={fieldError("country")}>
        <select id={`${id}-country`} value={value.country ?? ""} autoComplete="country-name"
          onChange={e => onCountryChange(e.target.value)} onBlur={() => onTouch("country")}
          className={inputClass}
          style={{ ...errStyle(fieldError("country")), color: value.country ? "#111" : "#888" }}>
          <option value="">Select country…</option>
          {COUNTRIES.map(c => <option key={c.code} value={c.name} style={{ color: "#111" }}>{c.name}</option>)}
        </select>
      </Field>

      <div className="grid sm:grid-cols-3 gap-3">
        <Field label="City or town" htmlFor={`${id}-city`} error={fieldError("city")}>
          <input id={`${id}-city`} placeholder="e.g. Sandyford" value={value.city ?? ""}
            autoComplete="address-level2" maxLength={MAX_LENGTHS.city}
            onChange={e => setField("city", e.target.value)} onBlur={() => onTouch("city")}
            className={inputClass} style={errStyle(fieldError("city"))} />
        </Field>

        <Field label={isIreland ? "County" : "State / Region"} htmlFor={`${id}-state`}
          optional={!isIreland} error={fieldError("state")}>
          {isIreland ? (
            <select id={`${id}-state`} value={value.state ?? ""} autoComplete="address-level1"
              onChange={e => setField("state", e.target.value)} onBlur={() => onTouch("state")}
              className={inputClass}
              style={{ ...errStyle(fieldError("state")), color: value.state ? "#111" : "#888" }}>
              <option value="">Select county…</option>
              {IRISH_COUNTIES.map(c => <option key={c} value={c} style={{ color: "#111" }}>{c}</option>)}
            </select>
          ) : (
            <input id={`${id}-state`} placeholder="Region" value={value.state ?? ""}
              autoComplete="address-level1" maxLength={MAX_LENGTHS.state}
              onChange={e => setField("state", e.target.value)} onBlur={() => onTouch("state")}
              className={inputClass} style={errStyle(fieldError("state"))} />
          )}
        </Field>

        <Field label={postalRule.label} htmlFor={`${id}-postal`} error={fieldError("postal_code")}>
          {/* Uppercased on the way in rather than with a CSS `uppercase` class:
              that transform also hits the placeholder, which turned the hint into
              a shouted "POSTAL CODE" before a country was chosen. */}
          <input id={`${id}-postal`} placeholder={postalRule.example || postalRule.label}
            value={value.postal_code ?? ""} autoComplete="postal-code" maxLength={MAX_LENGTHS.postal_code}
            onChange={e => setField("postal_code", e.target.value.toUpperCase())} onBlur={onPostalBlur}
            className={inputClass} style={errStyle(fieldError("postal_code"))} />
        </Field>
      </div>
    </div>
  );
};

export default AddressFields;
