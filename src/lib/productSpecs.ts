// src/lib/productSpecs.ts
// Shared model for the mandatory Product Specifications block: fabric
// composition, manufacturing batch month, and country of origin.

export type MaterialComponent = {
  material: string;
  percentage: number | null;
};

export type ProductSpecifications = {
  /** Structured rows, e.g. [{ material: "Cotton", percentage: 80 }, ...] */
  materialComposition: MaterialComponent[];
  /** Flattened for display and for the Shopify metafield: "80% Cotton, 20% Polyester" */
  materialCompositionText: string;
  /** Manufacturing batch month as "YYYY-MM" so it sorts correctly */
  manufactureMonth: string;
  /** Display form of the same month, e.g. "March 2026" */
  manufactureMonthLabel: string;
  /** Country name, e.g. "India" */
  countryOfOrigin: string;
  /** ISO 3166-1 alpha-2, e.g. "IN" - kept so Shopify can sort and filter by origin */
  countryOfOriginCode: string;
};

export type CountryOption = { code: string; name: string };

/** Origins that cover most apparel sourcing, surfaced first in the picker. */
export const COMMON_ORIGIN_CODES = [
  "IN",
  "BD",
  "CN",
  "VN",
  "TR",
  "LK",
  "ID",
  "KH",
  "PK",
] as const;

export const COUNTRIES: readonly CountryOption[] = [
  { code: "AD", name: "Andorra" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "AF", name: "Afghanistan" },
  { code: "AG", name: "Antigua & Barbuda" },
  { code: "AI", name: "Anguilla" },
  { code: "AL", name: "Albania" },
  { code: "AM", name: "Armenia" },
  { code: "AN", name: "Cura\u00e7ao" },
  { code: "AO", name: "Angola" },
  { code: "AQ", name: "Antarctica" },
  { code: "AR", name: "Argentina" },
  { code: "AS", name: "American Samoa" },
  { code: "AT", name: "Austria" },
  { code: "AU", name: "Australia" },
  { code: "AW", name: "Aruba" },
  { code: "AX", name: "\u00c5land Islands" },
  { code: "AZ", name: "Azerbaijan" },
  { code: "BA", name: "Bosnia & Herzegovina" },
  { code: "BB", name: "Barbados" },
  { code: "BD", name: "Bangladesh" },
  { code: "BE", name: "Belgium" },
  { code: "BF", name: "Burkina Faso" },
  { code: "BG", name: "Bulgaria" },
  { code: "BH", name: "Bahrain" },
  { code: "BI", name: "Burundi" },
  { code: "BJ", name: "Benin" },
  { code: "BL", name: "St. Barth\u00e9lemy" },
  { code: "BM", name: "Bermuda" },
  { code: "BN", name: "Brunei" },
  { code: "BO", name: "Bolivia" },
  { code: "BQ", name: "Caribbean Netherlands" },
  { code: "BR", name: "Brazil" },
  { code: "BS", name: "Bahamas" },
  { code: "BT", name: "Bhutan" },
  { code: "BU", name: "Myanmar (Burma)" },
  { code: "BV", name: "Bouvet Island" },
  { code: "BW", name: "Botswana" },
  { code: "BY", name: "Belarus" },
  { code: "BZ", name: "Belize" },
  { code: "CA", name: "Canada" },
  { code: "CC", name: "Cocos (Keeling) Islands" },
  { code: "CD", name: "Congo - Kinshasa" },
  { code: "CF", name: "Central African Republic" },
  { code: "CG", name: "Congo - Brazzaville" },
  { code: "CH", name: "Switzerland" },
  { code: "CI", name: "C\u00f4te d\u2019Ivoire" },
  { code: "CK", name: "Cook Islands" },
  { code: "CL", name: "Chile" },
  { code: "CM", name: "Cameroon" },
  { code: "CN", name: "China" },
  { code: "CO", name: "Colombia" },
  { code: "CR", name: "Costa Rica" },
  { code: "CS", name: "Serbia" },
  { code: "CU", name: "Cuba" },
  { code: "CV", name: "Cape Verde" },
  { code: "CW", name: "Cura\u00e7ao" },
  { code: "CX", name: "Christmas Island" },
  { code: "CY", name: "Cyprus" },
  { code: "CZ", name: "Czechia" },
  { code: "DD", name: "Germany" },
  { code: "DE", name: "Germany" },
  { code: "DJ", name: "Djibouti" },
  { code: "DK", name: "Denmark" },
  { code: "DM", name: "Dominica" },
  { code: "DO", name: "Dominican Republic" },
  { code: "DY", name: "Benin" },
  { code: "DZ", name: "Algeria" },
  { code: "EC", name: "Ecuador" },
  { code: "EE", name: "Estonia" },
  { code: "EG", name: "Egypt" },
  { code: "EH", name: "Western Sahara" },
  { code: "ER", name: "Eritrea" },
  { code: "ES", name: "Spain" },
  { code: "ET", name: "Ethiopia" },
  { code: "FI", name: "Finland" },
  { code: "FJ", name: "Fiji" },
  { code: "FK", name: "Falkland Islands" },
  { code: "FM", name: "Micronesia" },
  { code: "FO", name: "Faroe Islands" },
  { code: "FR", name: "France" },
  { code: "FX", name: "France" },
  { code: "GA", name: "Gabon" },
  { code: "GB", name: "United Kingdom" },
  { code: "GD", name: "Grenada" },
  { code: "GE", name: "Georgia" },
  { code: "GF", name: "French Guiana" },
  { code: "GG", name: "Guernsey" },
  { code: "GH", name: "Ghana" },
  { code: "GI", name: "Gibraltar" },
  { code: "GL", name: "Greenland" },
  { code: "GM", name: "Gambia" },
  { code: "GN", name: "Guinea" },
  { code: "GP", name: "Guadeloupe" },
  { code: "GQ", name: "Equatorial Guinea" },
  { code: "GR", name: "Greece" },
  { code: "GS", name: "South Georgia & South Sandwich Islands" },
  { code: "GT", name: "Guatemala" },
  { code: "GU", name: "Guam" },
  { code: "GW", name: "Guinea-Bissau" },
  { code: "GY", name: "Guyana" },
  { code: "HK", name: "Hong Kong SAR China" },
  { code: "HM", name: "Heard & McDonald Islands" },
  { code: "HN", name: "Honduras" },
  { code: "HR", name: "Croatia" },
  { code: "HT", name: "Haiti" },
  { code: "HU", name: "Hungary" },
  { code: "HV", name: "Burkina Faso" },
  { code: "ID", name: "Indonesia" },
  { code: "IE", name: "Ireland" },
  { code: "IL", name: "Israel" },
  { code: "IM", name: "Isle of Man" },
  { code: "IN", name: "India" },
  { code: "IO", name: "British Indian Ocean Territory" },
  { code: "IQ", name: "Iraq" },
  { code: "IR", name: "Iran" },
  { code: "IS", name: "Iceland" },
  { code: "IT", name: "Italy" },
  { code: "JE", name: "Jersey" },
  { code: "JM", name: "Jamaica" },
  { code: "JO", name: "Jordan" },
  { code: "JP", name: "Japan" },
  { code: "KE", name: "Kenya" },
  { code: "KG", name: "Kyrgyzstan" },
  { code: "KH", name: "Cambodia" },
  { code: "KI", name: "Kiribati" },
  { code: "KM", name: "Comoros" },
  { code: "KN", name: "St. Kitts & Nevis" },
  { code: "KP", name: "North Korea" },
  { code: "KR", name: "South Korea" },
  { code: "KW", name: "Kuwait" },
  { code: "KY", name: "Cayman Islands" },
  { code: "KZ", name: "Kazakhstan" },
  { code: "LA", name: "Laos" },
  { code: "LB", name: "Lebanon" },
  { code: "LC", name: "St. Lucia" },
  { code: "LI", name: "Liechtenstein" },
  { code: "LK", name: "Sri Lanka" },
  { code: "LR", name: "Liberia" },
  { code: "LS", name: "Lesotho" },
  { code: "LT", name: "Lithuania" },
  { code: "LU", name: "Luxembourg" },
  { code: "LV", name: "Latvia" },
  { code: "LY", name: "Libya" },
  { code: "MA", name: "Morocco" },
  { code: "MC", name: "Monaco" },
  { code: "MD", name: "Moldova" },
  { code: "ME", name: "Montenegro" },
  { code: "MF", name: "St. Martin" },
  { code: "MG", name: "Madagascar" },
  { code: "MH", name: "Marshall Islands" },
  { code: "MK", name: "North Macedonia" },
  { code: "ML", name: "Mali" },
  { code: "MM", name: "Myanmar (Burma)" },
  { code: "MN", name: "Mongolia" },
  { code: "MO", name: "Macao SAR China" },
  { code: "MP", name: "Northern Mariana Islands" },
  { code: "MQ", name: "Martinique" },
  { code: "MR", name: "Mauritania" },
  { code: "MS", name: "Montserrat" },
  { code: "MT", name: "Malta" },
  { code: "MU", name: "Mauritius" },
  { code: "MV", name: "Maldives" },
  { code: "MW", name: "Malawi" },
  { code: "MX", name: "Mexico" },
  { code: "MY", name: "Malaysia" },
  { code: "MZ", name: "Mozambique" },
  { code: "NA", name: "Namibia" },
  { code: "NC", name: "New Caledonia" },
  { code: "NE", name: "Niger" },
  { code: "NF", name: "Norfolk Island" },
  { code: "NG", name: "Nigeria" },
  { code: "NH", name: "Vanuatu" },
  { code: "NI", name: "Nicaragua" },
  { code: "NL", name: "Netherlands" },
  { code: "NO", name: "Norway" },
  { code: "NP", name: "Nepal" },
  { code: "NR", name: "Nauru" },
  { code: "NU", name: "Niue" },
  { code: "NZ", name: "New Zealand" },
  { code: "OM", name: "Oman" },
  { code: "PA", name: "Panama" },
  { code: "PE", name: "Peru" },
  { code: "PF", name: "French Polynesia" },
  { code: "PG", name: "Papua New Guinea" },
  { code: "PH", name: "Philippines" },
  { code: "PK", name: "Pakistan" },
  { code: "PL", name: "Poland" },
  { code: "PM", name: "St. Pierre & Miquelon" },
  { code: "PN", name: "Pitcairn Islands" },
  { code: "PR", name: "Puerto Rico" },
  { code: "PS", name: "Palestinian Territories" },
  { code: "PT", name: "Portugal" },
  { code: "PW", name: "Palau" },
  { code: "PY", name: "Paraguay" },
  { code: "QA", name: "Qatar" },
  { code: "RE", name: "R\u00e9union" },
  { code: "RH", name: "Zimbabwe" },
  { code: "RO", name: "Romania" },
  { code: "RS", name: "Serbia" },
  { code: "RU", name: "Russia" },
  { code: "RW", name: "Rwanda" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "SB", name: "Solomon Islands" },
  { code: "SC", name: "Seychelles" },
  { code: "SD", name: "Sudan" },
  { code: "SE", name: "Sweden" },
  { code: "SG", name: "Singapore" },
  { code: "SH", name: "St. Helena" },
  { code: "SI", name: "Slovenia" },
  { code: "SJ", name: "Svalbard & Jan Mayen" },
  { code: "SK", name: "Slovakia" },
  { code: "SL", name: "Sierra Leone" },
  { code: "SM", name: "San Marino" },
  { code: "SN", name: "Senegal" },
  { code: "SO", name: "Somalia" },
  { code: "SR", name: "Suriname" },
  { code: "SS", name: "South Sudan" },
  { code: "ST", name: "S\u00e3o Tom\u00e9 & Pr\u00edncipe" },
  { code: "SU", name: "Russia" },
  { code: "SV", name: "El Salvador" },
  { code: "SX", name: "Sint Maarten" },
  { code: "SY", name: "Syria" },
  { code: "SZ", name: "Eswatini" },
  { code: "TC", name: "Turks & Caicos Islands" },
  { code: "TD", name: "Chad" },
  { code: "TF", name: "French Southern Territories" },
  { code: "TG", name: "Togo" },
  { code: "TH", name: "Thailand" },
  { code: "TJ", name: "Tajikistan" },
  { code: "TK", name: "Tokelau" },
  { code: "TL", name: "Timor-Leste" },
  { code: "TM", name: "Turkmenistan" },
  { code: "TN", name: "Tunisia" },
  { code: "TO", name: "Tonga" },
  { code: "TP", name: "Timor-Leste" },
  { code: "TR", name: "T\u00fcrkiye" },
  { code: "TT", name: "Trinidad & Tobago" },
  { code: "TV", name: "Tuvalu" },
  { code: "TW", name: "Taiwan" },
  { code: "TZ", name: "Tanzania" },
  { code: "UA", name: "Ukraine" },
  { code: "UG", name: "Uganda" },
  { code: "UK", name: "United Kingdom" },
  { code: "UM", name: "U.S. Outlying Islands" },
  { code: "US", name: "United States" },
  { code: "UY", name: "Uruguay" },
  { code: "UZ", name: "Uzbekistan" },
  { code: "VA", name: "Vatican City" },
  { code: "VC", name: "St. Vincent & Grenadines" },
  { code: "VD", name: "Vietnam" },
  { code: "VE", name: "Venezuela" },
  { code: "VG", name: "British Virgin Islands" },
  { code: "VI", name: "U.S. Virgin Islands" },
  { code: "VN", name: "Vietnam" },
  { code: "VU", name: "Vanuatu" },
  { code: "WF", name: "Wallis & Futuna" },
  { code: "WS", name: "Samoa" },
  { code: "XK", name: "Kosovo" },
  { code: "YD", name: "Yemen" },
  { code: "YE", name: "Yemen" },
  { code: "YT", name: "Mayotte" },
  { code: "YU", name: "Serbia" },
  { code: "ZA", name: "South Africa" },
  { code: "ZM", name: "Zambia" },
  { code: "ZR", name: "Congo - Kinshasa" },
  { code: "ZW", name: "Zimbabwe" },
];

const COUNTRY_BY_NAME = new Map(
  COUNTRIES.map((country) => [country.name.toLowerCase(), country]),
);

export function findCountry(nameOrCode: string): CountryOption | null {
  const needle = String(nameOrCode || "").trim();
  if (!needle) return null;
  return (
    COUNTRY_BY_NAME.get(needle.toLowerCase()) ||
    COUNTRIES.find(
      (country) => country.code.toLowerCase() === needle.toLowerCase(),
    ) ||
    null
  );
}

export function emptyMaterialRow(): MaterialComponent {
  return { material: "", percentage: null };
}

export function emptySpecifications(): ProductSpecifications {
  return {
    materialComposition: [emptyMaterialRow()],
    materialCompositionText: "",
    manufactureMonth: "",
    manufactureMonthLabel: "",
    countryOfOrigin: "",
    countryOfOriginCode: "",
  };
}

/** "80% Cotton, 20% Polyester" */
export function formatComposition(rows: MaterialComponent[]): string {
  return (Array.isArray(rows) ? rows : [])
    .filter(
      (row) =>
        String(row?.material || "").trim() &&
        typeof row?.percentage === "number" &&
        Number.isFinite(row.percentage),
    )
    .map((row) => `${row.percentage}% ${String(row.material).trim()}`)
    .join(", ");
}

export function isValidMonthValue(value: string) {
  const parts = String(value || "").split("-");
  if (parts.length !== 2) return false;
  const [yearPart, monthPart] = parts;
  if (yearPart.length !== 4 || monthPart.length !== 2) return false;
  const year = Number(yearPart);
  const month = Number(monthPart);
  if (!Number.isInteger(year) || !Number.isInteger(month)) return false;
  return month >= 1 && month <= 12 && year >= 1900;
}

/** "2026-03" -> "March 2026" */
export function manufactureMonthLabel(value: string) {
  if (!isValidMonthValue(value)) return "";
  const [year, month] = value.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
}

/** Current month as "YYYY-MM", used as the max selectable batch month. */
export function currentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export const EARLIEST_MANUFACTURE_MONTH = "2000-01";

/**
 * Returns the first problem found, or null when the block is complete.
 * Percentages must add up to exactly 100 so the composition is unambiguous.
 */
export function validateSpecifications(
  specs: ProductSpecifications | null | undefined,
): string | null {
  const rows = Array.isArray(specs?.materialComposition)
    ? specs!.materialComposition
    : [];
  const filled = rows.filter(
    (row) =>
      String(row?.material || "").trim() ||
      (row?.percentage !== null && row?.percentage !== undefined),
  );

  if (!filled.length) {
    return "Add the material and composition (for example 80% Cotton, 20% Polyester).";
  }
  if (filled.some((row) => !String(row.material || "").trim())) {
    return "Every composition row needs a material name.";
  }
  if (
    filled.some(
      (row) =>
        typeof row.percentage !== "number" ||
        !Number.isFinite(row.percentage) ||
        row.percentage <= 0 ||
        row.percentage > 100,
    )
  ) {
    return "Every material needs a percentage between 1 and 100.";
  }

  const names = filled.map((row) => String(row.material).trim().toLowerCase());
  if (new Set(names).size !== names.length) {
    return "The same material is listed more than once.";
  }

  const total = filled.reduce(
    (sum, row) => sum + Number(row.percentage || 0),
    0,
  );
  if (Math.abs(total - 100) > 0.01) {
    return `Material percentages must add up to 100% (currently ${Number(total.toFixed(2))}%).`;
  }

  const month = String(specs?.manufactureMonth || "").trim();
  if (!month) return "Select the month and year of manufacture.";
  if (!isValidMonthValue(month)) {
    return "Enter the month of manufacture as a valid month and year.";
  }
  if (month > currentMonthValue()) {
    return "The month of manufacture cannot be in the future.";
  }
  if (month < EARLIEST_MANUFACTURE_MONTH) {
    return "Enter a realistic month of manufacture.";
  }

  const country = String(specs?.countryOfOrigin || "").trim();
  if (!country) return "Select the country of origin.";
  if (!findCountry(country)) {
    return "Select the country of origin from the list.";
  }

  return null;
}

/** Fills in the derived display fields from the raw inputs. */
export function normalizeSpecifications(
  specs: ProductSpecifications,
): ProductSpecifications {
  const rows = (Array.isArray(specs.materialComposition)
    ? specs.materialComposition
    : []
  )
    .map((row) => ({
      material: String(row?.material || "").trim(),
      percentage:
        typeof row?.percentage === "number" && Number.isFinite(row.percentage)
          ? row.percentage
          : null,
    }))
    .filter((row) => row.material || row.percentage !== null);

  const country = findCountry(specs.countryOfOrigin || "");
  const month = String(specs.manufactureMonth || "").trim();

  return {
    materialComposition: rows,
    materialCompositionText: formatComposition(rows),
    manufactureMonth: month,
    manufactureMonthLabel: manufactureMonthLabel(month),
    countryOfOrigin: country?.name || String(specs.countryOfOrigin || "").trim(),
    countryOfOriginCode: country?.code || "",
  };
}

/** True when a product carries a usable specifications block. */
export function hasSpecifications(
  specs: ProductSpecifications | null | undefined,
) {
  return Boolean(
    specs &&
      (specs.materialCompositionText ||
        (Array.isArray(specs.materialComposition) &&
          specs.materialComposition.length) ||
        specs.manufactureMonth ||
        specs.countryOfOrigin),
  );
}
