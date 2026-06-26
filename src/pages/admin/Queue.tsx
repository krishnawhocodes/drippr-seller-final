import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Search, Eye, CheckCircle, XCircle, RefreshCcw, Info } from "lucide-react";

import { queueList, queueApprove, queueReject } from "@/lib/adminApi";

// ---------- Types (mirrors backend; tolerant to missing fields) ----------
type ChangeVal = { old?: any; new?: any };

type ChangeSummary = {
  instantApplied?: string[]; // e.g. ["price","stock"]
  base?: Record<string, ChangeVal>; // title/description/productType/price/stock/etc.
  variants?: Array<{
    key?: string;         // internal key (e.g., "Red|M")
    title?: string;       // human-friendly label (e.g., "Red / M")
    fields?: Record<string, ChangeVal>; // price/compareAtPrice/sku/inventoryQty/barcode/weightGrams
  }>;
  note?: string;
};

type VariantDraft = {
  options?: { name: string; values: string[] }[];
  variants?: Array<{
    title?: string;
    options?: string[];
    optionValues?: string[];
    price?: number | string;
    compareAtPrice?: number | string;
    sku?: string;
    barcode?: string;
    weightGrams?: number;
    quantity?: number;
    measurements?: {
      bust?: number | null;
      waist?: number | null;
      hip?: number | null;
      length?: number | null;
      unit?: "in";
    } | null;
  }>;
};

type QueueStatus = "pending" | "approved" | "rejected" | "update_in_review";

type QueueProduct = {
  id: string;
  merchantId: string;
  title: string;
  description?: string;
  price?: number;
  productType?: string | null;
  collections?: string[];
  status: QueueStatus;
  tags?: string[];
  images?: string[];
  image?: string | null;
  createdAt?: number;
  merchant?: { uid?: string; name?: string; email?: string } | null;
  variantDraft?: VariantDraft | null;
  changeSummary?: ChangeSummary | null; // present for updates
  adminNotes?: string;
};

const PLACEHOLDER = "https://placehold.co/96x96?text=IMG";
const COLLECTION_OPTIONS = [
  "ATHLEISURE",
  "CARGOS & PANTS",
  "CO-RD SET",
  "DAARCK",
  "DAILY DRIP",
  "FUSION",
  "HOUSE OF RIVAEM",
  "JACKETS",
  "MENS ATHLEISURE",
  "MENS LIFESTYLE & BOTTOMS",
  "MENS T-SHIRT & SHIRTS",
  "MINIMALISM",
  "SHORTS & SKIRTS",
  "STREETWEAR",
  "SWEATSHIRT & HOODS",
  "TEES",
  "THRIFT",
  "TOPS & DRESSES",
] as const;

// ---------- helpers ----------
const formatMoneyINR = (n?: number | string) =>
  `₹${Number(n ?? 0).toLocaleString("en-IN")}`;

function StatusBadge({ s }: { s: QueueProduct["status"] }) {
  let label = "In review";
  let cls =
    "bg-warning/10 text-warning border-warning/20";

  if (s === "approved") {
    label = "Approved";
    cls = "bg-success/10 text-success border-success/20";
  } else if (s === "rejected") {
    label = "Rejected";
    cls = "bg-destructive/10 text-destructive border-destructive/20";
  } else if (s === "update_in_review") {
    label = "Update review";
    cls = "bg-primary/10 text-primary border-primary/20";
  }

  return <Badge className={cls}>{label}</Badge>;
}

function VariantDraftPreview({ variantDraft }: { variantDraft?: VariantDraft | null }) {
  if (!variantDraft || (!variantDraft.options?.length && !variantDraft.variants?.length)) {
    return <div className="text-sm text-muted-foreground">No variant draft provided.</div>;
  }
  const formatMeasurements = (measurements: any) => {
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
  };
  return (
    <div className="space-y-3">
      {variantDraft.options?.length ? (
        <div className="text-sm">
          <div className="font-semibold mb-1">Options</div>
          <ul className="list-disc ml-5 space-y-1">
            {variantDraft.options.map((opt, i) => (
              <li key={i}>
                <span className="font-medium">{opt.name}:</span>{" "}
                <span className="text-muted-foreground">{(opt.values || []).join(", ")}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {variantDraft.variants?.length ? (
        <div className="text-sm">
          <div className="font-semibold mb-2">Variant Combos</div>
          <div className="border rounded-md overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Options</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Compare@</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Barcode</TableHead>
                  <TableHead>Weight(g)</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Measurements</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {variantDraft.variants.map((v, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="font-medium">{v.title || "—"}</TableCell>
                    <TableCell>{v.price != null ? formatMoneyINR(v.price) : "—"}</TableCell>
                    <TableCell>{v.compareAtPrice != null ? formatMoneyINR(v.compareAtPrice) : "—"}</TableCell>
                    <TableCell className="text-xs">{v.sku || "—"}</TableCell>
                    <TableCell className="text-xs">{v.barcode || "—"}</TableCell>
                    <TableCell>{v.weightGrams ?? "—"}</TableCell>
                    <TableCell>{v.quantity ?? "—"}</TableCell>
                    <TableCell className="text-xs">
                      {formatMeasurements(v.measurements)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const MEASUREMENT_KEYS = ["chest", "bust", "waist", "hip", "length", "shoulder", "inseam"];

function MeasurementValues({ value }: { value: any }) {
  const rows = MEASUREMENT_KEYS.filter(
    (key) => typeof value?.[key] === "number",
  ).map((key) => ({
    key,
    label:
      key === "bust"
        ? "Chest / Bust"
        : key.charAt(0).toUpperCase() + key.slice(1),
    value: value[key],
  }));
  if (!rows.length) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="grid gap-1.5">
      {rows.map((row) => (
        <div key={row.key} className="flex justify-between gap-4 rounded bg-background/70 px-2 py-1">
          <span className="text-muted-foreground">{row.label}</span>
          <span className="font-medium">{row.value} in</span>
        </div>
      ))}
    </div>
  );
}

function VariantMeasurementComparison({ change }: { change: ChangeVal }) {
  const previous = Array.isArray(change.old) ? change.old : [];
  const requested = Array.isArray(change.new) ? change.new : [];
  const getKey = (variant: any, index: number) =>
    String(variant?.variantId || variant?.id || variant?.title || variant?.optionValues?.join("|") || index);
  const previousByKey = new Map(
    previous.map((variant, index) => [getKey(variant, index), variant]),
  );
  if (!requested.length) return <span className="text-muted-foreground">No requested measurement changes</span>;

  return (
    <div className="space-y-3">
      {requested.map((variant, index) => {
        const key = getKey(variant, index);
        const oldVariant = previousByKey.get(key);
        const label = variant?.title || variant?.optionValues?.join(" / ") || `Variant ${index + 1}`;
        return (
          <div key={key} className="rounded-md border bg-background p-3">
            <div className="mb-2 font-semibold">{label}</div>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Previous</div>
                <MeasurementValues value={oldVariant?.measurements} />
              </div>
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-emerald-700">Requested</div>
                <MeasurementValues value={variant?.measurements} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ChangesTable({ base }: { base?: Record<string, ChangeVal> }) {
  if (!base || !Object.keys(base).length) return null;
  const displayValue = (field: string, value: any): ReactNode => {
    if (value == null || value === "") return "—";
    if (field === "measurements") return <MeasurementValues value={value} />;
    if (field === "variantDraft") return "New combinations are shown in the variant table above.";
    if (field === "variantMediaUpdates") {
      const updates = Array.isArray(value) ? value : [];
      return updates.length
        ? updates.map((item) => `${item.color || "Variant"}: ${(item.resourceUrls || []).length} new photo(s)`).join(", ")
        : "—";
    }
    if (field === "removeVariantIds" && Array.isArray(value)) {
      return `${value.length} variant${value.length === 1 ? "" : "s"} selected for removal`;
    }
    if (Array.isArray(value)) return value.join(", ") || "—";
    if (typeof value === "object") {
      const entries = Object.entries(value).filter(([key]) => key !== "unit");
      return entries.length
        ? entries.map(([key, item]) => `${key}: ${String(item ?? "—")}`).join(", ")
        : "—";
    }
    return String(value);
  };
  return (
    <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-4">
      <h4 className="font-semibold mb-2 text-primary">Requested field changes</h4>
      <div className="overflow-x-auto rounded border bg-background">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-2 w-40">Field</th>
              <th className="text-left p-2">Old</th>
              <th className="text-left p-2">New</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(base).map(([k, v]) =>
              k === "variantMeasurements" ? (
                <tr key={k} className="border-t bg-amber-50/60">
                  <td className="p-2 align-top font-medium">Variant measurements</td>
                  <td colSpan={2} className="p-3">
                    <VariantMeasurementComparison change={v} />
                  </td>
                </tr>
              ) : (
                <tr key={k} className="border-t bg-amber-50/60">
                  <td className="p-2 font-medium capitalize">{k.replace(/_/g, " ")}</td>
                  <td className="p-2 text-muted-foreground line-through decoration-destructive/70 whitespace-pre-wrap">
                    {displayValue(k, v.old)}
                  </td>
                  <td className="p-2 font-semibold text-emerald-800 bg-emerald-50 whitespace-pre-wrap">
                    {displayValue(k, v.new)}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function VariantChanges({ variants }: { variants?: Array<{ key?: string; title?: string; fields?: Record<string, ChangeVal> }> }) {
  if (!variants || !variants.length) return null;
  return (
    <div className="space-y-3">
      <h4 className="font-semibold">Variant changes</h4>
      <div className="space-y-2">
        {variants.map((v, i) => (
          <div key={v.key || v.title || i} className="rounded-lg border-2 border-primary/30 bg-primary/5 p-3">
            <div className="font-medium mb-2">{v.title || v.key || `Variant ${i + 1}`}</div>
            <div className="overflow-x-auto rounded border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-2 w-40">Field</th>
                    <th className="text-left p-2">Old</th>
                    <th className="text-left p-2">New</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(v.fields || {}).map(([fk, fv]) => (
                    <tr key={fk} className="border-t bg-amber-50/60">
                      <td className="p-2 font-medium capitalize">{fk.replace(/_/g, " ")}</td>
                      <td className="p-2 text-muted-foreground line-through decoration-destructive/70">{String(fv.old ?? "—")}</td>
                      <td className="p-2 font-semibold text-emerald-800 bg-emerald-50 underline decoration-2 underline-offset-4">{String(fv.new ?? "—")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Page ----------
type StatusFilter = QueueStatus | "all";

export default function ProductQueue() {
  const [items, setItems] = useState<QueueProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);

  const [status, setStatus] = useState<StatusFilter>("pending");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const debounce = useRef<number | null>(null);

  const [selected, setSelected] = useState<QueueProduct | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [approvalCollections, setApprovalCollections] = useState<string[]>([]);
  const [customCollectionName, setCustomCollectionName] = useState("");

  useEffect(() => {
    setApprovalCollections(selected?.collections || []);
    setCustomCollectionName("");
  }, [selected?.id]);

  // debounce search
  useEffect(() => {
    if (debounce.current) window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => setQ(search.trim().toLowerCase()), 300);
    return () => debounce.current && window.clearTimeout(debounce.current);
  }, [search]);

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await queueList({
        status,
        limit: 300,
      });
      const base = (resp.items || []) as QueueProduct[];
      const filtered = q
        ? base.filter((p) =>
            `${p.title || ""} ${p.merchant?.name || ""} ${p.merchant?.email || ""}`
              .toLowerCase()
              .includes(q)
          )
        : base;
      setItems(filtered);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load queue");
    } finally {
      setLoading(false);
    }
  }, [status, q]);

  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  const approve = async (product: QueueProduct) => {
    if (!approvalCollections.length) {
      toast.error("Select at least one collection before approving.");
      return;
    }
    try {
      setActionBusy(true);
      const result = await queueApprove(product.id, undefined, approvalCollections); // backend handles both new + update approvals
      toast.success(
        product.status === "update_in_review"
          ? `${product.title} update approved`
          : `${product.title} approved`
      );
      if (Array.isArray(result?.warnings) && result.warnings.length) {
        toast.warning(result.warnings.join("\n"), { duration: 10000 });
      }
      setSelected(null);
      fetchQueue();
    } catch (e: any) {
      toast.error(e?.message || "Approve failed");
    } finally {
      setActionBusy(false);
    }
  };

  const reject = async () => {
    if (!selected) return;
    if (!rejectReason.trim()) return toast.error("Please add a reason");
    try {
      setActionBusy(true);
      await queueReject(selected.id, rejectReason.trim());
      toast.success(
        selected.status === "update_in_review"
          ? `${selected.title} update rejected`
          : `${selected.title} rejected`
      );
      setRejectOpen(false);
      setRejectReason("");
      setSelected(null);
      fetchQueue();
    } catch (e: any) {
      toast.error(e?.message || "Reject failed");
    } finally {
      setActionBusy(false);
    }
  };

  const header = useMemo(
    () => (
      <div className="flex flex-col md:flex-row gap-4">
        <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
          <SelectTrigger className="w-full md:w-56">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">In Review</SelectItem>
            <SelectItem value="update_in_review">Updates</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="all">All Status</SelectItem>
          </SelectContent>
        </Select>

        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by title or merchant…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <Button variant="outline" onClick={fetchQueue} disabled={loading}>
          <RefreshCcw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>
    ),
    [status, search, loading, fetchQueue]
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6">{header}</CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="text-center text-muted-foreground py-12">
              No products found.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Image</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Merchant</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <img
                        src={p.image || p.images?.[0] || PLACEHOLDER}
                        alt={p.title}
                        className="w-12 h-12 object-cover rounded border bg-muted"
                        onError={(e) => ((e.currentTarget as HTMLImageElement).src = PLACEHOLDER)}
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      {p.title}
                      {p.status === "update_in_review" ? (
                        <span className="ml-2 text-xs rounded px-2 py-0.5 border bg-primary/5 text-primary">
                          Update
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {p.merchant?.name || "-"}
                      {p.merchant?.email ? (
                        <span className="block text-xs text-muted-foreground">
                          {p.merchant.email}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {p.createdAt ? new Date(p.createdAt).toLocaleDateString() : "-"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge s={p.status} />
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={() => setSelected(p)}>
                        <Eye className="h-4 w-4 mr-1" />
                        Review
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Review Sheet */}
      <Sheet open={!!selected} onOpenChange={() => setSelected(null)}>
        <SheetContent className="overflow-y-auto w-full sm:max-w-2xl">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center justify-between">
                  <span>{selected.title}</span>
                  <StatusBadge s={selected.status} />
                </SheetTitle>
                <SheetDescription>
                  Review product details, images, variant draft (if any), and the change summary for updates.
                </SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-6">
                {/* Update callout */}
                {selected.status === "update_in_review" && (
                  <div className="rounded-md border bg-primary/5 p-3 text-sm">
                    <div className="flex items-start gap-2">
                      <Info className="h-4 w-4 mt-0.5 text-primary" />
                      <div>
                        <div className="font-medium text-primary">Update requested</div>
                        <p className="text-muted-foreground">
                          Price / stock edits (if present) were already applied to the live Shopify product. Other changes are pending approval below.
                        </p>
                        {selected.changeSummary?.instantApplied?.length ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {selected.changeSummary.instantApplied.map((k) => (
                              <Badge key={k} variant="outline" className="text-xs">{k}</Badge>
                            ))}
                          </div>
                        ) : null}
                        {selected.changeSummary?.note ? (
                          <p className="text-xs text-muted-foreground mt-2">{selected.changeSummary.note}</p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                )}

                {/* Images */}
                {selected.images?.length ? (
                  <div>
                    <h4 className="font-semibold mb-2">Product Images</h4>
                    <div className="grid grid-cols-3 gap-2">
                      {selected.images.map((img, idx) => (
                        <img
                          key={idx}
                          src={img}
                          alt={`${selected.title} ${idx + 1}`}
                          className="w-full h-28 object-cover rounded border bg-muted"
                          onError={(e) =>
                            ((e.currentTarget as HTMLImageElement).src = PLACEHOLDER)
                          }
                        />
                      ))}
                    </div>
                  </div>
                ) : null}

                {/* Details */}
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="font-semibold">Merchant:</span>{" "}
                    {selected.merchant?.name || "-"}{" "}
                    {selected.merchant?.email ? `(${selected.merchant.email})` : ""}
                  </div>
                  <div>
                    <span className="font-semibold">Base Price:</span>{" "}
                    {selected.price != null ? formatMoneyINR(selected.price) : "—"}
                  </div>
                  <div>
                    <span className="font-semibold">Type:</span>{" "}
                    {selected.productType || "-"}
                  </div>
                  {selected.tags?.length ? (
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="font-semibold mr-1">Tags:</span>
                      {selected.tags.map((tag, idx) => (
                        <Badge key={idx} variant="secondary">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                  <div className="pt-2">
                    <span className="font-semibold">Description:</span>
                    <p className="text-muted-foreground whitespace-pre-wrap mt-1">
                      {selected.description || "—"}
                    </p>
                  </div>
                </div>

                {/* Variant Draft (from seller) */}
                <VariantDraftPreview variantDraft={selected.variantDraft} />

                {/* Change Summary (for updates) */}
                {selected.status === "update_in_review" && (
                  <div className="space-y-4">
                    <h3 className="font-semibold">Change Summary</h3>
                    <ChangesTable base={selected.changeSummary?.base} />
                    <VariantChanges variants={selected.changeSummary?.variants} />
                  </div>
                )}

                <div className="space-y-2 rounded-md border bg-muted/20 p-3">
                  <div>
                    <h4 className="font-semibold">Store collections</h4>
                    <p className="text-xs text-muted-foreground">
                      Select where this product should appear before approving.
                    </p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-auto min-h-10 w-full justify-between whitespace-normal text-left"
                      >
                        <span>
                          {approvalCollections.length
                            ? approvalCollections.join(", ")
                            : "Select one or more collections"}
                        </span>
                        <span className="ml-3 text-muted-foreground">⌄</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="start"
                      className="max-h-80 w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto"
                    >
                      <DropdownMenuLabel>Store collections</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {COLLECTION_OPTIONS.map((collectionName) => (
                        <DropdownMenuCheckboxItem
                          key={collectionName}
                          checked={approvalCollections.includes(collectionName)}
                          onSelect={(event) => event.preventDefault()}
                          onCheckedChange={(checked) =>
                            setApprovalCollections((current) =>
                              checked
                                ? [...new Set([...current, collectionName])]
                                : current.filter((item) => item !== collectionName),
                            )
                          }
                        >
                          {collectionName}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Add your own collection"
                      value={customCollectionName}
                      onChange={(event) => setCustomCollectionName(event.target.value)}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        const customName = customCollectionName.trim();
                        if (!customName) return;
                        setApprovalCollections((current) => [
                          ...new Set([...current, customName]),
                        ]);
                        setCustomCollectionName("");
                      }}
                    >
                      Add
                    </Button>
                  </div>
                  {approvalCollections.length ? (
                    <div className="flex flex-wrap gap-2">
                      {approvalCollections.map((collectionName) => (
                        <Badge
                          key={collectionName}
                          variant="outline"
                          className="cursor-pointer"
                          onClick={() =>
                            setApprovalCollections((current) =>
                              current.filter((item) => item !== collectionName),
                            )
                          }
                        >
                          {collectionName} ×
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-4">
                  <Button className="flex-1" disabled={actionBusy} onClick={() => approve(selected)}>
                    <CheckCircle className="mr-2 h-4 w-4" />
                    {selected.status === "update_in_review" ? "Approve Update" : "Approve"}
                  </Button>
                  <Button
                    variant="destructive"
                    className="flex-1"
                    disabled={actionBusy}
                    onClick={() => setRejectOpen(true)}
                  >
                    <XCircle className="mr-2 h-4 w-4" />
                    {selected.status === "update_in_review" ? "Reject Update" : "Reject"}
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Reject dialog */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selected?.status === "update_in_review" ? "Reject Update" : "Reject Product"}
            </DialogTitle>
            <DialogDescription>
              Provide a reason — the seller will see this in their panel.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Reason…"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={4}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRejectOpen(false);
                setRejectReason("");
              }}
              disabled={actionBusy}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={reject} disabled={actionBusy || !rejectReason.trim()}>
              {selected?.status === "update_in_review" ? "Reject Update" : "Reject Product"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
