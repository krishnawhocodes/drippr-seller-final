import { VariantDraft } from "@/types/admin";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface VariantDraftPreviewProps {
  variantDraft: VariantDraft;
}

function formatMeasurements(measurements: VariantDraft["variants"][number]["measurements"]) {
  if (!measurements) return "-";

  const parts = [
    ["Chest", measurements.bust],
    ["Waist", measurements.waist],
    ["Hip", measurements.hip],
    ["Length", measurements.length],
  ]
    .filter(([, value]) => typeof value === "number")
    .map(([label, value]) => `${label}: ${value} in`);

  return parts.length ? parts.join(", ") : "-";
}

export function VariantDraftPreview({ variantDraft }: VariantDraftPreviewProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h4 className="font-semibold text-sm">Product Options</h4>
        <div className="space-y-2">
          {variantDraft.options.map((option, idx) => (
            <div key={idx} className="flex flex-wrap gap-2 items-center">
              <span className="text-sm font-medium min-w-20">
                {option.name}:
              </span>
              {option.values.map((value, vIdx) => (
                <Badge key={vIdx} variant="secondary">
                  {value}
                </Badge>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div>
        <h4 className="font-semibold text-sm mb-2">Variant Details</h4>
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Variant</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Compare At</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Barcode</TableHead>
                <TableHead>Weight (g)</TableHead>
                <TableHead>Measurements</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {variantDraft.variants.map((variant, idx) => {
                const optionValues =
                  variant.optionValues || variant.options || [];

                return (
                  <TableRow key={idx}>
                    <TableCell className="font-medium">
                      {optionValues.join(" / ")}
                    </TableCell>
                    <TableCell>₹{variant.price || "-"}</TableCell>
                    <TableCell>
                      {variant.compareAtPrice
                        ? `₹${variant.compareAtPrice}`
                        : "-"}
                    </TableCell>
                    <TableCell>{variant.sku || "-"}</TableCell>
                    <TableCell>{variant.quantity || "-"}</TableCell>
                    <TableCell>{variant.barcode || "-"}</TableCell>
                    <TableCell>{variant.weightGrams || "-"}</TableCell>
                    <TableCell>{formatMeasurements(variant.measurements)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
