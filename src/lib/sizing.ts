import type { FitType, GarmentCategory } from "@/lib/types";

export const GARMENT_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "XXXL"] as const;
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
  Record<FitType, Record<GarmentSize, GarmentMeasurements>>
>;

const roundToHalf = (value: number) => Math.round(value * 2) / 2;

const FIT_ADJUSTMENTS: Record<FitType, GarmentMeasurements> = {
  Slim: { chest: -2, length: -0.5, shoulder: -0.5, waist: -1, hip: -1, inseam: 0 },
  Regular: { chest: 0, length: 0, shoulder: 0, waist: 0, hip: 0, inseam: 0 },
  Oversized: { chest: 4, length: 1, shoulder: 1.5, waist: 2, hip: 4, inseam: 0.5 },
};

const REGULAR_BASE: Record<GarmentCategory, Record<GarmentSize, GarmentMeasurements>> = {
  Tops: Object.fromEntries(
    GARMENT_SIZES.map((size, index) => [
      size,
      {
        chest: 34 + index * 2,
        length: roundToHalf(25.5 + index * 0.5),
        shoulder: roundToHalf(15.5 + index * 0.5),
      },
    ]),
  ) as Record<GarmentSize, GarmentMeasurements>,
  Bottoms: Object.fromEntries(
    GARMENT_SIZES.map((size, index) => [
      size,
      {
        waist: 26 + index * 2,
        hip: 34 + index * 2,
        inseam: roundToHalf(28.5 + index * 0.5),
      },
    ]),
  ) as Record<GarmentSize, GarmentMeasurements>,
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
    Slim: Object.fromEntries(GARMENT_SIZES.map((size) => [size, adjustMeasurements(REGULAR_BASE.Tops[size], "Slim")])) as Record<GarmentSize, GarmentMeasurements>,
    Regular: REGULAR_BASE.Tops,
    Oversized: Object.fromEntries(GARMENT_SIZES.map((size) => [size, adjustMeasurements(REGULAR_BASE.Tops[size], "Oversized")])) as Record<GarmentSize, GarmentMeasurements>,
  },
  Bottoms: {
    Slim: Object.fromEntries(GARMENT_SIZES.map((size) => [size, adjustMeasurements(REGULAR_BASE.Bottoms[size], "Slim")])) as Record<GarmentSize, GarmentMeasurements>,
    Regular: REGULAR_BASE.Bottoms,
    Oversized: Object.fromEntries(GARMENT_SIZES.map((size) => [size, adjustMeasurements(REGULAR_BASE.Bottoms[size], "Oversized")])) as Record<GarmentSize, GarmentMeasurements>,
  },
};

export function measurementsForVariant(
  category: GarmentCategory,
  fit: FitType,
  sizeValue: string,
): GarmentMeasurements | null {
  const normalizedSize = sizeValue.trim().toUpperCase() as GarmentSize;
  return GARMENT_SIZES.includes(normalizedSize)
    ? { ...SIZING_MATRIX[category][fit][normalizedSize] }
    : null;
}
