import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Search,
  Edit,
  Trash2,
  X,
  Upload,
  ImagePlus,
  ImageMinus,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import type { FitType, GarmentCategory, Variant } from "@/lib/types";
import { measurementsForVariant } from "@/lib/sizing";

/** ---------------- Types ---------------- */
type StagedTarget = {
  url: string;
  resourceUrl: string;
  parameters: { name: string; value: string }[];
};

type ProductMeasurements = {
  chest?: number | null;
  bust?: number | null;
  waist?: number | null;
  hip?: number | null;
  length?: number | null;
  shoulder?: number | null;
  inseam?: number | null;
  unit?: "in";
};

type MerchantProduct = {
  id: string;
  title: string;
  description?: string;
  price?: number;
  productType?: string;
  status?: "pending" | "approved" | "rejected" | "update_in_review" | "deleted";
  images?: string[];
  image?: string | null;
  createdAt?: number;
  sku?: string; // now used for delete confirmation & required on create
  stock?: number;
  tags?: string[];
  vendor?: string | null;
  measurements?: ProductMeasurements | null;
};

type AddProductDraft = {
  title?: string;
  description?: string;
  basePriceInput?: string;
  compareAtPrice?: number | null;
  cost?: number | null;
  barcode?: string;
  weightGrams?: number | null;
  quantity?: number | null;
  vendor?: string;
  productType?: string;
  tags?: string[];
  seoTitle?: string;
  seoDescription?: string;
  sku?: string;
  trackInventory?: "yes" | "no";
  statusSel?: "active" | "draft";
  handleDeliveryCharge?: boolean;
  imagePreviews?: string[]; // data URLs
  options?: VariantOption[];
  garmentCategory?: GarmentCategory;
  fitType?: FitType;
  measurements?: ProductMeasurements | null;
  variantRows?: Omit<VariantRow, "id">[]; // store variant data (no id)
};

type ProductListItem = MerchantProduct & {
  isLocalDraft?: boolean;
  imagePreview?: string | null;
  draft?: AddProductDraft;
};

type VariantOption = { name: string; values: string[] };
type VariantRow = Variant & {
  id: string;
  measurements?: ProductMeasurements | null;
};

type ExistingVariant = {
  id: string; // Shopify GID
  title: string;
  optionValues: string[]; // ["Red","M"]
  price?: number;
  quantity?: number;
  sku?: string;
  barcode?: string;
  measurements?: ProductMeasurements | null;
};

/** ---------------- Utils ---------------- */
function cartesian<T>(arrs: T[][]): T[][] {
  if (arrs.length === 0) return [];
  return arrs.reduce<T[][]>(
    (acc, curr) => acc.flatMap((a) => curr.map((c) => [...a, c])),
    [[]],
  );
}
function normSku(s: string) {
  return String(s || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "-");
}

function emptyMeasurements(): ProductMeasurements {
  return {
    chest: null,
    bust: null,
    waist: null,
    hip: null,
    length: null,
    shoulder: null,
    inseam: null,
    unit: "in",
  };
}

function hasAnyMeasurement(measurements?: ProductMeasurements | null) {
  return Boolean(
    measurements &&
      ["chest", "bust", "waist", "hip", "length", "shoulder", "inseam"].some(
        (key) => typeof measurements[key as keyof ProductMeasurements] === "number",
      ),
  );
}

// ---------------- Draft helpers ----------------
function getAddProductDraftKey(uid: string | null) {
  return `addProductDraft:${uid ?? "anonymous"}`;
}

async function saveAddProductDraft(
  uid: string | null,
  stateReader: () => Partial<AddProductDraft>,
) {
  if (!uid) return;
  try {
    const key = getAddProductDraftKey(uid);
    const draft = stateReader();
    localStorage.setItem(key, JSON.stringify(draft));
    // no need to await
  } catch (err) {
    console.warn("Failed to save add product draft", err);
  }
}

async function loadAddProductDraft(
  uid: string | null,
): Promise<AddProductDraft | null> {
  if (!uid) return null;
  try {
    const key = getAddProductDraftKey(uid);
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as AddProductDraft;
  } catch (err) {
    console.warn("Failed to load add product draft", err);
    return null;
  }
}

function clearAddProductDraft(uid: string | null) {
  if (!uid) return;
  try {
    const key = getAddProductDraftKey(uid);
    localStorage.removeItem(key);
  } catch (err) {
    console.warn("Failed to clear add product draft", err);
  }
}

/** --------------- Component --------------- */
export default function Products() {
  // ----- add form state -----
  const [isAddProductOpen, setIsAddProductOpen] = useState(false);
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [handleDeliveryCharge, setHandleDeliveryCharge] = useState(true);
  const [basePriceInput, setBasePriceInput] = useState<string>("");

  // NEW: State for draft-supported text fields
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftVendor, setDraftVendor] = useState("");
  const [draftSku, setDraftSku] = useState("");
  const [draftTags, setDraftTags] = useState("");
  const [draftSeoTitle, setDraftSeoTitle] = useState("");
  const [draftSeoDesc, setDraftSeoDesc] = useState("");
  const [draftQuantity, setDraftQuantity] = useState("");
  const [draftBarcode, setDraftBarcode] = useState("");
  const [draftWeight, setDraftWeight] = useState("");
  const [draftComparePrice, setDraftComparePrice] = useState("");
  const [draftCost, setDraftCost] = useState("");
  const [draftProductType, setDraftProductType] = useState("");
  const [draftBustSize, setDraftBustSize] = useState("");
  const [draftWaistSize, setDraftWaistSize] = useState("");
  const [draftHipSize, setDraftHipSize] = useState("");
  const [draftLengthSize, setDraftLengthSize] = useState("");

  // shadcn <Select> values (controlled)
  const [trackInventory, setTrackInventory] = useState<"yes" | "no">("yes");
  const [statusSel, setStatusSel] = useState<"active" | "draft">("active");
  const [garmentCategory, setGarmentCategory] =
    useState<GarmentCategory>("Tops");
  const [fitType, setFitType] = useState<FitType>("Regular");

  // ----- list / search -----
  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid ?? null);
  const [products, setProducts] = useState<MerchantProduct[]>([]);
  const [localDraft, setLocalDraft] = useState<AddProductDraft | null>(null);
  const [search, setSearch] = useState("");

  // --- Bulk upload dialog state (kept as-is) ---
  const [isBulkOpen, setIsBulkOpen] = useState(false);
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkTotal, setBulkTotal] = useState(0);
  const [bulkDone, setBulkDone] = useState(0);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkErrors, setBulkErrors] = useState<
    Array<{ row: number; error: string }>
  >([]);

  function toNullableNumber(value: string) {
    if (value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function buildMeasurementDraft(): ProductMeasurements {
    return {
      bust: toNullableNumber(draftBustSize),
      waist: toNullableNumber(draftWaistSize),
      hip: toNullableNumber(draftHipSize),
      length: toNullableNumber(draftLengthSize),
      unit: "in",
    };
  }

  function readCurrentAddDraft(): AddProductDraft {
    return {
      title: draftTitle || undefined,
      description: draftDescription || undefined,
      vendor: draftVendor || undefined,
      sku: draftSku || undefined,
      tags: draftTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      seoTitle: draftSeoTitle || undefined,
      seoDescription: draftSeoDesc || undefined,
      quantity: toNullableNumber(draftQuantity),
      compareAtPrice: toNullableNumber(draftComparePrice),
      cost: toNullableNumber(draftCost),
      barcode: draftBarcode || undefined,
      weightGrams: toNullableNumber(draftWeight),
      productType: draftProductType || undefined,
      basePriceInput: basePriceInput || undefined,
      trackInventory,
      statusSel,
      handleDeliveryCharge,
      imagePreviews,
      options,
      garmentCategory,
      fitType,
      measurements: buildMeasurementDraft(),
      variantRows: Object.keys(variantRows).length
        ? Object.values(variantRows).map(({ id, ...r }) => r)
        : undefined,
    };
  }

  function clearAddProductFormState(form?: HTMLFormElement | null) {
    setOptions([
      { name: "Size", values: [] },
      { name: "Color", values: [] },
    ]);
    setValueInputs(["", "", ""]);
    setVariantRows({});
    setSelectedImages([]);
    setImagePreviews([]);
    setBasePriceInput("");
    setHandleDeliveryCharge(true);
    setTrackInventory("yes");
    setStatusSel("active");
    setGarmentCategory("Tops");
    setFitType("Regular");
    setDraftTitle("");
    setDraftDescription("");
    setDraftVendor("");
    setDraftSku("");
    setDraftTags("");
    setDraftSeoTitle("");
    setDraftSeoDesc("");
    setDraftQuantity("");
    setDraftBarcode("");
    setDraftWeight("");
    setDraftComparePrice("");
    setDraftCost("");
    setDraftProductType("");
    setDraftBustSize("");
    setDraftWaistSize("");
    setDraftHipSize("");
    setDraftLengthSize("");
    form?.reset();
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUid(u?.uid ?? null));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!uid) {
      setLocalDraft(null);
      return;
    }

    loadAddProductDraft(uid).then((draft) => {
      setLocalDraft(draft);
    });
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    const qy = query(
      collection(db, "merchantProducts"),
      where("merchantId", "==", uid),
      orderBy("createdAt", "desc"),
    );
    const unsub = onSnapshot(qy, (snap) => {
      const rows: MerchantProduct[] = [];
      snap.forEach((d) => rows.push({ id: d.id, ...(d.data() as any) }));
      setProducts(rows);
    });
    return () => unsub();
  }, [uid]);

  const localDraftProduct = useMemo<ProductListItem | null>(() => {
    if (!localDraft || !localDraft.title?.trim()) return null;

    const basePrice = Number(localDraft.basePriceInput || 0);
    const finalPrice =
      Number.isFinite(basePrice) && basePrice > 0
        ? basePrice + (localDraft.handleDeliveryCharge ? 100 : 0)
        : undefined;

    return {
      id: "__local_draft__",
      title: localDraft.title || "Untitled local draft",
      description: localDraft.description,
      price: finalPrice,
      productType: localDraft.productType,
      status: "pending",
      images: [],
      image: localDraft.imagePreviews?.[0] ?? null,
      sku: localDraft.sku,
      tags: localDraft.tags,
      vendor: localDraft.vendor,
      measurements: localDraft.measurements,
      isLocalDraft: true,
      imagePreview: localDraft.imagePreviews?.[0] ?? null,
      draft: localDraft,
    };
  }, [localDraft]);

  const filtered = useMemo<ProductListItem[]>(() => {
    const remoteProducts: ProductListItem[] = products.filter(
      (p) => p.status !== "deleted",
    );
    const allProducts = localDraftProduct
      ? [localDraftProduct, ...remoteProducts]
      : remoteProducts;

    const s = search.trim().toLowerCase();
    if (!s) return allProducts;

    return allProducts.filter((p) =>
      `${p.title} ${p.productType ?? ""} ${p.sku ?? ""}`
        .toLowerCase()
        .includes(s),
    );
  }, [products, search, localDraftProduct]);

  /** ====== Variants builder state (used by Add & Edit) ====== */
  const [options, setOptions] = useState<VariantOption[]>([
    { name: "Size", values: [] },
    { name: "Color", values: [] },
  ]);
  const [valueInputs, setValueInputs] = useState<string[]>(["", "", ""]);

  function generatedMeasurements(
    combo: string[],
    category: GarmentCategory = garmentCategory,
    fit: FitType = fitType,
  ): ProductMeasurements {
    const enabledOptions = options.filter(
      (option) => option.name.trim() && option.values.length > 0,
    );
    const sizeIndex = enabledOptions.findIndex(
      (option) => option.name.trim().toLowerCase() === "size",
    );
    const generated = measurementsForVariant(
      category,
      fit,
      sizeIndex >= 0 ? combo[sizeIndex] || "" : "",
    );
    if (!generated) return emptyMeasurements();
    return {
      ...emptyMeasurements(),
      ...generated,
      bust: generated.chest ?? null,
      unit: "in",
    };
  }

  function generateVariants(
    category: GarmentCategory = garmentCategory,
    fit: FitType = fitType,
  ) {
    setVariantRows((previous) =>
      Object.fromEntries(
        Object.entries(previous).map(([key, row]) => [
          key,
          { ...row, measurements: generatedMeasurements(row.options, category, fit) },
        ]),
      ),
    );
  }

  function setOptionName(idx: number, name: string) {
    setOptions((prev) => {
      const next = [...prev];
      if (!next[idx]) next[idx] = { name, values: [] };
      next[idx] = { ...next[idx], name };
      return next;
    });
  }
  function addOptionRow() {
    if (options.length >= 3) return;
    setOptions((prev) => [
      ...prev,
      { name: `Option ${prev.length + 1}`, values: [] },
    ]);
    setValueInputs((prev) => [...prev, ""]);
  }
  function removeOptionRow(idx: number) {
    setOptions((prev) => prev.filter((_, i) => i !== idx));
    setValueInputs((prev) => prev.filter((_, i) => i !== idx));
  }
  function addValue(idx: number) {
    const raw = (valueInputs[idx] || "").trim();
    if (!raw) return;
    const values = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    setOptions((prev) => {
      const next = [...prev];
      const existing = new Set(next[idx].values);
      values.forEach((v) => existing.add(v));
      next[idx] = { ...next[idx], values: Array.from(existing) };
      return next;
    });
    setValueInputs((prev) => prev.map((v, i) => (i === idx ? "" : v)));
  }
  function removeValue(idx: number, value: string) {
    setOptions((prev) => {
      const next = [...prev];
      next[idx] = {
        ...next[idx],
        values: next[idx].values.filter((v) => v !== value),
      };
      return next;
    });
  }

  // Generate combination rows from current options' values (1..3)
  const comboKeys: string[][] = useMemo(() => {
    const valueLists = options
      .filter((o) => (o?.name || "").trim() && o.values.length > 0)
      .map((o) => o.values);
    if (valueLists.length === 0) return [];
    return cartesian(valueLists);
  }, [options]);

  // Keep editable per-variant rows in state, keyed by "opt1|opt2|opt3"
  const [variantRows, setVariantRows] = useState<Record<string, VariantRow>>(
    {},
  );
  useEffect(() => {
    setVariantRows((prev) => {
      const next: Record<string, VariantRow> = {};
      for (const combo of comboKeys) {
        const key = combo.join("|");
        const title = combo.join(" / ");
        next[key] = prev[key] ?? {
          id: key,
          options: combo,
          title,
          price: undefined,
          compareAtPrice: undefined,
          sku: "",
          quantity: undefined,
          barcode: "",
          weightGrams: undefined,
          measurements: generatedMeasurements(combo),
        };
      }
      return next;
    });
  }, [comboKeys]);

  // Auto-save while Add modal is open and restore on open
  useEffect(() => {
    if (!isAddProductOpen || !uid) return;

    const timeout = setTimeout(() => {
      const draft = readCurrentAddDraft();
      saveAddProductDraft(uid, () => draft);
      setLocalDraft(draft);
    }, 500);

    return () => clearTimeout(timeout);
  }, [
    isAddProductOpen,
    uid,
    draftTitle,
    draftDescription,
    draftVendor,
    draftSku,
    draftTags,
    draftSeoTitle,
    draftSeoDesc,
    draftQuantity,
    draftBarcode,
    draftWeight,
    draftComparePrice,
    draftCost,
    draftProductType,
    draftBustSize,
    draftWaistSize,
    draftHipSize,
    draftLengthSize,
    garmentCategory,
    fitType,
    basePriceInput,
    trackInventory,
    statusSel,
    handleDeliveryCharge,
    imagePreviews,
    options,
    variantRows,
  ]);

  /** ====== helpers ====== */

  // to-be-deleted
  // const handleAddProduct = () => {
  //   setOptions([{ name: "Size", values: [] }, { name: "Color", values: [] }]);
  //   setValueInputs(["", "", ""]);
  //   setVariantRows({});
  //   setSelectedImages([]);
  //   setImagePreviews([]);
  //   set(true);
  // };

  const handleAddProduct = async () => {
    // 1. Try to load draft
    const saved = await loadAddProductDraft(uid);

    // 2. If draft exists, restore state
    if (saved) {
      if (saved.title) setDraftTitle(saved.title);
      if (saved.description) setDraftDescription(saved.description);
      if (saved.vendor) setDraftVendor(saved.vendor);
      if (saved.sku) setDraftSku(saved.sku);
      if (saved.tags) setDraftTags(saved.tags.join(", "));
      if (saved.seoTitle) setDraftSeoTitle(saved.seoTitle);
      if (saved.seoDescription) setDraftSeoDesc(saved.seoDescription);
      if (saved.basePriceInput) setBasePriceInput(saved.basePriceInput);
      if (saved.quantity != null) setDraftQuantity(String(saved.quantity));
      if (saved.compareAtPrice != null)
        setDraftComparePrice(String(saved.compareAtPrice));
      if (saved.cost != null) setDraftCost(String(saved.cost));
      if (saved.barcode) setDraftBarcode(saved.barcode);
      if (saved.weightGrams != null) setDraftWeight(String(saved.weightGrams));
      if (saved.productType) setDraftProductType(saved.productType);
      if (saved.garmentCategory) setGarmentCategory(saved.garmentCategory);
      if (saved.fitType) setFitType(saved.fitType);
      if (saved.measurements?.bust != null)
        setDraftBustSize(String(saved.measurements.bust));
      if (saved.measurements?.waist != null)
        setDraftWaistSize(String(saved.measurements.waist));
      if (saved.measurements?.hip != null)
        setDraftHipSize(String(saved.measurements.hip));
      if (saved.measurements?.length != null)
        setDraftLengthSize(String(saved.measurements.length));

      // Restore selects
      if (saved.trackInventory) setTrackInventory(saved.trackInventory);
      if (saved.statusSel) setStatusSel(saved.statusSel);
      if (typeof saved.handleDeliveryCharge === "boolean")
        setHandleDeliveryCharge(saved.handleDeliveryCharge);

      // Restore variants
      if (saved.options) setOptions(saved.options);
      if (saved.variantRows) {
        const rowsMap: Record<string, VariantRow> = {};
        saved.variantRows.forEach((r) => {
          // Reconstruct ID based on options logic in main component
          const key = r.options.join("|");
          rowsMap[key] = { ...r, id: key };
        });
        setVariantRows(rowsMap);
      }
      // Restore Images (previews only, as File objects cannot be restored from localStorage)
      if (saved.imagePreviews) setImagePreviews(saved.imagePreviews);
      setLocalDraft(saved);

      toast.success("Draft restored");
    }

    setIsAddProductOpen(true);
  };

  const handleAddDialogOpenChange = (open: boolean) => {
    setIsAddProductOpen(open);
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const remainingSlots = 5 - selectedImages.length;
    const filesToAdd = files.slice(0, remainingSlots);
    if (files.length > remainingSlots) {
      toast.error(`You can only upload ${remainingSlots} more image(s)`);
    }
    setSelectedImages([...selectedImages, ...filesToAdd]);
    filesToAdd.forEach((file) => {
      const reader = new FileReader();
      reader.onloadend = () =>
        setImagePreviews((prev) => [...prev, reader.result as string]);
      reader.readAsDataURL(file);
    });
  };

  const removeLocalImage = (index: number) => {
    setSelectedImages((s) => s.filter((_, i) => i !== index));
    setImagePreviews((s) => s.filter((_, i) => i !== index));
  };

  async function getIdToken() {
    if (!auth.currentUser) throw new Error("You must be logged in.");
    return auth.currentUser.getIdToken();
  }

  async function startStagedUploads(idToken: string, files: File[]) {
    const payload = {
      files: files.map((f) => ({
        filename: f.name,
        mimeType: f.type || "image/jpeg",
        fileSize: f.size,
      })),
    };
    const r = await fetch("/api/admin/uploads/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (!r.ok || !j.ok)
      throw new Error(j.error || "stagedUploadsCreate failed");
    return j.targets as StagedTarget[];
  }

  async function uploadFileToShopify(target: StagedTarget, file: File) {
    const form = new FormData();
    for (const p of target.parameters) form.append(p.name, p.value);
    form.append("file", file); // must be 'file'
    const r = await fetch(target.url, { method: "POST", body: form });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new Error(`Upload failed (${r.status}) ${t}`);
    }
    return target.resourceUrl;
  }

  /** ====== ADD submit ====== */
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!auth.currentUser) return toast.error("Please login again.");

    const form = new FormData(e.currentTarget as HTMLFormElement);
    const title = String(form.get("title") || "").trim();
    const description = String(form.get("description") || "").trim();

    const rawPrice =
      basePriceInput !== "" ? basePriceInput : String(form.get("price") ?? "0");
    const parsedPrice = Number(rawPrice || 0);
    const price = Number.isFinite(parsedPrice)
      ? parsedPrice + (handleDeliveryCharge ? 100 : 0)
      : 0;
    const compareAtPriceRaw = String(form.get("compare-price") ?? "");
    const compareAtPrice =
      compareAtPriceRaw === "" ? NaN : Number(compareAtPriceRaw);
    const cost = Number(form.get("cost") || 0) || undefined;
    const barcode = String(form.get("barcode") || "").trim() || undefined;
    const weightGrams = Number(form.get("weight") || 0) || undefined;
    const quantityRaw = String(form.get("quantity") ?? "");
    const quantity = quantityRaw === "" ? NaN : Number(quantityRaw);

    const vendor = String(form.get("vendor") || "").trim();
    const productType =
      String(form.get("product-type") || "").trim() || undefined;
    const tagsCsv = String(form.get("tags") || "");
    const tags = tagsCsv
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const seoTitle = String(form.get("seo-title") || "").trim();
    const seoDescription = String(form.get("seo-description") || "").trim();

    const sku = String(form.get("sku") || "").trim();
    const measurements: ProductMeasurements = {
      bust: toNullableNumber(String(form.get("bust-size") ?? "")),
      waist: toNullableNumber(String(form.get("waist-size") ?? "")),
      hip: toNullableNumber(String(form.get("hip-size") ?? "")),
      length: toNullableNumber(String(form.get("length-size") ?? "")),
      unit: "in",
    };

    // --- required checks per your request ---
    if (selectedImages.length === 0)
      return toast.error("Please add at least one product image.");
    if (!title || !price) return toast.error("Please provide Title and Price.");
    if (Number.isNaN(compareAtPrice))
      return toast.error("Compare at Price is required.");
    if (!sku) return toast.error("SKU is required.");
    if (Number.isNaN(quantity)) return toast.error("Quantity is required.");
    if (!vendor) return toast.error("Vendor name is required.");
    if (!seoTitle || !seoDescription)
      return toast.error("SEO Title and SEO Description are required.");

    try {
      setBusy(true);
      const idToken = await getIdToken();

      const localFiles = selectedImages.slice(0, 5);
      let resourceUrls: string[] = [];
      if (localFiles.length) {
        const targets = await startStagedUploads(idToken, localFiles);
        if (targets.length !== localFiles.length)
          throw new Error("Upload target count mismatch");
        resourceUrls = [];
        for (let i = 0; i < localFiles.length; i++) {
          const url = await uploadFileToShopify(targets[i], localFiles[i]);
          resourceUrls.push(url);
        }
      }

      const enabledOptions = options.filter(
        (o) => (o?.name || "").trim() && o.values.length > 0,
      );
      let variantDraft:
        | undefined
        | {
            options: VariantOption[];
            variants: Omit<VariantRow, "id">[];
          } = undefined;

      if (enabledOptions.length > 0 && Object.keys(variantRows).length > 0) {
        const variants = Object.values(variantRows).map((v) => ({
          options: v.options,
          title: v.title,
          price: v.price,
          compareAtPrice: v.compareAtPrice,
          sku: (v.sku || "").trim() || undefined,
          quantity: v.quantity,
          barcode: (v.barcode || "").trim() || undefined,
          weightGrams: v.weightGrams,
          measurements: hasAnyMeasurement(v.measurements)
            ? v.measurements
            : null,
        }));
        variantDraft = { options: enabledOptions, variants };
      }

      const body = {
        title,
        description,
        price,
        compareAtPrice,
        barcode,
        weightGrams,
        inventory: {
          quantity,
          tracked: trackInventory === "yes",
          cost,
        },
        currency: "INR",
        tags,
        resourceUrls,
        vendor,
        productType,
        garmentCategory,
        fitType,
        status: statusSel,
        sku, // <-- send to server
        seo: { title: seoTitle, description: seoDescription },
        measurements,
        variantDraft,
      };

      const createRes = await fetch("/api/admin/products/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(body),
      });
      const j = await createRes.json().catch(() => ({}));
      if (!createRes.ok || !j.ok)
        throw new Error(j.error || "Create product failed");

      toast.success(
        "Product submitted for review. Admin will configure variants & publish.",
      );
      clearAddProductDraft(uid);
      setLocalDraft(null);
      setIsAddProductOpen(false);
      clearAddProductFormState(e.target as HTMLFormElement);
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || "Failed to create product");
    } finally {
      setBusy(false);
    }
  };

  /** ====== EDIT flow ====== */
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editing, setEditing] = useState<MerchantProduct | null>(null);

  // edit fields
  const [eTitle, setETitle] = useState("");
  const [eDescription, setEDescription] = useState("");
  const [ePrice, setEPrice] = useState<number | "">(""); // for single-variant/global
  const [eStock, setEStock] = useState<number | "">(""); // for single-variant/global
  const [eCompareAt, setECompareAt] = useState<number | "">("");
  const [eBarcode, setEBarcode] = useState("");
  const [eWeight, setEWeight] = useState<number | "">("");
  const [eProductType, setEProductType] = useState("");
  const [eVendor, setEVendor] = useState("");
  const [eTags, setETags] = useState("");
  const [eBustSize, setEBustSize] = useState<number | "">("");
  const [eWaistSize, setEWaistSize] = useState<number | "">("");
  const [eHipSize, setEHipSize] = useState<number | "">("");
  const [eLengthSize, setELengthSize] = useState<number | "">("");

  // existing variants (live) + images (live)
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [existingVariants, setExistingVariants] = useState<ExistingVariant[]>(
    [],
  );
  const [removeVariantIds, setRemoveVariantIds] = useState<
    Record<string, boolean>
  >({});
  const [variantQuickEdits, setVariantQuickEdits] = useState<
    Record<string, { price?: number | ""; quantity?: number | "" }>
  >({});
  const [variantMeasurementEdits, setVariantMeasurementEdits] = useState<
    Record<string, ProductMeasurements>
  >({});
  const [imagesLive, setImagesLive] = useState<string[]>([]);
  const [imageAddFiles, setImageAddFiles] = useState<File[]>([]);
  const [imageBusy, setImageBusy] = useState(false);
  const [deleteSel, setDeleteSel] = useState<Record<string, boolean>>({}); // url -> selected

  function markRemove(vid: string, checked: boolean) {
    setRemoveVariantIds((prev) => ({ ...prev, [vid]: checked }));
  }

  function setVariantEdit(
    vid: string,
    key: "price" | "quantity",
    value: number | "",
  ) {
    setVariantQuickEdits((prev) => ({
      ...prev,
      [vid]: { ...(prev[vid] || {}), [key]: value },
    }));
  }

  function setVariantMeasurementEdit(
    vid: string,
    key: "bust" | "waist" | "hip" | "length",
    value: string,
  ) {
    setVariantMeasurementEdits((prev) => ({
      ...prev,
      [vid]: {
        ...(prev[vid] || emptyMeasurements()),
        [key]: value === "" ? null : Number(value),
        unit: "in",
      },
    }));
  }

  async function fetchDetails(productId: string) {
    setLoadingDetails(true);
    try {
      const idToken = await getIdToken();
      const r = await fetch(`/api/admin/products/update`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ op: "details", id: productId }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok)
        throw new Error(j.error || "Failed to load product details");

      const prod = j.product || {};
      const variants: ExistingVariant[] = Array.isArray(prod.variants)
        ? prod.variants.map((v: any) => ({
            id: v.id,
            title: v.title || "",
            optionValues: Array.isArray(v.optionValues)
              ? v.optionValues
              : v.title
                ? String(v.title).split(" / ")
                : [],
            price: v.price != null ? Number(v.price) : undefined,
            quantity: v.quantity != null ? Number(v.quantity) : undefined,
            sku: v.sku || undefined,
            barcode: v.barcode || undefined,
            measurements: v.measurements || null,
          }))
        : [];

      setExistingVariants(variants);
      setRemoveVariantIds({});
      setVariantQuickEdits({});
      setVariantMeasurementEdits(
        variants.reduce<Record<string, ProductMeasurements>>((acc, variant) => {
          acc[variant.id] = variant.measurements || emptyMeasurements();
          return acc;
        }, {}),
      );
      setImagesLive(Array.isArray(prod.imagesLive) ? prod.imagesLive : []);
      setDeleteSel({});
      // planner defaults until details load
      setOptions([
        { name: "Size", values: [] },
        { name: "Color", values: [] },
      ]);
      setValueInputs(["", "", ""]);
      setVariantRows({});
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Failed to load product details");
    } finally {
      setLoadingDetails(false);
    }
  }

  function openEdit(p: MerchantProduct) {
    setEditing(p);
    setETitle(p.title || "");
    setEDescription(p.description || "");
    setEPrice(typeof p.price === "number" ? p.price : "");
    setEStock(typeof p.stock === "number" ? p.stock : "");
    setECompareAt("");
    setEBarcode("");
    setEWeight("");
    setEProductType(p.productType || "");
    setEVendor(p.vendor || "");
    setETags((p.tags || []).join(", "));
    setEBustSize(
      typeof p.measurements?.bust === "number" ? p.measurements.bust : "",
    );
    setEWaistSize(
      typeof p.measurements?.waist === "number" ? p.measurements.waist : "",
    );
    setEHipSize(
      typeof p.measurements?.hip === "number" ? p.measurements.hip : "",
    );
    setELengthSize(
      typeof p.measurements?.length === "number" ? p.measurements.length : "",
    );
    setImageAddFiles([]);
    setDeleteSel({});
    setVariantMeasurementEdits({});
    setIsEditOpen(true);
    fetchDetails(p.id); // fetch variants & images from Shopify
  }

  const handleEditProduct = (id: string) => {
    const p = products.find((x) => x.id === id);
    if (!p) return toast.error("Product not found");
    openEdit(p);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;

    try {
      const idToken = await getIdToken();

      const payload: any = { id: editing.id };

      // 1) LIVE updates (push instantly to Shopify)
      if (ePrice !== "" && ePrice !== editing.price)
        payload.price = Number(ePrice);
      if (eStock !== "" && eStock !== editing.stock)
        payload.stockQty = Number(eStock);

      // Per-variant live edits (price/qty)
      const variantUpdates = existingVariants
        .map((v) => {
          const edits = variantQuickEdits[v.id];
          if (!edits) return null;
          const upd: any = { id: v.id };
          if (
            edits.price !== "" &&
            Number(edits.price) !== (v.price ?? undefined)
          )
            upd.price = Number(edits.price as number);
          if (
            edits.quantity !== "" &&
            Number(edits.quantity) !== (v.quantity ?? undefined)
          )
            upd.quantity = Number(edits.quantity as number);
          return upd.price != null || upd.quantity != null ? upd : null;
        })
        .filter(Boolean) as Array<{
        id: string;
        price?: number;
        quantity?: number;
      }>;
      if (variantUpdates.length) payload.variants = variantUpdates;

      // 2) REVIEW updates (go to admin queue)
      if (eTitle.trim() && eTitle.trim() !== (editing.title || ""))
        payload.title = eTitle.trim();
      if (eDescription.trim() !== (editing.description || ""))
        payload.description = eDescription.trim();
      if (eProductType.trim() !== (editing.productType || ""))
        payload.productType = eProductType.trim();
      if (eVendor.trim() !== (editing.vendor || ""))
        payload.vendor = eVendor.trim();
      const newTags = eTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      if (JSON.stringify(newTags) !== JSON.stringify(editing.tags || []))
        payload.tags = newTags;
      if (eCompareAt !== "") payload.compareAtPrice = Number(eCompareAt);
      if (eBarcode.trim()) payload.barcode = eBarcode.trim();
      if (eWeight !== "") payload.weightGrams = Number(eWeight);

      const editedMeasurements: ProductMeasurements = {
        bust: eBustSize === "" ? null : Number(eBustSize),
        waist: eWaistSize === "" ? null : Number(eWaistSize),
        hip: eHipSize === "" ? null : Number(eHipSize),
        length: eLengthSize === "" ? null : Number(eLengthSize),
        unit: "in",
      };
      if (
        JSON.stringify(editedMeasurements) !==
        JSON.stringify(editing.measurements || null)
      ) {
        payload.measurements = editedMeasurements;
      }

      const toRemove = Object.entries(removeVariantIds)
        .filter(([, on]) => on)
        .map(([vid]) => vid);
      if (toRemove.length) payload.removeVariantIds = toRemove;

      const variantMeasurements = existingVariants
        .map((variant) => {
          const nextMeasurements =
            variantMeasurementEdits[variant.id] || emptyMeasurements();
          if (
            JSON.stringify(nextMeasurements) ===
            JSON.stringify(variant.measurements || emptyMeasurements())
          ) {
            return null;
          }
          return {
            variantId: variant.id,
            title: variant.title,
            optionValues: variant.optionValues,
            measurements: hasAnyMeasurement(nextMeasurements)
              ? nextMeasurements
              : null,
          };
        })
        .filter(Boolean);
      if (variantMeasurements.length)
        payload.variantMeasurements = variantMeasurements;

      const enabledOptions = options.filter(
        (o) => (o?.name || "").trim() && o.values.length > 0,
      );
      if (enabledOptions.length > 0 && Object.keys(variantRows).length > 0) {
        payload.variantDraft = {
          options: enabledOptions,
          variants: Object.values(variantRows).map((v) => ({
            options: v.options,
            title: v.title,
            price: v.price,
            compareAtPrice: v.compareAtPrice,
            sku: v.sku || undefined,
            quantity: v.quantity,
            barcode: v.barcode || undefined,
            weightGrams: v.weightGrams,
            measurements: hasAnyMeasurement(v.measurements)
              ? v.measurements
              : null,
          })),
        };
      }

      const r = await fetch("/api/admin/products/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || "Update failed");

      toast.success(
        j.review
          ? "Price/stock pushed. Other changes sent for review."
          : "Updated successfully.",
      );

      setIsEditOpen(false);
      setEditing(null);
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || "Failed to update product");
    }
  };

  /** ====== EDIT: image add/delete ====== */
  const onEditChooseImages = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setImageAddFiles((prev) => [...prev, ...files].slice(0, 10)); // cap to 10 in one go
  };

  const onEditAttachImages = async () => {
    if (!editing) return;
    if (!imageAddFiles.length)
      return toast.error("Please choose images first.");
    try {
      setImageBusy(true);
      const idToken = await getIdToken();

      // 1) stage via op: imagesStage
      const stageRes = await fetch("/api/admin/products/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          op: "imagesStage",
          files: imageAddFiles.map((f) => ({
            filename: f.name,
            mimeType: f.type || "image/jpeg",
            fileSize: f.size,
          })),
        }),
      });
      const stageJson = await stageRes.json();
      if (!stageRes.ok || !stageJson.ok)
        throw new Error(stageJson.error || "imagesStage failed");
      const targets: StagedTarget[] = stageJson.targets || [];
      if (targets.length !== imageAddFiles.length)
        throw new Error("Stage target count mismatch");

      // 2) upload each file to stage target
      const resourceUrls: string[] = [];
      for (let i = 0; i < imageAddFiles.length; i++) {
        const t = targets[i];
        const fd = new FormData();
        for (const p of t.parameters) fd.append(p.name, p.value);
        fd.append("file", imageAddFiles[i]);
        const up = await fetch(t.url, { method: "POST", body: fd });
        if (!up.ok) {
          const txt = await up.text().catch(() => "");
          throw new Error(`Upload failed (${up.status}) ${txt}`);
        }
        resourceUrls.push(t.resourceUrl);
      }

      // 3) attach to Shopify + mirror in Firestore
      const attachRes = await fetch("/api/admin/products/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          op: "imagesAttach",
          id: editing.id,
          resourceUrls,
        }),
      });
      const attachJson = await attachRes.json();
      if (!attachRes.ok || !attachJson.ok)
        throw new Error(attachJson.error || "imagesAttach failed");

      setImagesLive(attachJson.images || []);
      setImageAddFiles([]);
      toast.success("Images added.");
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Failed to add images");
    } finally {
      setImageBusy(false);
    }
  };

  const onEditDeleteSelected = async () => {
    if (!editing) return;
    const urls = Object.entries(deleteSel)
      .filter(([, on]) => on)
      .map(([u]) => u);
    if (!urls.length) return toast.error("Select images to remove.");
    try {
      setImageBusy(true);
      const idToken = await getIdToken();
      const delRes = await fetch("/api/admin/products/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ op: "imagesDelete", id: editing.id, urls }),
      });
      const j = await delRes.json();
      if (!delRes.ok || !j.ok)
        throw new Error(j.error || "imagesDelete failed");
      setImagesLive(j.images || []);
      setDeleteSel({});
      toast.success("Selected images removed.");
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Failed to remove images");
    } finally {
      setImageBusy(false);
    }
  };

  /** ====== DELETE flow (type SKU) ====== */
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MerchantProduct | null>(
    null,
  );
  const [typedSku, setTypedSku] = useState("");

  const handleDeleteProduct = (id: string) => {
    const p = products.find((x) => x.id === id);
    if (!p) return toast.error("Product not found");
    if (!p.sku) {
      return toast.error(
        "This product has no SKU recorded; cannot confirm deletion.",
      );
    }
    setDeleteTarget(p);
    setTypedSku("");
    setDeleteOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const required = normSku(deleteTarget.sku || "");
    if (!required) return toast.error("No SKU stored on product");
    if (normSku(typedSku) !== required)
      return toast.error("SKU does not match");

    try {
      const idToken = await getIdToken();
      const r = await fetch("/api/admin/products/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ op: "delete", id: deleteTarget.id, typedSku }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Delete failed");
      toast.success("Product deleted.");
      setDeleteOpen(false);
      setDeleteTarget(null);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Failed to delete product");
    }
  };

  /** ----- Bulk upload (unchanged logic) ----- */
  function norm(s: any) {
    return String(s ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "");
  }
  function num(v: any) {
    const n = Number(String(v).trim());
    return Number.isFinite(n) ? n : undefined;
  }
  function csvToArr(v: any) {
    return String(v || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  function boolFromCell(v: any, defaultVal = true) {
    const s = String(v ?? "")
      .trim()
      .toLowerCase();
    if (!s) return defaultVal;
    if (["yes", "y", "true", "1"].includes(s)) return true;
    if (["no", "n", "false", "0"].includes(s)) return false;
    return defaultVal;
  }
  function buildVariantDraft(row: any) {
    const o1n = row["option1name"] || row["option_1_name"];
    const o1v = row["option1values"] || row["option_1_values"];
    const o2n = row["option2name"] || row["option_2_name"];
    const o2v = row["option2values"] || row["option_2_values"];
    const o3n = row["option3name"] || row["option_3_name"];
    const o3v = row["option3values"] || row["option_3_values"];

    const options: Array<{ name: string; values: string[] }> = [];
    if (o1n && o1v)
      options.push({ name: String(o1n).trim(), values: csvToArr(o1v) });
    if (o2n && o2v)
      options.push({ name: String(o2n).trim(), values: csvToArr(o2v) });
    if (o3n && o3v)
      options.push({ name: String(o3n).trim(), values: csvToArr(o3v) });

    if (!options.length) return undefined;

    const lists = options.map((o) => o.values);
    const combos = cartesian(lists);
    const variants = combos.map((vals) => ({
      options: vals,
      title: vals.join(" / "),
      price: num(row["variantprice"]) ?? num(row["price"]),
      compareAtPrice:
        num(row["variantcompareat"]) ?? num(row["compareatprice"]) ?? undefined,
      sku: String(row["variantsku"] ?? "").trim() || undefined,
      quantity: num(row["variantqty"]) ?? num(row["quantity"]) ?? 0,
      barcode: String(row["variantbarcode"] ?? "").trim() || undefined,
      weightGrams:
        num(row["variantweightgrams"]) ?? num(row["weightgrams"]) ?? undefined,
    }));

    return { options, variants };
  }
  function rowToCreateBody(row: any) {
    const map: Record<string, any> = {};
    for (const [k, v] of Object.entries(row)) map[norm(k)] = v;

    const title = String(map["title"] ?? "").trim();
    const basePrice = num(map["price"]); // treat as base price
    if (!title || basePrice == null) throw new Error("Missing Title or Price");

    // NEW: delivery charge flag (defaults to true, like the Add form)
    const handleDelivery = boolFromCell(map["handledeliverycharge"], true);
    const price = basePrice + (handleDelivery ? 100 : 0);

    const compareAtPrice = num(map["compareatprice"]);
    const cost = num(map["cost"]);
    const barcode = String(map["barcode"] ?? "").trim() || undefined;
    const weightGrams = num(map["weightgrams"]);
    const quantity = num(map["quantity"]) ?? 0;

    const vendor = String(map["vendor"] ?? "").trim() || undefined;
    const productType = String(map["producttype"] ?? "").trim() || undefined;
    const tags = csvToArr(map["tags"]);
    const seoTitle = String(map["seotitle"] ?? "").trim() || undefined;
    const seoDescription =
      String(map["seodescription"] ?? "").trim() || undefined;
    const sku = String(map["sku"] ?? "").trim() || undefined;

    const resourceUrls = csvToArr(map["imageurls"]);
    const variantDraft = buildVariantDraft(map);
    const measurements: ProductMeasurements = {
      bust: num(map["bustsize"] ?? map["bust"]),
      waist: num(map["waistsize"] ?? map["waist"]),
      hip: num(map["hipsize"] ?? map["hip"]),
      length: num(map["lengthsize"] ?? map["length"]),
      unit: "in",
    };

    return {
      title,
      description: String(map["description"] ?? "").trim(),
      price, // <- final price with delivery logic applied
      compareAtPrice,
      barcode,
      weightGrams,
      inventory: {
        quantity,
        tracked: true,
        cost,
      },
      currency: "INR",
      tags,
      resourceUrls: resourceUrls.length ? resourceUrls : undefined,
      vendor,
      productType,
      status: "active",
      sku,
      seo:
        seoTitle || seoDescription
          ? { title: seoTitle, description: seoDescription }
          : undefined,
      measurements,
      variantDraft,
    };
  }
  async function parseWorkbook(file: File) {
    const XLSX = (await import("xlsx")).default || (await import("xlsx"));
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    return rows as any[];
  }
  async function runBulkUpload() {
    if (!bulkFile) {
      toast.error("Please choose a file");
      return;
    }
    if (!auth.currentUser) {
      toast.error("Please login again.");
      return;
    }
    setBulkRunning(true);
    setBulkErrors([]);
    setBulkDone(0);
    try {
      const rows = await parseWorkbook(bulkFile);
      setBulkTotal(rows.length);
      const idToken = await getIdToken();
      for (let i = 0; i < rows.length; i++) {
        try {
          const body = rowToCreateBody(rows[i]);
          const res = await fetch("/api/admin/products/create", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify(body),
          });
          const j = await res.json().catch(() => ({}));
          if (!res.ok || !j.ok) throw new Error(j.error || "Create failed");
        } catch (e: any) {
          setBulkErrors((prev) => [
            ...prev,
            { row: i + 2, error: e?.message || "Unknown error" },
          ]);
        } finally {
          setBulkDone((d) => d + 1);
        }
      }
      toast.success("Bulk upload finished.");
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Bulk upload failed");
    } finally {
      setBulkRunning(false);
    }
  }

  /** ----- UI ----- */
  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* ADD dialog */}
        <Dialog
          open={isAddProductOpen}
          onOpenChange={handleAddDialogOpenChange}
        >
          <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add New Product</DialogTitle>
            </DialogHeader>

            <form
              id="add-product-form"
              onSubmit={handleSubmit}
              className="space-y-8"
            >
              {/* Product Images (required) */}
              <div className="space-y-2">
                <Label>
                  Product Images (Min 1, Max 5){" "}
                  <span className="text-destructive">*</span>
                </Label>
                <div className="grid grid-cols-5 gap-4">
                  {imagePreviews.map((preview, index) => (
                    <div key={index} className="relative aspect-square">
                      <img
                        src={preview}
                        alt={`Preview ${index + 1}`}
                        className="w-full h-full object-cover rounded-md border"
                      />
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        className="absolute -top-2 -right-2 h-6 w-6 rounded-full"
                        onClick={() => removeLocalImage(index)}
                        title="Remove"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                  {selectedImages.length < 5 && (
                    <label className="aspect-square border-2 border-dashed rounded-md flex items-center justify-center cursor-pointer hover:bg-muted/50 transition-colors">
                      <div className="text-center">
                        <Upload className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">
                          Upload
                        </span>
                      </div>
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={handleImageSelect}
                      />
                    </label>
                  )}
                </div>
              </div>

              {/* Basic Info */}
              <div className="space-y-2">
                <Label htmlFor="title">Product Title *</Label>
                <Input
                  id="title"
                  name="title"
                  placeholder="E.g., Premium Cotton T-Shirt"
                  required
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description *</Label>
                <Textarea
                  id="description"
                  name="description"
                  placeholder="Describe your product..."
                  rows={4}
                  required
                  value={draftDescription}
                  onChange={(e) => setDraftDescription(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="price">Base Price (₹) *</Label>
                  <Input
                    id="price"
                    name="price"
                    type="number"
                    placeholder="999"
                    min={0}
                    step="0.01"
                    required
                    value={basePriceInput}
                    onChange={(e) => setBasePriceInput(e.target.value)}
                  />

                  {/* DELIVERY CHARGE CHECKBOX */}
                  <label className="inline-flex items-center gap-2 mt-2">
                    <input
                      type="checkbox"
                      checked={handleDeliveryCharge}
                      onChange={(e) =>
                        setHandleDeliveryCharge(e.target.checked)
                      }
                      className="h-4 w-4"
                    />
                    <span className="text-sm">
                      Pass the delivery charge to the customer
                    </span>
                  </label>

                  {/* FINAL BASE PRICE DISPLAY */}
                  <div className="mt-2 text-sm">
                    <span className="text-muted-foreground">
                      Final base price:{" "}
                    </span>
                    <span className="font-medium">
                      {/* compute final price for display (treat empty as 0) */}
                      ₹
                      {(
                        Number(basePriceInput || 0) +
                        (handleDeliveryCharge ? 100 : 0)
                      ).toLocaleString(undefined, {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      (
                      {handleDeliveryCharge
                        ? "+₹100 delivery"
                        : "no delivery added"}
                      )
                    </span>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="compare-price">
                    Compare at Price (₹){" "}
                    <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="compare-price"
                    name="compare-price"
                    type="number"
                    placeholder="1499"
                    min={0}
                    step="0.01"
                    required
                    value={draftComparePrice}
                    onChange={(e) => setDraftComparePrice(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="cost">Cost per Item (₹)</Label>
                  <Input
                    id="cost"
                    name="cost"
                    type="number"
                    placeholder="500"
                    min={0}
                    step="0.01"
                    value={draftCost}
                    onChange={(e) => setDraftCost(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sku">
                    SKU <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="sku"
                    name="sku"
                    placeholder="UNIQ-SKU-123"
                    required
                    value={draftSku}
                    onChange={(e) => setDraftSku(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="barcode">Barcode (ISBN, UPC, etc.)</Label>
                  <Input
                    id="barcode"
                    name="barcode"
                    placeholder="123456789"
                    value={draftBarcode}
                    onChange={(e) => setDraftBarcode(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="weight">Weight (grams)</Label>
                  <Input
                    id="weight"
                    name="weight"
                    type="number"
                    placeholder="500"
                    min={0}
                    value={draftWeight}
                    onChange={(e) => setDraftWeight(e.target.value)}
                  />
                </div>
              </div>

              {/* Inventory (base) */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="quantity">
                    Quantity <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="quantity"
                    name="quantity"
                    type="number"
                    placeholder="100"
                    min={0}
                    required
                    value={draftQuantity}
                    onChange={(e) => setDraftQuantity(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="track-inventory">Track Inventory</Label>
                  <Select
                    value={trackInventory}
                    onValueChange={(v) => setTrackInventory(v as any)}
                  >
                    <SelectTrigger id="track-inventory">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="yes">Yes</SelectItem>
                      <SelectItem value="no">No</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Product Measurements */}
              <div className="space-y-4 border-t pt-4">
                <div>
                  <h3 className="font-semibold">
                    Fallback Product Measurements
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Optional. Prefer size-wise measurements in the variant
                    table below. Use this only when a product has no size
                    variants.
                  </p>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="bust-size">Bust Size (in)</Label>
                    <Input
                      id="bust-size"
                      name="bust-size"
                      type="number"
                      min={0}
                      step="0.1"
                      placeholder="e.g. 34"
                      value={draftBustSize}
                      onChange={(e) => setDraftBustSize(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="waist-size">Waist Size (in)</Label>
                    <Input
                      id="waist-size"
                      name="waist-size"
                      type="number"
                      min={0}
                      step="0.1"
                      placeholder="e.g. 28"
                      value={draftWaistSize}
                      onChange={(e) => setDraftWaistSize(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="hip-size">Hip Size (in)</Label>
                    <Input
                      id="hip-size"
                      name="hip-size"
                      type="number"
                      min={0}
                      step="0.1"
                      placeholder="e.g. 36"
                      value={draftHipSize}
                      onChange={(e) => setDraftHipSize(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="length-size">Length Size (in)</Label>
                    <Input
                      id="length-size"
                      name="length-size"
                      type="number"
                      min={0}
                      step="0.1"
                      placeholder="e.g. 24"
                      value={draftLengthSize}
                      onChange={(e) => setDraftLengthSize(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Product meta */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="product-type">Product Type</Label>
                  <Input
                    id="product-type"
                    required
                    name="product-type"
                    placeholder="T-Shirts"
                    value={draftProductType}
                    onChange={(e) => setDraftProductType(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="vendor">
                    Vendor <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="vendor"
                    name="vendor"
                    placeholder="Brand name"
                    required
                    value={draftVendor}
                    onChange={(e) => setDraftVendor(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="tags">Tags (comma-separated)</Label>
                <Input
                  id="tags"
                  name="tags"
                  placeholder="casual, cotton, comfortable"
                  value={draftTags}
                  onChange={(e) => setDraftTags(e.target.value)}
                />
              </div>

              {/* ===== Variants (plan for Admin) ===== */}
              <VariantPlanner
                garmentCategory={garmentCategory}
                fitType={fitType}
                setGarmentCategory={setGarmentCategory}
                setFitType={setFitType}
                generateVariants={generateVariants}
                options={options}
                setOptionName={setOptionName}
                removeOptionRow={removeOptionRow}
                valueInputs={valueInputs}
                setValueInputs={setValueInputs}
                addValue={addValue}
                removeValue={removeValue}
                addOptionRow={addOptionRow}
                comboKeys={comboKeys}
                variantRows={variantRows}
                setVariantRows={setVariantRows}
              />

              {/* SEO (required) */}
              <div className="space-y-4 border-t pt-4">
                <h3 className="font-semibold">
                  Search Engine Listing{" "}
                  <span className="text-destructive">*</span>
                </h3>
                <div className="space-y-2">
                  <Label htmlFor="seo-title">SEO Title</Label>
                  <Input
                    id="seo-title"
                    name="seo-title"
                    placeholder="Effective SEO Title..."
                    required
                    value={draftSeoTitle}
                    onChange={(e) => setDraftSeoTitle(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="seo-description">SEO Description</Label>
                  <Textarea
                    id="seo-description"
                    name="seo-description"
                    placeholder="High quality cotton t-shirt, comfortable and stylish..."
                    rows={3}
                    value={draftSeoDesc}
                    onChange={(e) => setDraftSeoDesc(e.target.value)}
                    required
                  />
                </div>
              </div>

              {/* Status */}
              <div className="space-y-2">
                <Label htmlFor="status">Product Status</Label>
                <Select
                  value={statusSel}
                  onValueChange={(v) => setStatusSel(v as any)}
                >
                  <SelectTrigger id="status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  If variants are provided, the server will send the product for{" "}
                  <b>Review</b> and mark it's status as <b>In review</b>.
                </p>
              </div>

              {/* Add form actions: Save draft, Discard, Submit */}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    clearAddProductDraft(uid);
                    setLocalDraft(null);
                    clearAddProductFormState(
                      document.getElementById(
                        "add-product-form",
                      ) as HTMLFormElement | null,
                    );
                    toast.success("Draft discarded.");
                  }}
                >
                  Clear Form
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const draft = readCurrentAddDraft();
                    saveAddProductDraft(uid, () => draft);
                    setLocalDraft(draft);
                    toast.success(
                      "Local draft saved and added to product list.",
                    );
                  }}
                >
                  Save Draft Locally
                </Button>

                <Button type="submit" disabled={busy}>
                  {busy ? "Submitting…" : "Submit for review"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* Header + Add */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Products</h2>
            <p className="text-muted-foreground">
              Manage your product inventory
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => setIsBulkOpen(true)}
            className="gap-2"
          >
            <Upload className="h-4 w-4" />
            Bulk upload
          </Button>
          <Button onClick={handleAddProduct} className="gap-2">
            <Plus className="h-4 w-4" />
            Add Product
          </Button>
        </div>

        {/* List */}
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
              <CardTitle>All Products</CardTitle>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search products..."
                  className="pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((p) => {
                    const isLocalDraft = p.isLocalDraft === true;
                    const img = isLocalDraft
                      ? p.imagePreview || ""
                      : p.image || (p.images?.[0] ?? "");
                    const statusClass = isLocalDraft
                      ? "bg-purple-500/10 text-purple-700 border-purple-500/20"
                      : p.status === "approved"
                        ? "bg-green-500/10 text-green-700 border-green-500/20"
                        : p.status === "pending"
                          ? "bg-yellow-500/10 text-yellow-700 border-yellow-500/20"
                          : p.status === "update_in_review"
                            ? "bg-blue-500/10 text-blue-700 border-blue-500/20"
                            : "bg-muted text-muted-foreground border-muted";
                    const statusText = isLocalDraft
                      ? "Local draft"
                      : p.status === "approved"
                        ? "Active"
                        : p.status === "pending"
                          ? "In review"
                          : p.status === "update_in_review"
                            ? "Update in review"
                            : "Rejected";
                    return (
                      <TableRow key={p.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <img
                              src={img || "https://placehold.co/64x64?text=IMG"}
                              alt={p.title}
                              className="h-10 w-10 rounded-md object-cover bg-muted"
                            />
                            <div className="flex flex-col">
                              <span className="font-medium">{p.title}</span>
                              {p.sku ? (
                                <span className="text-xs text-muted-foreground">
                                  SKU: {p.sku}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>{p.productType || "-"}</TableCell>
                        <TableCell>
                          {p.price != null
                            ? `₹${Number(p.price).toLocaleString()}`
                            : "-"}
                        </TableCell>
                        <TableCell>
                          <Badge className={statusClass}>{statusText}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            {isLocalDraft ? (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={handleAddProduct}
                                  title="Edit local draft"
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => {
                                    clearAddProductDraft(uid);
                                    setLocalDraft(null);
                                    toast.success("Local draft removed.");
                                  }}
                                  title="Remove local draft"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </>
                            ) : (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleEditProduct(p.id)}
                                  title="Edit"
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleDeleteProduct(p.id)}
                                  title="Delete"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="text-center text-muted-foreground"
                      >
                        No products yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* EDIT dialog */}
        <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
          <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Product</DialogTitle>
            </DialogHeader>

            {editing && (
              <form onSubmit={handleEditSubmit} className="space-y-6">
                {/* Basics */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Title</Label>
                    <Input
                      value={eTitle}
                      onChange={(e) => setETitle(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Product Type</Label>
                    <Input
                      value={eProductType}
                      onChange={(e) => setEProductType(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea
                    value={eDescription}
                    onChange={(e) => setEDescription(e.target.value)}
                    rows={4}
                  />
                </div>

                {/* Global quick (for single-variant products) */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Price (₹) — pushes live immediately</Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={ePrice}
                      onChange={(e) =>
                        setEPrice(
                          e.target.value === "" ? "" : Number(e.target.value),
                        )
                      }
                      placeholder="Leave unchanged to keep current"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Stock (Qty) — pushes live immediately</Label>
                    <Input
                      type="number"
                      min={0}
                      value={eStock}
                      onChange={(e) =>
                        setEStock(
                          e.target.value === "" ? "" : Number(e.target.value),
                        )
                      }
                      placeholder="Leave unchanged to keep current"
                    />
                  </div>
                </div>

                {/* Other review fields */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Compare at (₹)</Label>
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      value={eCompareAt}
                      onChange={(e) =>
                        setECompareAt(
                          e.target.value === "" ? "" : Number(e.target.value),
                        )
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Barcode</Label>
                    <Input
                      value={eBarcode}
                      onChange={(e) => setEBarcode(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Weight (grams)</Label>
                    <Input
                      type="number"
                      min={0}
                      value={eWeight}
                      onChange={(e) =>
                        setEWeight(
                          e.target.value === "" ? "" : Number(e.target.value),
                        )
                      }
                    />
                  </div>
                </div>

                <div className="space-y-4 border-t pt-4">
                  <div>
                    <h3 className="font-semibold">
                      Fallback Product Measurements
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Optional fallback for products without size variants.
                      Size-wise variant measurements below are used first for AI
                      fit verification.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="space-y-2">
                      <Label>Bust Size (in)</Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.1"
                        value={eBustSize}
                        onChange={(e) =>
                          setEBustSize(
                            e.target.value === "" ? "" : Number(e.target.value),
                          )
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Waist Size (in)</Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.1"
                        value={eWaistSize}
                        onChange={(e) =>
                          setEWaistSize(
                            e.target.value === "" ? "" : Number(e.target.value),
                          )
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Hip Size (in)</Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.1"
                        value={eHipSize}
                        onChange={(e) =>
                          setEHipSize(
                            e.target.value === "" ? "" : Number(e.target.value),
                          )
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Length Size (in)</Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.1"
                        value={eLengthSize}
                        onChange={(e) =>
                          setELengthSize(
                            e.target.value === "" ? "" : Number(e.target.value),
                          )
                        }
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Vendor</Label>
                    <Input
                      value={eVendor}
                      onChange={(e) => setEVendor(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Tags (comma-separated)</Label>
                    <Input
                      value={eTags}
                      onChange={(e) => setETags(e.target.value)}
                    />
                  </div>
                </div>

                {/* Images (live) */}
                <div className="border-t pt-4 space-y-3">
                  <h3 className="font-semibold">Product Images (live)</h3>

                  <div className="flex items-center gap-2">
                    <Label className="inline-flex items-center gap-2 px-3 py-2 border rounded-md cursor-pointer">
                      <ImagePlus className="h-4 w-4" />
                      <span>Choose files</span>
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={onEditChooseImages}
                      />
                    </Label>
                    <Button
                      type="button"
                      onClick={onEditAttachImages}
                      disabled={imageBusy || imageAddFiles.length === 0}
                    >
                      {imageBusy
                        ? "Adding…"
                        : `Add selected images (${imageAddFiles.length})`}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={onEditDeleteSelected}
                      disabled={
                        imageBusy || !Object.values(deleteSel).some(Boolean)
                      }
                    >
                      <ImageMinus className="h-4 w-4 mr-2" />
                      {imageBusy ? "Removing…" : "Remove selected"}
                    </Button>
                  </div>

                  {loadingDetails ? (
                    <div className="text-sm text-muted-foreground">
                      Loading images…
                    </div>
                  ) : imagesLive.length === 0 ? (
                    <div className="text-sm text-muted-foreground">
                      No images.
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                      {imagesLive.map((u) => (
                        <label
                          key={u}
                          className={`relative block rounded-md overflow-hidden border cursor-pointer ${deleteSel[u] ? "ring-2 ring-destructive" : ""}`}
                        >
                          <img
                            src={u}
                            alt="img"
                            className="w-full h-40 object-cover"
                          />
                          <div className="absolute top-2 left-2 bg-white/80 px-1.5 py-0.5 rounded text-xs">
                            <input
                              type="checkbox"
                              checked={!!deleteSel[u]}
                              onChange={(e) =>
                                setDeleteSel((prev) => ({
                                  ...prev,
                                  [u]: e.target.checked,
                                }))
                              }
                            />{" "}
                            Delete
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                {/* Existing variants (live) */}
                <div className="border-t pt-4">
                  <h3 className="font-semibold mb-2">
                    Existing variants (live)
                  </h3>
                  {loadingDetails ? (
                    <div className="text-sm text-muted-foreground">
                      Loading variants…
                    </div>
                  ) : existingVariants.length === 0 ? (
                    <div className="text-sm text-muted-foreground">
                      No variants found.
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-md border">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="text-left p-2">Variant</th>
                            <th className="text-left p-2">SKU</th>
                            <th className="text-left p-2">Barcode</th>
                            <th className="text-left p-2">Price (₹)</th>
                            <th className="text-left p-2">Stock</th>
                            <th className="text-left p-2">Chest/Bust (in)</th>
                            <th className="text-left p-2">Waist (in)</th>
                            <th className="text-left p-2">Hip (in)</th>
                            <th className="text-left p-2">Length (in)</th>
                            <th className="text-left p-2">Remove?</th>
                          </tr>
                        </thead>
                        <tbody>
                          {existingVariants.map((v) => {
                            const edits = variantQuickEdits[v.id] || {};
                            const measurements =
                              variantMeasurementEdits[v.id] ||
                              v.measurements ||
                              emptyMeasurements();
                            return (
                              <tr key={v.id} className="border-t">
                                <td className="p-2">
                                  {v.optionValues?.join(" / ") || v.title}
                                </td>
                                <td className="p-2">{v.sku || "—"}</td>
                                <td className="p-2">{v.barcode || "—"}</td>
                                <td className="p-2 w-[160px]">
                                  <Input
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    value={edits.price ?? v.price ?? ""}
                                    onChange={(e) =>
                                      setVariantEdit(
                                        v.id,
                                        "price",
                                        e.target.value === ""
                                          ? ""
                                          : Number(e.target.value),
                                      )
                                    }
                                  />
                                </td>
                                <td className="p-2 w-[140px]">
                                  <Input
                                    type="number"
                                    min={0}
                                    value={edits.quantity ?? v.quantity ?? ""}
                                    onChange={(e) =>
                                      setVariantEdit(
                                        v.id,
                                        "quantity",
                                        e.target.value === ""
                                          ? ""
                                          : Number(e.target.value),
                                      )
                                    }
                                  />
                                </td>
                                {(["bust", "waist", "hip", "length"] as const).map(
                                  (field) => (
                                    <td key={field} className="p-2 w-[140px]">
                                      <Input
                                        type="number"
                                        min={0}
                                        step="0.1"
                                        value={measurements[field] ?? ""}
                                        onChange={(event) =>
                                          setVariantMeasurementEdit(
                                            v.id,
                                            field,
                                            event.target.value,
                                          )
                                        }
                                      />
                                    </td>
                                  ),
                                )}
                                <td className="p-2 w-[100px]">
                                  <label className="inline-flex items-center gap-2 text-xs">
                                    <input
                                      type="checkbox"
                                      checked={!!removeVariantIds[v.id]}
                                      onChange={(e) =>
                                        markRemove(v.id, e.target.checked)
                                      }
                                    />
                                    Remove
                                  </label>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground mt-2">
                    Editing price/stock above updates Store instantly. Variant
                    measurements, removing variants, and any other changes go
                    to admin for review.
                  </p>
                </div>

                {/* Add more variants (planner → review) */}
                <div className="border-t pt-4">
                  <h3 className="font-semibold mb-2">
                    Add more variants (sent to admin)
                  </h3>
                  <VariantPlanner
                    garmentCategory={garmentCategory}
                    fitType={fitType}
                    setGarmentCategory={setGarmentCategory}
                    setFitType={setFitType}
                    generateVariants={generateVariants}
                    options={options}
                    setOptionName={setOptionName}
                    removeOptionRow={removeOptionRow}
                    valueInputs={valueInputs}
                    setValueInputs={setValueInputs}
                    addValue={addValue}
                    removeValue={removeValue}
                    addOptionRow={addOptionRow}
                    comboKeys={comboKeys}
                    variantRows={variantRows}
                    setVariantRows={setVariantRows}
                  />
                </div>

                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsEditOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit">Save changes</Button>
                </div>
              </form>
            )}
          </DialogContent>
        </Dialog>

        {/* DELETE dialog (type SKU) */}
        <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Delete Product</DialogTitle>
            </DialogHeader>
            {deleteTarget ? (
              <div className="space-y-4">
                <div className="border rounded-md p-3 space-y-1 text-sm">
                  <div>
                    <span className="font-medium">Title:</span>{" "}
                    {deleteTarget.title}
                  </div>
                  <div>
                    <span className="font-medium">Price:</span>{" "}
                    {deleteTarget.price != null
                      ? `₹${deleteTarget.price}`
                      : "-"}
                  </div>
                  <div>
                    <span className="font-medium">SKU:</span>{" "}
                    {deleteTarget.sku || "—"}
                  </div>
                </div>
                <p className="text-sm">
                  Type the SKU exactly to confirm deletion. This will remove the
                  product from Drippr Store and mark it deleted here.
                </p>
                <div className="space-y-2">
                  <Label>Confirm by typing SKU</Label>
                  <Input
                    value={typedSku}
                    onChange={(e) => setTypedSku(e.target.value)}
                    placeholder="Enter SKU"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setDeleteOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={confirmDelete}
                    disabled={
                      !deleteTarget.sku ||
                      normSku(typedSku) !== normSku(deleteTarget.sku)
                    }
                  >
                    Confirm delete
                  </Button>
                </div>
              </div>
            ) : null}
          </DialogContent>
        </Dialog>

        {/* BULK dialog (unchanged) */}
        <Dialog open={isBulkOpen} onOpenChange={setIsBulkOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Bulk Product Upload</DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Upload file (.xlsx or .csv)</Label>
                <Input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => setBulkFile(e.target.files?.[0] || null)}
                  disabled={bulkRunning}
                />
                <p className="text-xs text-muted-foreground">
                  Use the provided template that you can{" "}
                  <a
                    href="https://seller.drippr.in/download/DRIPPR_Bulk_Template_Empty_D1.xlsx"
                    className="text-blue-500"
                    target="_blank"
                  >
                    download from here
                  </a>
                  . The first sheet’s first row must be headers. See the sample
                  file{" "}
                  <a
                    href="https://seller.drippr.in/download/DRIPPR_Bulk_Template_Sample_D1.xlsx"
                    className="text-blue-500"
                    target="_blank"
                  >
                    here
                  </a>
                  .
                </p>
              </div>

              {/* Progress */}
              {bulkRunning || bulkDone > 0 ? (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Progress</span>
                    <span>
                      {bulkDone}/{bulkTotal}
                    </span>
                  </div>
                  <div className="h-2 w-full rounded bg-muted overflow-hidden">
                    <div
                      className="h-2 bg-primary transition-all"
                      style={{
                        width: bulkTotal
                          ? `${Math.floor((bulkDone / bulkTotal) * 100)}%`
                          : "0%",
                      }}
                    />
                  </div>
                  {!!bulkErrors.length && (
                    <div className="rounded-md border p-2 max-h-40 overflow-auto text-xs">
                      {bulkErrors.map((e, i) => (
                        <div key={i}>
                          Row {e.row}: {e.error}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}

              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setIsBulkOpen(false)}
                  disabled={bulkRunning}
                >
                  Close
                </Button>
                <Button
                  onClick={runBulkUpload}
                  disabled={!bulkFile || bulkRunning}
                >
                  {bulkRunning ? "Uploading…" : "Start upload"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}

/** ---- Small reusable section for the variant plan UI ---- */
function VariantPlanner(props: {
  garmentCategory: GarmentCategory;
  fitType: FitType;
  setGarmentCategory: (category: GarmentCategory) => void;
  setFitType: (fit: FitType) => void;
  generateVariants: (category?: GarmentCategory, fit?: FitType) => void;
  options: VariantOption[];
  setOptionName: (i: number, name: string) => void;
  removeOptionRow: (i: number) => void;
  valueInputs: string[];
  setValueInputs: React.Dispatch<React.SetStateAction<string[]>>;
  addValue: (i: number) => void;
  removeValue: (i: number, v: string) => void;
  addOptionRow: () => void;
  comboKeys: string[][];
  variantRows: Record<string, VariantRow>;
  setVariantRows: React.Dispatch<
    React.SetStateAction<Record<string, VariantRow>>
  >;
}) {
  const {
    garmentCategory,
    fitType,
    setGarmentCategory,
    setFitType,
    generateVariants,
    options,
    setOptionName,
    removeOptionRow,
    valueInputs,
    setValueInputs,
    addValue,
    removeValue,
    addOptionRow,
    comboKeys,
    variantRows,
    setVariantRows,
  } = props;

  const measurementFields =
    garmentCategory === "Tops"
      ? (["chest", "length", "shoulder"] as const)
      : (["waist", "hip", "inseam"] as const);
  const measurementLabels: Record<string, string> = {
    chest: "Chest (in)",
    length: "Length (in)",
    shoulder: "Shoulder (in)",
    waist: "Waist (in)",
    hip: "Hip (in)",
    inseam: "Inseam (in)",
  };

  return (
    <div className="space-y-3">
      {/* Options editor */}
      <div className="grid gap-4">
        {options.map((opt, idx) => (
          <div key={idx} className="rounded-md border p-3 space-y-3">
            <div className="flex items-center gap-2">
              <Label className="min-w-[80px]">Option {idx + 1}</Label>
              <Input
                value={opt.name}
                onChange={(e) => setOptionName(idx, e.target.value)}
                placeholder={
                  idx === 0 ? "Size" : idx === 1 ? "Color" : "Material"
                }
                className="max-w-xs"
              />
              {options.length > 1 && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => removeOptionRow(idx)}
                  className="ml-auto"
                >
                  Remove
                </Button>
              )}
            </div>

            {/* Values pills */}
            <div className="flex flex-wrap gap-2">
              {opt.values.map((v) => (
                <Badge
                  key={v}
                  variant="outline"
                  className="cursor-pointer"
                  onClick={() => removeValue(idx, v)}
                  title="Click to remove"
                >
                  {v} <span className="ml-1 opacity-60">×</span>
                </Badge>
              ))}
            </div>

            {/* Add values */}
            <div className="flex items-center gap-2">
              <Input
                value={valueInputs[idx] || ""}
                onChange={(e) =>
                  setValueInputs((prev) =>
                    prev.map((v, i) => (i === idx ? e.target.value : v)),
                  )
                }
                placeholder="Enter values (comma separated), press Add"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => addValue(idx)}
              >
                Add
              </Button>
            </div>
          </div>
        ))}

        {options.length < 3 && (
          <Button
            type="button"
            variant="outline"
            onClick={addOptionRow}
            className="w-fit"
          >
            + Add another option
          </Button>
        )}
      </div>

      <div className="grid gap-3 rounded-md border bg-muted/20 p-3 md:grid-cols-[180px_180px_auto] md:items-end">
        <div className="space-y-2">
          <Label>Garment category</Label>
          <Select
            value={garmentCategory}
            onValueChange={(value) => {
              const nextCategory = value as GarmentCategory;
              setGarmentCategory(nextCategory);
              generateVariants(nextCategory, fitType);
            }}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Tops">Tops</SelectItem>
              <SelectItem value="Bottoms">Bottoms</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Fit type</Label>
          <Select
            value={fitType}
            onValueChange={(value) => {
              const nextFit = value as FitType;
              setFitType(nextFit);
              generateVariants(garmentCategory, nextFit);
            }}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Slim">Slim</SelectItem>
              <SelectItem value="Regular">Regular</SelectItem>
              <SelectItem value="Oversized">Oversized</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button type="button" variant="secondary" onClick={() => generateVariants()}>
          Auto-fill measurements
        </Button>
      </div>

      {/* Variants grid (new additions only) */}
      {comboKeys.length > 0 && (
        <div className="space-y-2">
          <Label>Variant combinations (to add)</Label>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[1240px] table-fixed text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="w-[140px] text-left p-2">Variant</th>
                  <th className="w-[125px] text-left p-2">Price (₹)</th>
                  <th className="w-[140px] text-left p-2">Compare at (₹)</th>
                  <th className="w-[160px] text-left p-2">SKU (optional)</th>
                  <th className="w-[90px] text-left p-2">Qty</th>
                  <th className="w-[140px] text-left p-2">Barcode</th>
                  <th className="w-[105px] text-left p-2">Weight (g)</th>
                  {measurementFields.map((field) => (
                    <th key={field} className="w-[115px] text-left p-2">
                      {measurementLabels[field]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comboKeys.map((combo) => {
                  const key = combo.join("|");
                  const row = variantRows[key];
                  return (
                    <tr key={key} className="border-t">
                      <td className="p-2">{row?.title || combo.join(" / ")}</td>
                      <td className="p-2">
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={row?.price ?? ""}
                          onChange={(e) =>
                            setVariantRows((prev) => ({
                              ...prev,
                              [key]: {
                                ...prev[key]!,
                                price: e.target.value
                                  ? Number(e.target.value)
                                  : undefined,
                              },
                            }))
                          }
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={row?.compareAtPrice ?? ""}
                          onChange={(e) =>
                            setVariantRows((prev) => ({
                              ...prev,
                              [key]: {
                                ...prev[key]!,
                                compareAtPrice: e.target.value
                                  ? Number(e.target.value)
                                  : undefined,
                              },
                            }))
                          }
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          value={row?.sku ?? ""}
                          onChange={(e) =>
                            setVariantRows((prev) => ({
                              ...prev,
                              [key]: { ...prev[key]!, sku: e.target.value },
                            }))
                          }
                          placeholder="optional"
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          type="number"
                          min={0}
                          value={row?.quantity ?? ""}
                          onChange={(e) =>
                            setVariantRows((prev) => ({
                              ...prev,
                              [key]: {
                                ...prev[key]!,
                                quantity: e.target.value
                                  ? Number(e.target.value)
                                  : undefined,
                              },
                            }))
                          }
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          value={row?.barcode ?? ""}
                          onChange={(e) =>
                            setVariantRows((prev) => ({
                              ...prev,
                              [key]: { ...prev[key]!, barcode: e.target.value },
                            }))
                          }
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          type="number"
                          min={0}
                          value={row?.weightGrams ?? ""}
                          onChange={(e) =>
                            setVariantRows((prev) => ({
                              ...prev,
                              [key]: {
                                ...prev[key]!,
                                weightGrams: e.target.value
                                  ? Number(e.target.value)
                                  : undefined,
                              },
                            }))
                          }
                        />
                      </td>
                      {measurementFields.map(
                        (field) => (
                          <td key={field} className="p-2">
                            <Input
                              type="number"
                              min={0}
                              step="0.1"
                              value={row?.measurements?.[field] ?? ""}
                              onChange={(e) =>
                                setVariantRows((prev) => ({
                                  ...prev,
                                  [key]: {
                                    ...prev[key]!,
                                    measurements: {
                                      ...(prev[key]?.measurements ||
                                        emptyMeasurements()),
                                      [field]: e.target.value
                                        ? Number(e.target.value)
                                        : null,
                                      unit: "in",
                                    },
                                  },
                                }))
                              }
                            />
                          </td>
                        ),
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            These are <b>proposed additions</b>. Admin will review them before
            they go live. Add measurements per size/variant; the AI stylist
            uses these values before product-level fallback measurements.
          </p>
        </div>
      )}
    </div>
  );
}
