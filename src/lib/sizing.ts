import type { FitType, GarmentCategory } from "@/lib/types";

export const TOP_SIZE_OPTIONS = ["3XS", "2XS", "XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL", "5XL"] as const;
export const BOTTOM_SIZE_OPTIONS = ["3XS", "XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL", "5XL", "6XL"] as const;
export const GARMENT_SIZES = [...new Set([...TOP_SIZE_OPTIONS, ...BOTTOM_SIZE_OPTIONS])] as const;
export type GarmentSize = (typeof GARMENT_SIZES)[number];

export type GarmentMeasurements = {
  chest?: number;
  length?: number;
  shoulder?: number;
  waist?: number;
  hip?: number;
  inseam?: number;
};

type SizingMatrix = Record<
  GarmentCategory,
  Record<FitType, Partial<Record<GarmentSize, GarmentMeasurements>>>
>;

const roundToHalf = (value: number) => Math.round(value * 2) / 2;

const FIT_ADJUSTMENTS: Record<FitType, GarmentMeasurements> = {
  Slim: { waist: -1, hip: -1, inseam: 0 },
  Regular: { chest: 0, length: 0, shoulder: 0, waist: 0, hip: 0, inseam: 0 },
  Oversized: { waist: 2, hip: 4, inseam: 0.5 },
};

const TOPS_BY_FIT: Record<FitType, Partial<Record<GarmentSize, GarmentMeasurements>>> = {
  Slim: {
    "3XS": { chest: 28, shoulder: 12, length: 21 },
    "2XS": { chest: 30, shoulder: 12.5, length: 22 },
    XS: { chest: 32, shoulder: 13, length: 23 },
    S: { chest: 34, shoulder: 13.5, length: 24 },
    M: { chest: 36, shoulder: 14, length: 25 },
    L: { chest: 38, shoulder: 14.5, length: 26 },
    XL: { chest: 40, shoulder: 15, length: 27 },
    XXL: { chest: 42, shoulder: 15.5, length: 28 },
    "3XL": { chest: 44, shoulder: 16, length: 29 },
    "4XL": { chest: 46, shoulder: 16.5, length: 30 },
    "5XL": { chest: 48, shoulder: 17, length: 31 },
  },
  Regular: {
    "3XS": { chest: 30, shoulder: 12.5, length: 21 },
    "2XS": { chest: 32, shoulder: 13, length: 22 },
    XS: { chest: 34, shoulder: 13.5, length: 23 },
    S: { chest: 36, shoulder: 14, length: 24 },
    M: { chest: 38, shoulder: 14.5, length: 25 },
    L: { chest: 40, shoulder: 15, length: 26 },
    XL: { chest: 42, shoulder: 15.5, length: 27 },
    XXL: { chest: 44, shoulder: 16, length: 28 },
    "3XL": { chest: 46, shoulder: 16.5, length: 29 },
    "4XL": { chest: 48, shoulder: 17, length: 30 },
    "5XL": { chest: 50, shoulder: 17.5, length: 31 },
  },
  Oversized: {
    "3XS": { chest: 36, shoulder: 17, length: 24 },
    "2XS": { chest: 38, shoulder: 18, length: 25 },
    XS: { chest: 40, shoulder: 19, length: 26 },
    S: { chest: 42, shoulder: 20, length: 27 },
    M: { chest: 44, shoulder: 21, length: 28 },
    L: { chest: 46, shoulder: 22, length: 29 },
    XL: { chest: 48, shoulder: 23, length: 30 },
    XXL: { chest: 50, shoulder: 24, length: 31 },
    "3XL": { chest: 52, shoulder: 25, length: 32 },
    "4XL": { chest: 54, shoulder: 26, length: 33 },
    "5XL": { chest: 56, shoulder: 27, length: 34 },
  },
};

const REGULAR_BASE: Record<GarmentCategory, Partial<Record<GarmentSize, GarmentMeasurements>>> = {
  Tops: TOPS_BY_FIT.Regular,
  Bottoms: Object.fromEntries(
    BOTTOM_SIZE_OPTIONS.map((size, index) => [
      size,
      {
        waist: 22 + index * 2,
        hip: 30 + index * 2,
        inseam: roundToHalf(28.5 + index * 0.5),
      },
    ]),
  ) as Partial<Record<GarmentSize, GarmentMeasurements>>,
};

function adjustMeasurements(
  measurements: GarmentMeasurements,
  fit: FitType,
): GarmentMeasurements {
  const adjustment = FIT_ADJUSTMENTS[fit];
  return Object.fromEntries(
    Object.entries(measurements).map(([key, value]) => [
      key,
      roundToHalf(value + (adjustment[key as keyof GarmentMeasurements] || 0)),
    ]),
  ) as GarmentMeasurements;
}

export const SIZING_MATRIX: SizingMatrix = {
  Tops: {
    Slim: TOPS_BY_FIT.Slim,
    Regular: TOPS_BY_FIT.Regular,
    Oversized: TOPS_BY_FIT.Oversized,
  },
  Bottoms: {
    Slim: Object.fromEntries(BOTTOM_SIZE_OPTIONS.map((size) => [size, adjustMeasurements(REGULAR_BASE.Bottoms[size]!, "Slim")])) as Partial<Record<GarmentSize, GarmentMeasurements>>,
    Regular: REGULAR_BASE.Bottoms,
    Oversized: Object.fromEntries(BOTTOM_SIZE_OPTIONS.map((size) => [size, adjustMeasurements(REGULAR_BASE.Bottoms[size]!, "Oversized")])) as Partial<Record<GarmentSize, GarmentMeasurements>>,
  },
};

export function sizesForCategory(category: GarmentCategory) {
  return category === "Tops" ? TOP_SIZE_OPTIONS : BOTTOM_SIZE_OPTIONS;
}

export function measurementsForVariant(
  category: GarmentCategory,
  fit: FitType,
  sizeValue: string,
): GarmentMeasurements | null {
  const normalizedSize = sizeValue.trim().toUpperCase() as GarmentSize;
  return GARMENT_SIZES.includes(normalizedSize) && SIZING_MATRIX[category][fit][normalizedSize]
    ? { ...SIZING_MATRIX[category][fit][normalizedSize] }
    : null;
}
