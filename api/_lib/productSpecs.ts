// api/_lib/productSpecs.ts
// Server-side mirror of src/lib/productSpecs.ts. The two cannot share a module
// (separate tsconfig/bundles), so this keeps the same shape and rules.
//
// Country membership is validated on the client against the full ISO list;
// here we validate shape only, to avoid duplicating 266 entries. An invalid
// code simply fails Shopify's own validation, which is handled as a warning.

export type MaterialComponent = {
  material: string;
  percentage: number | null;
};

export type ProductSpecifications = {
  materialComposition: MaterialComponent[];
  materialCompositionText: string;
  manufactureMonth: string;
  manufactureMonthLabel: string;
  countryOfOrigin: string;
  countryOfOriginCode: string;
};

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function isValidMonthValue(value: string) {
  const parts = String(value || "").split("-");
  if (parts.length !== 2) return false;
  const [yearPart, monthPart] = parts;
  if (yearPart.length !== 4 || monthPart.length !== 2) return false;
  const year = Number(yearPart);
  const month = Number(monthPart);
  if (!Number.isInteger(year) || !Number.isInteger(month)) return false;
  return month >= 1 && month <= 12 && year >= 1900;
}

function monthLabel(value: string) {
  if (!isValidMonthValue(value)) return "";
  const [year, month] = value.split("-").map(Number);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

function currentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function isCountryCode(value: string) {
  const code = String(value || "").trim().toUpperCase();
  if (code.length !== 2) return false;
  return code >= "AA" && code <= "ZZ" &&
    code.split("").every((ch) => ch >= "A" && ch <= "Z");
}

type RawMaterialRow = { material?: unknown; percentage?: unknown };

type RawSpecifications = {
  materialComposition?: unknown;
  materialCompositionText?: unknown;
  manufactureMonth?: unknown;
  countryOfOrigin?: unknown;
  countryOfOriginCode?: unknown;
};

export function normalizeSpecifications(
  input: unknown,
): ProductSpecifications | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as RawSpecifications;

  const rows: MaterialComponent[] = (
    Array.isArray(raw.materialComposition) ? raw.materialComposition : []
  )
    .map((row: RawMaterialRow) => {
      const parsed = Number(row?.percentage);
      return {
        material: String(row?.material || "").trim(),
        percentage: Number.isFinite(parsed) ? parsed : null,
      };
    })
    .filter((row: MaterialComponent) => row.material || row.percentage !== null);

  const compositionText =
    rows
      .filter((row) => row.material && typeof row.percentage === "number")
      .map((row) => `${row.percentage}% ${row.material}`)
      .join(", ") || String(raw.materialCompositionText || "").trim();

  const month = String(raw.manufactureMonth || "").trim();
  const countryName = String(raw.countryOfOrigin || "").trim();
  const countryCode = String(raw.countryOfOriginCode || "")
    .trim()
    .toUpperCase();

  const normalized: ProductSpecifications = {
    materialComposition: rows,
    materialCompositionText: compositionText,
    manufactureMonth: month,
    manufactureMonthLabel: monthLabel(month),
    countryOfOrigin: countryName,
    countryOfOriginCode: isCountryCode(countryCode) ? countryCode : "",
  };

  return hasSpecifications(normalized) ? normalized : null;
}

export function hasSpecifications(
  specs: ProductSpecifications | null | undefined,
) {
  return Boolean(
    specs &&
      (specs.materialCompositionText ||
        specs.materialComposition?.length ||
        specs.manufactureMonth ||
        specs.countryOfOrigin),
  );
}

/** First problem found, or null when the block is complete and consistent. */
export function validateSpecifications(
  specs: ProductSpecifications | null | undefined,
): string | null {
  if (!specs) {
    return "Product specifications are required.";
  }

  const rows = Array.isArray(specs.materialComposition)
    ? specs.materialComposition
    : [];
  if (!rows.length) {
    return "Add the material and composition (for example 80% Cotton, 20% Polyester).";
  }
  if (rows.some((row) => !String(row.material || "").trim())) {
    return "Every composition row needs a material name.";
  }
  if (
    rows.some(
      (row) =>
        typeof row.percentage !== "number" ||
        !Number.isFinite(row.percentage) ||
        row.percentage <= 0 ||
        row.percentage > 100,
    )
  ) {
    return "Every material needs a percentage between 1 and 100.";
  }

  const names = rows.map((row) => String(row.material).trim().toLowerCase());
  if (new Set(names).size !== names.length) {
    return "The same material is listed more than once.";
  }

  const total = rows.reduce((sum, row) => sum + Number(row.percentage || 0), 0);
  if (Math.abs(total - 100) > 0.01) {
    return `Material percentages must add up to 100% (currently ${Number(total.toFixed(2))}%).`;
  }

  if (!specs.manufactureMonth) {
    return "Select the month and year of manufacture.";
  }
  if (!isValidMonthValue(specs.manufactureMonth)) {
    return "Enter the month of manufacture as a valid month and year.";
  }
  if (specs.manufactureMonth > currentMonthValue()) {
    return "The month of manufacture cannot be in the future.";
  }

  if (!specs.countryOfOrigin) {
    return "Select the country of origin.";
  }

  return null;
}

export const SPEC_METAFIELD_NAMESPACE = "product_specs";

/**
 * Shopify product metafields. `material_composition_json` keeps the structured
 * rows so a theme can render them precisely; the text variants are what most
 * themes and Search & Discovery filters will actually use.
 */
export function buildSpecificationMetafields(
  specs: ProductSpecifications | null | undefined,
) {
  if (!hasSpecifications(specs) || !specs) return undefined;

  const fields: Array<{
    namespace: string;
    key: string;
    type: string;
    value: string;
  }> = [];
  const add = (key: string, type: string, value: string) => {
    if (value) fields.push({ namespace: SPEC_METAFIELD_NAMESPACE, key, type, value });
  };

  add("material_composition", "single_line_text_field", specs.materialCompositionText);
  if (specs.materialComposition?.length) {
    add(
      "material_composition_json",
      "json",
      JSON.stringify(
        specs.materialComposition.map((row) => ({
          material: row.material,
          percentage: row.percentage,
        })),
      ),
    );
  }
  add("manufacture_month", "single_line_text_field", specs.manufactureMonth);
  add("manufacture_month_label", "single_line_text_field", specs.manufactureMonthLabel);
  add("country_of_origin", "single_line_text_field", specs.countryOfOrigin);
  add("country_of_origin_code", "single_line_text_field", specs.countryOfOriginCode);

  return fields.length ? fields : undefined;
}
