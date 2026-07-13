import { type ReactNode } from "react";
import {
  COUNTRIES, IRISH_COUNTIES, usesCountyDropdown, postalRuleFor, formatEircode,
  type AddressErrors, type AddressField,
} from "@/lib/addressValidation";
import type { DeliveryAddress } from "@/lib/userApi";

// The delivery-address form, shared verbatim by checkout and the account address
// book so both enforce identical validation UX: country dropdown, Irish county
// dropdown, per-country postal-code labels/rules, Eircode tidy-up, and inline
// per-field errors. Validation itself lives in lib/addressValidation; this only
// renders it. The parent owns `value`/`errors`/`touched` and the change handlers.

const inputStyle = { border: "1px solid #ccc", background: "#fff", color: "#111" } as const;

// Red border when a field has a surfaced error, the shared input look otherwise.
const errStyle = (error?: string) =>
  error ? { ...inputStyle, border: "1px solid #C7511F" } : inputStyle;

// Wraps a control so its validation message sits directly beneath it.
const Field = ({ error, children }: { error?: string; children: ReactNode }) => (
  <div>
    {children}
    {error && <p className="font-sans text-xs mt-1" style={{ color: "#C7511F" }}>{error}</p>}
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
  // Show a field's error once the shopper has left it, or after the parent marks
  // every field touched on a submit attempt — never on a pristine, untouched field.
  const fieldError = (f: AddressField): string | undefined => (touched[f] ? errors[f] : undefined);
  const setField = (f: AddressField, v: string) => onChange({ ...value, [f]: v });
  const postalRule = postalRuleFor(value.country);

  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field error={fieldError("full_name")}>
          <input placeholder="Full name" value={value.full_name ?? ""} autoComplete="name"
            onChange={e => setField("full_name", e.target.value)} onBlur={() => onTouch("full_name")}
            className="w-full px-3 py-2 rounded-lg font-sans text-sm outline-none" style={errStyle(fieldError("full_name"))} />
        </Field>
        <Field error={fieldError("phone")}>
          <input placeholder="Phone" value={value.phone ?? ""} inputMode="tel" autoComplete="tel"
            onChange={e => setField("phone", e.target.value)} onBlur={() => onTouch("phone")}
            className="w-full px-3 py-2 rounded-lg font-sans text-sm outline-none" style={errStyle(fieldError("phone"))} />
        </Field>
      </div>
      <Field error={fieldError("address_line1")}>
        <input placeholder="Address line 1" value={value.address_line1 ?? ""} autoComplete="address-line1"
          onChange={e => setField("address_line1", e.target.value)} onBlur={() => onTouch("address_line1")}
          className="w-full px-3 py-2 rounded-lg font-sans text-sm outline-none" style={errStyle(fieldError("address_line1"))} />
      </Field>
      <input placeholder="Address line 2 (optional)" value={value.address_line2 ?? ""} autoComplete="address-line2"
        onChange={e => onChange({ ...value, address_line2: e.target.value })}
        className="w-full px-3 py-2 rounded-lg font-sans text-sm outline-none" style={inputStyle} />
      {/* Country first: it drives the region field and the postal-code rules below it. */}
      <Field error={fieldError("country")}>
        <select value={value.country ?? ""} autoComplete="country-name"
          onChange={e => onChange({
            ...value,
            country: e.target.value,
            // Reset the region only when switching between county-dropdown and free-text modes.
            state: usesCountyDropdown(e.target.value) === usesCountyDropdown(value.country) ? value.state : "",
          })}
          onBlur={() => onTouch("country")}
          className="w-full px-3 py-2 rounded-lg font-sans text-sm outline-none"
          style={{ ...errStyle(fieldError("country")), color: value.country ? "#111" : "#888" }}>
          <option value="">Select country…</option>
          {COUNTRIES.map(c => <option key={c.code} value={c.name} style={{ color: "#111" }}>{c.name}</option>)}
        </select>
      </Field>
      <div className="grid sm:grid-cols-3 gap-3">
        <Field error={fieldError("city")}>
          <input placeholder="City" value={value.city ?? ""} autoComplete="address-level2"
            onChange={e => setField("city", e.target.value)} onBlur={() => onTouch("city")}
            className="w-full px-3 py-2 rounded-lg font-sans text-sm outline-none" style={errStyle(fieldError("city"))} />
        </Field>
        <Field error={fieldError("state")}>
          {usesCountyDropdown(value.country) ? (
            <select value={value.state ?? ""} autoComplete="address-level1"
              onChange={e => setField("state", e.target.value)} onBlur={() => onTouch("state")}
              className="w-full px-3 py-2 rounded-lg font-sans text-sm outline-none"
              style={{ ...errStyle(fieldError("state")), color: value.state ? "#111" : "#888" }}>
              <option value="">County (optional)</option>
              {IRISH_COUNTIES.map(c => <option key={c} value={c} style={{ color: "#111" }}>{c}</option>)}
            </select>
          ) : (
            <input placeholder="State / Region (optional)" value={value.state ?? ""} autoComplete="address-level1"
              onChange={e => setField("state", e.target.value)}
              className="w-full px-3 py-2 rounded-lg font-sans text-sm outline-none" style={inputStyle} />
          )}
        </Field>
        <Field error={fieldError("postal_code")}>
          <input placeholder={postalRule.label} value={value.postal_code ?? ""} autoComplete="postal-code"
            onChange={e => setField("postal_code", e.target.value)}
            onBlur={() => {
              onTouch("postal_code");
              // Tidy a valid Eircode into its canonical "D18 K7W2" form.
              if (usesCountyDropdown(value.country) && value.postal_code)
                setField("postal_code", formatEircode(value.postal_code));
            }}
            className="w-full px-3 py-2 rounded-lg font-sans text-sm outline-none uppercase" style={errStyle(fieldError("postal_code"))} />
        </Field>
      </div>
    </div>
  );
};

export default AddressFields;
