// src/lib/orderCustomer.ts
//
// The buyer's delivery details, and what counts as having enough of them.
//
// Shopify will not release a buyer's name, phone, street or PIN to this app on
// a plan below Grow - only the city, state and country arrive. The admin
// therefore copies the rest across from the Shopify order when planning the
// pickup, and that becomes the record everything downstream reads: the parcel
// is addressed from it, and the tax invoice bills to it.
//
// Because the invoice depends on these fields, it cannot be issued until they
// are present. Both panels import from here so they agree on exactly when that
// is, rather than each deciding for itself.

export type CustomerAddress = {
  name?: string;
  address1?: string;
  address2?: string;
  city?: string;
  /** State or union territory. Named for the Shopify field it mirrors. */
  province?: string;
  zip?: string;
  country?: string;
  phone?: string;
};

export type CustomerAddressField =
  | "name"
  | "address1"
  | "city"
  | "province"
  | "zip"
  | "phone";

/**
 * The fields a GST invoice and a courier both need.
 *
 * `province` is here because it decides the place of supply, and therefore
 * whether the order is taxed as CGST + SGST or IGST. `address2` and `country`
 * are deliberately absent: a flat number is often part of address1, and the
 * country is India unless stated.
 */
export const REQUIRED_CUSTOMER_FIELDS: Array<{
  key: CustomerAddressField;
  label: string;
}> = [
  // Lower case so the labels read correctly mid-sentence; PIN stays an
  // initialism. Form field labels are written separately.
  { key: "name", label: "full name" },
  { key: "address1", label: "address" },
  { key: "city", label: "city" },
  { key: "province", label: "state" },
  { key: "zip", label: "PIN code" },
  { key: "phone", label: "phone" },
];

const text = (value: unknown) => String(value ?? "").trim();

export function missingCustomerFields(
  address: CustomerAddress | null | undefined,
): string[] {
  return REQUIRED_CUSTOMER_FIELDS.filter(
    (field) => !text(address?.[field.key]),
  ).map((field) => field.label);
}

/** True once the order can be both delivered and invoiced. */
export function customerDetailsComplete(
  address: CustomerAddress | null | undefined,
): boolean {
  return missingCustomerFields(address).length === 0;
}

/** A readable block for the pickup form, the order view and the parcel. */
export function formatCustomerAddress(
  address: CustomerAddress | null | undefined,
): string {
  if (!address) return "";
  const cityLine = [address.city, address.province, address.zip]
    .map(text)
    .filter(Boolean)
    .join(", ");
  return [
    text(address.name),
    text(address.address1),
    text(address.address2),
    cityLine,
    text(address.country) || "India",
    text(address.phone) ? `Phone: ${text(address.phone)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Normalises whatever the form produced before it is saved. */
export function normalizeCustomerAddress(
  address: CustomerAddress | null | undefined,
): CustomerAddress {
  return {
    name: text(address?.name),
    address1: text(address?.address1),
    address2: text(address?.address2),
    city: text(address?.city),
    province: text(address?.province),
    zip: text(address?.zip),
    country: text(address?.country) || "India",
    phone: text(address?.phone),
  };
}

/** The 36 states and union territories, for the invoice's place of supply. */
export const INDIAN_STATES = [
  "Andaman and Nicobar Islands",
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chandigarh",
  "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jammu and Kashmir",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Ladakh",
  "Lakshadweep",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Puducherry",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
];
