import { useEffect, useMemo, useRef, useState } from "react";
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
  ChevronsUpDown,
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
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
import { GARMENT_SIZES, measurementsForVariant, sizesForCategory } from "@/lib/sizing";

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
  collections?: string[];
  status?:
    | "pending"
    | "approved"
    | "rejected"
    | "update_in_review"
    | "deleted"
    | "local_draft"
    | "active";
  shopifyProductId?: string | null;
  shopifyStatus?: "ACTIVE" | "DRAFT" | "ARCHIVED" | "DELETED" | string | null;
  published?: boolean;
  images?: string[];
  imageUrls?: string[];
  image?: string | null;
  createdAt?: number;
  sku?: string; // now used for delete confirmation & required on create
  stock?: number;
  tags?: string[];
  vendor?: string | null;
  measurements?: ProductMeasurements | null;
  compareAtPrice?: number | null;
  barcode?: string | null;
  weightGrams?: number | null;
  seo?: { title?: string; description?: string } | null;
  draft?: AddProductDraft;
};

type AddProductDraft = {
  id: string;
  createdAt: number;
  updatedAt: number;
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
  customProductType?: boolean;
  collections?: string[];
  tags?: string[];
  seoTitle?: string;
  seoDescription?: string;
  sku?: string;
  trackInventory?: "yes" | "no";
  statusSel?: "active" | "draft";
  handleDeliveryCharge?: boolean;
  imagePreviews?: string[]; // data URLs
  variantColorImagePreviews?: Record<string, string[]>; // data URLs by color
  options?: VariantOption[];
  garmentCategory?: GarmentCategory;
  fitType?: FitType;
  fallbackSize?: string;
  variantMode?: "single" | "multiple";
  singleColor?: string;
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

const PRODUCT_TYPE_OPTIONS = [
  "Athleisure",
  "Cargo Pants",
  "Cord Set",
  "Dress",
  "Hood",
  "Hoodie",
  "Jacket",
  "Oversize T-Shirt",
  "Shorts",
  "Sweater",
  "Sweatshirts",
  "T-Shirt",
  "Tank Top",
  "Top",
  "Tops & Dresses",
] as const;

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

type ExistingVariant = {
  id: string; // Shopify GID
  title: string;
  optionValues: string[]; // ["Red","M"]
  price?: number;
  compareAtPrice?: number;
  quantity?: number;
  sku?: string;
  barcode?: string;
  measurements?: ProductMeasurements | null;
  mediaUrls?: string[];
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

function uniqueImageUrls(urls: unknown[]) {
  return [
    ...new Set(
      urls.map((url) => String(url || "").trim()).filter(Boolean),
    ),
  ];
}

function hasMeaningfulAddDraft(draft: Partial<AddProductDraft>) {
  return Boolean(
    draft.title?.trim() ||
      draft.description?.trim() ||
      draft.vendor?.trim() ||
      draft.sku?.trim() ||
      draft.productType?.trim() ||
      draft.basePriceInput ||
      draft.compareAtPrice != null ||
      draft.quantity != null ||
      draft.singleColor?.trim() ||
      (draft.imagePreviews?.length ?? 0) > 0 ||
      Object.values(draft.variantColorImagePreviews || {}).some(
        (previews) => previews.length > 0,
      ) ||
      (draft.options || []).some((option) => option.values.length > 0) ||
      (draft.variantRows?.length ?? 0) > 0 ||
      hasAnyMeasurement(draft.measurements),
  );
}

// ---------------- Draft helpers ----------------
function getAddProductDraftKey(uid: string | null) {
  return `addProductDrafts:${uid ?? "anonymous"}`;
}

function getLegacyAddProductDraftKey(uid: string | null) {
  return `addProductDraft:${uid ?? "anonymous"}`;
}

function createDraftId() {
  return globalThis.crypto?.randomUUID?.() ??
    `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function cloudSafeAddDraft(draft: AddProductDraft): AddProductDraft {
  const keepRemotePreview = (url: string) => /^https?:\/\//i.test(url);
  const variantColorImagePreviews = Object.fromEntries(
    Object.entries(draft.variantColorImagePreviews || {})
      .map(([color, previews]) => [
        color,
        (previews || []).filter(keepRemotePreview).slice(0, 5),
      ])
      .filter(([, previews]) => previews.length),
  );
  return {
    ...draft,
    imagePreviews: (draft.imagePreviews || [])
      .filter(keepRemotePreview)
      .slice(0, 5),
    variantColorImagePreviews,
  };
}

async function syncAddProductDraftToCloud(
  draft: AddProductDraft,
  uid: string | null,
) {
  const idToken = await auth.currentUser?.getIdToken();
  if (!uid || !idToken) return;
  await fetch("/api/admin/products/update", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      op: "draftSave",
      draft: cloudSafeAddDraft(draft),
    }),
  }).catch((err) => console.warn("Failed to sync draft to cloud", err));
}

async function deleteAddProductDraftFromCloud(
  draftId: string | null | undefined,
  uid: string | null,
) {
  const idToken = await auth.currentUser?.getIdToken();
  if (!uid || !idToken || !draftId) return;
  await fetch("/api/admin/products/update", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ op: "draftDelete", draftId }),
  }).catch((err) => console.warn("Failed to delete cloud draft", err));
}

async function saveAddProductDraft(
  uid: string | null,
  stateReader: () => Partial<AddProductDraft>,
) {
  if (!uid) return;
  try {
    const key = getAddProductDraftKey(uid);
    const draft = stateReader();
    if (!draft.id) return;
    const existing = await loadAddProductDrafts(uid);
    const now = Date.now();
    const current = existing.find((item) => item.id === draft.id);
    const saved: AddProductDraft = {
      ...current,
      ...draft,
      id: draft.id,
      createdAt: current?.createdAt ?? draft.createdAt ?? now,
      updatedAt: now,
    };
    localStorage.setItem(
      key,
      JSON.stringify([
        saved,
        ...existing.filter((item) => item.id !== saved.id),
      ]),
    );
    await syncAddProductDraftToCloud(saved, uid);
  } catch (err) {
    console.warn("Failed to save add product draft", err);
  }
}

async function loadAddProductDrafts(
  uid: string | null,
): Promise<AddProductDraft[]> {
  if (!uid) return [];
  try {
    const key = getAddProductDraftKey(uid);
    const raw = localStorage.getItem(key);
    if (raw) {
      const drafts = JSON.parse(raw) as AddProductDraft[];
      return Array.isArray(drafts) ? drafts : [];
    }

    const legacyKey = getLegacyAddProductDraftKey(uid);
    const legacyRaw = localStorage.getItem(legacyKey);
    if (!legacyRaw) return [];
    const legacy = JSON.parse(legacyRaw) as Partial<AddProductDraft>;
    const now = Date.now();
    const migrated: AddProductDraft = {
      ...legacy,
      id: createDraftId(),
      createdAt: now,
      updatedAt: now,
    };
    localStorage.setItem(key, JSON.stringify([migrated]));
    localStorage.removeItem(legacyKey);
    return [migrated];
  } catch (err) {
    console.warn("Failed to load add product draft", err);
    return [];
  }
}

async function clearAddProductDraft(uid: string | null, draftId?: string | null) {
  if (!uid) return;
  try {
    const key = getAddProductDraftKey(uid);
    if (!draftId) {
      localStorage.removeItem(key);
      localStorage.removeItem(getLegacyAddProductDraftKey(uid));
      return;
    }
    const existing = await loadAddProductDrafts(uid);
    localStorage.setItem(
      key,
      JSON.stringify(existing.filter((draft) => draft.id !== draftId)),
    );
    await deleteAddProductDraftFromCloud(draftId, uid);
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
  const [submitFeedback, setSubmitFeedback] = useState<string | null>(null);
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
  const [useCustomProductType, setUseCustomProductType] = useState(false);
  const [draftCollections, setDraftCollections] = useState<string[]>([]);
  const [customCollectionName, setCustomCollectionName] = useState("");
  const [draftBustSize, setDraftBustSize] = useState("");
  const [draftWaistSize, setDraftWaistSize] = useState("");
  const [draftHipSize, setDraftHipSize] = useState("");
  const [draftLengthSize, setDraftLengthSize] = useState("");
  const [draftShoulderSize, setDraftShoulderSize] = useState("");
  const [draftInseamSize, setDraftInseamSize] = useState("");

  // shadcn <Select> values (controlled)
  const [trackInventory, setTrackInventory] = useState<"yes" | "no">("yes");
  const [statusSel, setStatusSel] = useState<"active" | "draft">("active");
  const [garmentCategory, setGarmentCategory] =
    useState<GarmentCategory>("Tops");
  const [fitType, setFitType] = useState<FitType>("Regular");
  const [fallbackSize, setFallbackSize] = useState("M");
  const [variantMode, setVariantMode] = useState<"single" | "multiple">(
    "single",
  );
  const [singleColor, setSingleColor] = useState("");
  const [variantColorImages, setVariantColorImages] = useState<
    Record<string, File[]>
  >({});
  const [variantColorImagePreviews, setVariantColorImagePreviews] = useState<
    Record<string, string[]>
  >({});
  const skipNextDraftAutosave = useRef(false);
  const lastShopifySyncKey = useRef("");
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);

  // ----- list / search -----
  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid ?? null);
  const [products, setProducts] = useState<MerchantProduct[]>([]);
  const [localDrafts, setLocalDrafts] = useState<AddProductDraft[]>([]);
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
      shoulder: toNullableNumber(draftShoulderSize),
      inseam: toNullableNumber(draftInseamSize),
      unit: "in",
    };
  }

  function readCurrentAddDraft(): AddProductDraft {
    const now = Date.now();
    return {
      id: activeDraftId ?? createDraftId(),
      createdAt: now,
      updatedAt: now,
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
      customProductType: useCustomProductType,
      collections: [],
      basePriceInput: basePriceInput || undefined,
      trackInventory,
      statusSel,
      handleDeliveryCharge,
      imagePreviews,
      variantColorImagePreviews,
      options,
      garmentCategory,
      fitType,
      fallbackSize,
      variantMode,
      singleColor: singleColor.trim() || undefined,
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
    setFallbackSize("M");
    setVariantMode("single");
    setSingleColor("");
    setVariantColorImages({});
    setVariantColorImagePreviews({});
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
    setUseCustomProductType(false);
    setDraftCollections([]);
    setCustomCollectionName("");
    setDraftBustSize("");
    setDraftWaistSize("");
    setDraftHipSize("");
    setDraftLengthSize("");
    setDraftShoulderSize("");
    setDraftInseamSize("");
    form?.reset();
  }

  function clearSingleVariantDetails() {
    setSelectedImages([]);
    setImagePreviews([]);
    setSingleColor("");
    setDraftQuantity("");
    setFallbackSize("M");
    setDraftBustSize("");
    setDraftWaistSize("");
    setDraftHipSize("");
    setDraftLengthSize("");
    setDraftShoulderSize("");
    setDraftInseamSize("");
  }

  function clearMultipleVariantDetails() {
    setOptions([
      { name: "Size", values: [] },
      { name: "Color", values: [] },
    ]);
    setValueInputs(["", "", ""]);
    setVariantRows({});
    setVariantColorImages({});
    setVariantColorImagePreviews({});
  }

  function switchVariantMode(mode: "single" | "multiple") {
    if (mode === variantMode) return;
    if (mode === "single") clearMultipleVariantDetails();
    else clearSingleVariantDetails();
    setVariantMode(mode);
  }

  function handleClearAddProductForm() {
    skipNextDraftAutosave.current = true;
    if (activeDraftId) {
      void clearAddProductDraft(uid, activeDraftId);
      setLocalDrafts((drafts) =>
        drafts.filter((draft) => draft.id !== activeDraftId),
      );
    }
    setActiveDraftId(null);
    clearAddProductFormState(
      document.getElementById("add-product-form") as HTMLFormElement | null,
    );
    toast.success("Form and local draft cleared.");
  }

  async function handleSaveAddProductDraft() {
    if (!uid) {
      toast.error("Please login again before saving a draft.");
      return;
    }

    const draft = readCurrentAddDraft();
    if (hasMeaningfulAddDraft(draft)) {
      let savedDraft = draft;
      if (
        imagePreviews.some((preview) => preview.startsWith("data:")) ||
        Object.values(variantColorImagePreviews).some((previews) =>
          previews.some((preview) => preview.startsWith("data:")),
        )
      ) {
        try {
          savedDraft = await buildCloudImageDraft(draft);
        } catch (err) {
          console.warn("Failed to upload draft photos", err);
          toast.error(
            "Draft saved on this device. Photo cloud sync could not finish.",
          );
        }
      }
      await saveAddProductDraft(uid, () => savedDraft);
      setLocalDrafts((drafts) => [
        savedDraft,
        ...drafts.filter((item) => item.id !== savedDraft.id),
      ]);
    }
    setActiveDraftId(null);
    clearAddProductFormState();
    setIsAddProductOpen(false);
    toast.success("Draft saved. You can reopen it from Products.");
  }

  function handleSubmitForReviewClick() {
    const form = document.getElementById(
      "add-product-form",
    ) as HTMLFormElement | null;

    if (!form) {
      const message = "Product form is unavailable. Please reopen Add Product.";
      setSubmitFeedback(message);
      toast.error(message);
      return;
    }

    void submitAddProduct(form);
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUid(u?.uid ?? null));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!uid) {
      setLocalDrafts([]);
      return;
    }

    loadAddProductDrafts(uid).then((drafts) => {
      setLocalDrafts(drafts);
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

  useEffect(() => {
    if (!uid || !products.length) return;
    const ids = products
      .filter(
        (product) =>
          product.shopifyProductId &&
          product.status !== "deleted" &&
          product.status !== "local_draft",
      )
      .map((product) => product.id)
      .sort();
    if (!ids.length) return;
    const syncKey = ids.join("|");
    if (lastShopifySyncKey.current === syncKey) return;
    lastShopifySyncKey.current = syncKey;

    void (async () => {
      try {
        const idToken = await getIdToken();
        await fetch("/api/admin/products/update", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ op: "syncShopifyProducts", ids }),
        });
      } catch (error) {
        console.warn("Failed to sync Shopify product statuses", error);
      }
    })();
  }, [uid, products]);

  const localDraftProducts = useMemo<ProductListItem[]>(
    () =>
      localDrafts
        .filter((draft) => !products.some((product) => product.id === draft.id))
        .filter((draft) => draft.title?.trim())
        .map((draft) => {
          const basePrice = Number(draft.basePriceInput || 0);
          const finalPrice =
            Number.isFinite(basePrice) && basePrice > 0
              ? basePrice + (draft.handleDeliveryCharge ? 100 : 0)
              : undefined;

          return {
            id: `__local_draft__:${draft.id}`,
            title: draft.title || "Untitled local draft",
            description: draft.description,
            price: finalPrice,
            productType: draft.productType,
            collections: draft.collections,
            status: "pending",
            images: [],
            image:
              draft.imagePreviews?.[0] ??
              Object.values(draft.variantColorImagePreviews || {}).find(
                (previews) => previews.length,
              )?.[0] ??
              null,
            sku: draft.sku,
            tags: draft.tags,
            vendor: draft.vendor,
            measurements: draft.measurements,
            isLocalDraft: true,
            imagePreview:
              draft.imagePreviews?.[0] ??
              Object.values(draft.variantColorImagePreviews || {}).find(
                (previews) => previews.length,
              )?.[0] ??
              null,
            draft,
          };
        }),
    [localDrafts, products],
  );

  const filtered = useMemo<ProductListItem[]>(() => {
    const remoteProducts: ProductListItem[] = products
      .filter((p) => p.status !== "deleted")
      .map((p) => {
        if (p.status !== "local_draft" || !p.draft) return p;
        const localDraft = localDrafts.find((draft) => draft.id === p.id);
        const mergedDraft = localDraft
          ? {
              ...p.draft,
              ...localDraft,
              imagePreviews: localDraft.imagePreviews?.length
                ? localDraft.imagePreviews
                : p.draft.imagePreviews,
              variantColorImagePreviews: Object.keys(
                localDraft.variantColorImagePreviews || {},
              ).length
                ? localDraft.variantColorImagePreviews
                : p.draft.variantColorImagePreviews,
            }
          : p.draft;
        return {
          ...p,
          draft: mergedDraft,
          isLocalDraft: true,
          imagePreview:
            mergedDraft.imagePreviews?.[0] ??
            Object.values(mergedDraft.variantColorImagePreviews || {}).find(
              (items) => items.length,
            )?.[0] ??
            p.image ??
            null,
        };
      });
    const allProducts = [...localDraftProducts, ...remoteProducts];

    const s = search.trim().toLowerCase();
    if (!s) return allProducts;

    return allProducts.filter((p) =>
      `${p.title} ${p.productType ?? ""} ${(p.collections || []).join(" ")} ${p.sku ?? ""}`
        .toLowerCase()
        .includes(s),
    );
  }, [products, search, localDraftProducts, localDrafts]);

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

  function getRequiredMeasurementFields(category: GarmentCategory) {
    return category === "Tops"
      ? (["bust", "shoulder", "length"] as const)
      : (["waist"] as const);
  }

  function missingProductMeasurements(
    measurements: ProductMeasurements,
    category: GarmentCategory,
  ) {
    return getRequiredMeasurementFields(category).filter(
      (field) => typeof measurements[field] !== "number",
    );
  }

  function missingVariantMeasurements(
    row: VariantRow,
    category: GarmentCategory,
  ) {
    const fields =
      category === "Tops"
        ? (["chest", "shoulder", "length"] as const)
        : (["waist"] as const);
    return fields.filter(
      (field) => typeof row.measurements?.[field] !== "number",
    );
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

  function autofillFallbackMeasurements(
    size: string = fallbackSize,
    category: GarmentCategory = garmentCategory,
    fit: FitType = fitType,
  ) {
    const generated = measurementsForVariant(category, fit, size);
    if (!generated) return;
    setDraftBustSize(generated.chest == null ? "" : String(generated.chest));
    setDraftWaistSize(generated.waist == null ? "" : String(generated.waist));
    setDraftHipSize(generated.hip == null ? "" : String(generated.hip));
    setDraftShoulderSize(
      generated.shoulder == null ? "" : String(generated.shoulder),
    );
    setDraftInseamSize(
      generated.inseam == null ? "" : String(generated.inseam),
    );
    const garmentLength = generated.length ?? generated.inseam;
    setDraftLengthSize(garmentLength == null ? "" : String(garmentLength));
  }

  function handleGarmentCategoryChange(category: GarmentCategory) {
    setGarmentCategory(category);
    const categorySizes = sizesForCategory(category);
    const nextSize = categorySizes.includes(fallbackSize as never)
      ? fallbackSize
      : categorySizes[0];
    setFallbackSize(nextSize);
    autofillFallbackMeasurements(nextSize, category, fitType);
    generateVariants(category, fitType);
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
    const optionName = (options[idx]?.name || "").trim().toLowerCase();
    const values = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const normalizedValues =
      optionName === "size"
        ? values.map((value) => value.toUpperCase())
        : values;
    if (
      optionName === "size" &&
      normalizedValues.some(
        (value) => !GARMENT_SIZES.includes(value as (typeof GARMENT_SIZES)[number]),
      )
    ) {
      toast.error("Use short size codes only, e.g. S, M, L, XL.");
      return;
    }
    setOptions((prev) => {
      const next = [...prev];
      const existing = new Set(next[idx].values);
      normalizedValues.forEach((v) => existing.add(v));
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
      if (skipNextDraftAutosave.current) {
        skipNextDraftAutosave.current = false;
        return;
      }
      const draft = readCurrentAddDraft();
      if (hasMeaningfulAddDraft(draft)) {
        saveAddProductDraft(uid, () => draft);
        setLocalDrafts((drafts) => [
          draft,
          ...drafts.filter((item) => item.id !== draft.id),
        ]);
      }
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
    useCustomProductType,
    draftBustSize,
    draftWaistSize,
    draftHipSize,
    draftLengthSize,
    draftShoulderSize,
    draftInseamSize,
    garmentCategory,
    fitType,
    fallbackSize,
    variantMode,
    singleColor,
    basePriceInput,
    trackInventory,
    statusSel,
    handleDeliveryCharge,
    imagePreviews,
    options,
    variantRows,
    variantColorImagePreviews,
    activeDraftId,
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

  const restoreAddDraft = (saved: AddProductDraft) => {
    clearAddProductFormState();
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
    if (saved.productType) {
      setDraftProductType(saved.productType);
      setUseCustomProductType(
        !PRODUCT_TYPE_OPTIONS.includes(
          saved.productType as (typeof PRODUCT_TYPE_OPTIONS)[number],
        ),
      );
    }
    if (saved.customProductType) setUseCustomProductType(true);
    if (saved.garmentCategory) setGarmentCategory(saved.garmentCategory);
    if (saved.fitType) setFitType(saved.fitType);
    if (saved.fallbackSize) setFallbackSize(saved.fallbackSize);
    if (saved.variantMode) setVariantMode(saved.variantMode);
    if (saved.singleColor) setSingleColor(saved.singleColor);
    if (saved.measurements?.bust != null)
      setDraftBustSize(String(saved.measurements.bust));
    if (saved.measurements?.waist != null)
      setDraftWaistSize(String(saved.measurements.waist));
    if (saved.measurements?.hip != null)
      setDraftHipSize(String(saved.measurements.hip));
    if (saved.measurements?.length != null)
      setDraftLengthSize(String(saved.measurements.length));
    if (saved.measurements?.shoulder != null)
      setDraftShoulderSize(String(saved.measurements.shoulder));
    if (saved.measurements?.inseam != null)
      setDraftInseamSize(String(saved.measurements.inseam));
    if (saved.trackInventory) setTrackInventory(saved.trackInventory);
    if (saved.statusSel) setStatusSel(saved.statusSel);
    if (typeof saved.handleDeliveryCharge === "boolean")
      setHandleDeliveryCharge(saved.handleDeliveryCharge);
    if (saved.options) setOptions(saved.options);
    if (saved.variantRows) {
      const rowsMap: Record<string, VariantRow> = {};
      saved.variantRows.forEach((r) => {
        const key = r.options.join("|");
        rowsMap[key] = { ...r, id: key };
      });
      setVariantRows(rowsMap);
    }
    if (saved.imagePreviews) setImagePreviews(saved.imagePreviews);
    if (saved.variantColorImagePreviews)
      setVariantColorImagePreviews(saved.variantColorImagePreviews);
    setActiveDraftId(saved.id);
  };

  const handleAddProduct = () => {
    skipNextDraftAutosave.current = true;
    clearAddProductFormState();
    setActiveDraftId(createDraftId());
    setSubmitFeedback(null);
    setIsAddProductOpen(true);
  };
  const handleAddDialogOpenChange = (open: boolean) => {
    if (!open && isAddProductOpen && uid) {
      const draft = readCurrentAddDraft();
      const shouldSaveDraft = hasMeaningfulAddDraft(draft);
      if (shouldSaveDraft) {
        const selectedSingleImages = [...selectedImages];
        const selectedColorImages = Object.fromEntries(
          Object.entries(variantColorImages).map(([color, files]) => [
            color,
            [...files],
          ]),
        );
        saveAddProductDraft(uid, () => draft);
        setLocalDrafts((drafts) => [
          draft,
          ...drafts.filter((item) => item.id !== draft.id),
        ]);
        if (
          selectedSingleImages.length ||
          Object.values(selectedColorImages).some((files) => files.length)
        ) {
          void (async () => {
            try {
              const uploadedDraft = await buildCloudImageDraft(
                draft,
                selectedSingleImages,
                selectedColorImages,
              );
              await saveAddProductDraft(uid, () => uploadedDraft);
              setLocalDrafts((drafts) => [
                uploadedDraft,
                ...drafts.filter((item) => item.id !== uploadedDraft.id),
              ]);
            } catch (err) {
              console.warn("Failed to upload draft photos", err);
            }
          })();
        }
      }
      skipNextDraftAutosave.current = true;
      setActiveDraftId(null);
      clearAddProductFormState();
      if (shouldSaveDraft) toast.success("Progress saved as a local draft.");
    }
    setIsAddProductOpen(open);
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const remainingSlots = Math.max(0, 5 - selectedImages.length);
    const filesToAdd = files.slice(0, remainingSlots);
    if (files.length > filesToAdd.length) {
      toast.error("You can upload up to 5 photos for the single variant.");
    }
    if (!filesToAdd.length) {
      e.target.value = "";
      return;
    }
    setSelectedImages((current) => [...current, ...filesToAdd]);
    filesToAdd.forEach((file) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreviews((current) => [...current, String(reader.result || "")]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  };

  const removeLocalImage = (index: number) => {
    setSelectedImages((s) => s.filter((_, i) => i !== index));
    setImagePreviews((s) => s.filter((_, i) => i !== index));
  };

  const addVariantColorImages = (color: string, files: File[]) => {
    const currentFiles = variantColorImages[color] || [];
    const filesToAdd = files.slice(0, Math.max(0, 5 - currentFiles.length));
    if (files.length > filesToAdd.length) {
      toast.error("You can add up to 5 images for each color.");
    }
    if (!filesToAdd.length) return;

    setVariantColorImages((current) => ({
      ...current,
      [color]: [...(current[color] || []), ...filesToAdd],
    }));

    filesToAdd.forEach((file) => {
      const reader = new FileReader();
      reader.onloadend = () =>
        setVariantColorImagePreviews((current) => ({
          ...current,
          [color]: [...(current[color] || []), String(reader.result || "")],
        }));
      reader.readAsDataURL(file);
    });
  };

  const removeVariantColorImage = (color: string, index: number) => {
    setVariantColorImages((current) => ({
      ...current,
      [color]: (current[color] || []).filter((_, itemIndex) => itemIndex !== index),
    }));
    setVariantColorImagePreviews((current) => ({
      ...current,
      [color]: (current[color] || []).filter((_, itemIndex) => itemIndex !== index),
    }));
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

  async function dataUrlToFile(dataUrl: string, index: number) {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const extension = blob.type.split("/")[1] || "jpg";
    return new File([blob], `single-variant-draft-${index + 1}.${extension}`, {
      type: blob.type || "image/jpeg",
    });
  }

  async function uploadPendingReviewImage(idToken: string, file: File) {
    const signResponse = await fetch("/api/admin/products/update", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ op: "mediaSign" }),
    });
    const signJson = await signResponse.json().catch(() => ({}));
    if (!signResponse.ok || !signJson.ok) {
      throw new Error(signJson.error || "Failed to prepare variant photo upload");
    }

    const uploadForm = new FormData();
    uploadForm.append("file", file);
    uploadForm.append("fileName", file.name);
    uploadForm.append("publicKey", signJson.publicKey);
    uploadForm.append("signature", signJson.auth.signature);
    uploadForm.append("token", signJson.auth.token);
    uploadForm.append("expire", String(signJson.auth.expire));
    if (signJson.folder) uploadForm.append("folder", signJson.folder);

    const uploadResponse = await fetch(
      "https://upload.imagekit.io/api/v1/files/upload",
      { method: "POST", body: uploadForm },
    );
    const uploadJson = await uploadResponse.json().catch(() => ({}));
    if (!uploadResponse.ok || !uploadJson.url) {
      throw new Error(uploadJson.message || "Variant photo upload failed");
    }
    return String(uploadJson.url);
  }

  async function buildCloudImageDraft(
    draft: AddProductDraft,
    singleImageFiles: File[] = selectedImages,
    colorImageFiles: Record<string, File[]> = variantColorImages,
  ) {
    const idToken = await getIdToken();
    const isRemoteUrl = (url: string) => /^https?:\/\//i.test(url);

    if (draft.variantMode === "single") {
      const uploadedUrls =
        singleImageFiles.length > 0
          ? await Promise.all(
              singleImageFiles
                .slice(0, 5)
                .map((file) => uploadPendingReviewImage(idToken, file)),
            )
          : await Promise.all(
              (draft.imagePreviews || [])
                .filter((preview) => preview.startsWith("data:"))
                .slice(0, 5)
                .map(async (preview, index) =>
                  uploadPendingReviewImage(
                    idToken,
                    await dataUrlToFile(preview, index),
                  ),
                ),
            );
      return {
        ...draft,
        imagePreviews: uploadedUrls.length
          ? uploadedUrls
          : (draft.imagePreviews || []).filter(isRemoteUrl).slice(0, 5),
      };
    }

    const variantColorImagePreviews: Record<string, string[]> = {
      ...(draft.variantColorImagePreviews || {}),
    };
    for (const [color, files] of Object.entries(colorImageFiles)) {
      if (!files.length) continue;
      variantColorImagePreviews[color] = await Promise.all(
        files.slice(0, 5).map((file) => uploadPendingReviewImage(idToken, file)),
      );
    }
    for (const [color, previews] of Object.entries(variantColorImagePreviews)) {
      if ((colorImageFiles[color] || []).length) continue;
      const dataPreviews = previews.filter((preview) => preview.startsWith("data:"));
      if (dataPreviews.length) {
        variantColorImagePreviews[color] = await Promise.all(
          dataPreviews.slice(0, 5).map(async (preview, index) =>
            uploadPendingReviewImage(
              idToken,
              await dataUrlToFile(preview, index),
            ),
          ),
        );
      } else {
        variantColorImagePreviews[color] = previews.filter(isRemoteUrl).slice(0, 5);
      }
    }

    return { ...draft, variantColorImagePreviews };
  }

  /** ====== ADD submit ====== */
  const showSubmitError = (message: string) => {
    setSubmitFeedback(message);
    toast.error(message);
  };

  const submitAddProduct = async (formElement: HTMLFormElement) => {
    setSubmitFeedback(null);
    if (!auth.currentUser) {
      showSubmitError("Please login again.");
      return;
    }

    const form = new FormData(formElement);
    const title = String(form.get("title") || "").trim();
    const description = String(form.get("description") || "").trim();

    const rawPrice =
      basePriceInput !== "" ? basePriceInput : String(form.get("price") ?? "");
    const parsedPrice = Number(rawPrice || 0);
    const price = Number.isFinite(parsedPrice)
      ? parsedPrice + (handleDeliveryCharge ? 100 : 0)
      : 0;
    const compareAtPriceRaw = String(form.get("compare-price") ?? "");
    const compareAtPrice =
      compareAtPriceRaw === "" ? NaN : Number(compareAtPriceRaw);
    const cost = Number(form.get("cost") || 0) || undefined;
    const barcode = String(form.get("barcode") || "").trim() || undefined;
    const weightRaw = String(form.get("weight") ?? "");
    const weightGrams = weightRaw === "" ? undefined : Number(weightRaw);
    const quantityRaw = String(form.get("quantity") ?? "");
    const quantity = quantityRaw === "" ? null : Number(quantityRaw);

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
      shoulder: toNullableNumber(String(form.get("shoulder-size") ?? "")),
      inseam: toNullableNumber(String(form.get("inseam-size") ?? "")),
      unit: "in",
    };

    // --- required checks per your request ---
    if (
      variantMode === "single" &&
      selectedImages.length === 0 &&
      imagePreviews.length === 0
    )
      return showSubmitError("Please add at least one photo for the single variant.");
    if (!title) return showSubmitError("Product title is required.");
    if (!description) return showSubmitError("Product description is required.");
    if (rawPrice.trim() === "" || !Number.isFinite(parsedPrice) || parsedPrice <= 0)
      return showSubmitError("Please enter a valid selling price.");
    if (Number.isNaN(compareAtPrice))
      return showSubmitError("MRP is required.");
    if (!sku) return showSubmitError("SKU is required.");
    if (
      weightGrams == null ||
      !Number.isFinite(weightGrams) ||
      Number(weightGrams) <= 0
    ) {
      return showSubmitError("Product weight is required.");
    }
    if (
      variantMode === "single" &&
      (quantity === null || !Number.isFinite(quantity) || quantity < 0)
    ) {
      return showSubmitError("Quantity is required for the single variant.");
    }
    if (!vendor) return showSubmitError("Vendor name is required.");
    if (!productType) return showSubmitError("Product type is required.");
    if (!seoTitle || !seoDescription)
      return showSubmitError("SEO Title and SEO Description are required.");
    if (variantMode === "single" && !singleColor.trim())
      return showSubmitError("Color is required for the single variant.");
    if (variantMode === "single") {
      const missingMeasurements = missingProductMeasurements(
        measurements,
        garmentCategory,
      );
      if (missingMeasurements.length) {
        return showSubmitError(
          "Please add all required garment measurements for the selected category.",
        );
      }
    }
    if (
      variantMode === "multiple" &&
      (options.every((option) => option.values.length === 0) ||
        Object.keys(variantRows).length === 0)
    ) {
      return showSubmitError(
        "Add at least one complete variant combination before submitting.",
      );
    }
    if (
      variantMode === "multiple" &&
      Object.values(variantRows).some(
        (row) =>
          row.price == null ||
          !Number.isFinite(Number(row.price)) ||
          Number(row.price) <= 0,
      )
    ) {
      return showSubmitError("Enter a selling price for every variant.");
    }
    if (
      variantMode === "multiple" &&
      Object.values(variantRows).some(
        (row) =>
          row.compareAtPrice == null ||
          !Number.isFinite(Number(row.compareAtPrice)) ||
          Number(row.compareAtPrice) <= 0,
      )
    ) {
      return showSubmitError("Enter MRP for every variant.");
    }
    if (
      variantMode === "multiple" &&
      Object.values(variantRows).some(
        (row) =>
          row.quantity == null ||
          !Number.isFinite(Number(row.quantity)) ||
          Number(row.quantity) < 0,
      )
    ) {
      return showSubmitError("Enter a quantity for every variant.");
    }
    if (
      variantMode === "multiple" &&
      Object.values(variantRows).some(
        (row) =>
          row.weightGrams == null ||
          !Number.isFinite(Number(row.weightGrams)) ||
          Number(row.weightGrams) <= 0,
      )
    ) {
      return showSubmitError("Enter product weight for every variant.");
    }
    if (
      variantMode === "multiple" &&
      Object.values(variantRows).some(
        (row) => missingVariantMeasurements(row, garmentCategory).length > 0,
      )
    ) {
      return showSubmitError(
        "Please add all required garment measurements for every variant.",
      );
    }
    if (variantMode === "multiple") {
      const colorOption = options.find(
        (option) => option.name.trim().toLowerCase() === "color",
      );
      if (!colorOption?.values.length) {
        return showSubmitError("Add a Color option for variant-wise photos.");
      }
      const missingColor = colorOption.values.find(
        (color) =>
          !(variantColorImages[color] || []).length &&
          !(variantColorImagePreviews[color] || []).length,
      );
      if (missingColor) {
        return showSubmitError(`Add at least one photo for ${missingColor}.`);
      }
    }

    try {
      setBusy(true);
      const idToken = await getIdToken();

      const restoredPreviewFiles =
        variantMode === "single" && selectedImages.length === 0
          ? await Promise.all(
              imagePreviews
                .filter((preview) => preview.startsWith("data:"))
                .slice(0, 5)
                .map((preview, index) => dataUrlToFile(preview, index)),
            )
          : [];
      const localFiles =
        variantMode === "single"
          ? (selectedImages.length ? selectedImages : restoredPreviewFiles).slice(0, 5)
          : [];
      const restoredRemoteUrls =
        variantMode === "single"
          ? imagePreviews.filter((preview) => /^https?:\/\//i.test(preview)).slice(0, 5)
          : [];
      if (
        variantMode === "single" &&
        !localFiles.length &&
        !restoredRemoteUrls.length
      ) {
        return showSubmitError(
          "Please re-upload at least one product photo before submitting.",
        );
      }
      let resourceUrls: string[] = restoredRemoteUrls;
      if (localFiles.length) {
        resourceUrls = [];
        for (const file of localFiles) {
          const url = await uploadPendingReviewImage(idToken, file);
          resourceUrls.push(url);
        }
      }

      const enabledOptions = options.filter(
        (o) => (o?.name || "").trim() && o.values.length > 0,
      );
      const variantColorMediaUrls: Record<string, string[]> = {};
      if (variantMode === "multiple") {
        for (const [color, previews] of Object.entries(
          variantColorImagePreviews,
        )) {
          const remoteUrls = (previews || []).filter((preview) =>
            /^https?:\/\//i.test(preview),
          );
          if (remoteUrls.length) variantColorMediaUrls[color] = remoteUrls.slice(0, 5);
        }
        const restoredColorFiles = await Promise.all(
          Object.entries(variantColorImagePreviews).flatMap(([color, previews]) =>
            (previews || [])
              .filter(
                (preview) =>
                  preview.startsWith("data:") &&
                  !(variantColorImages[color] || []).length,
              )
              .slice(0, 5)
              .map(async (preview, index) => ({
                color,
                file: await dataUrlToFile(preview, index),
              })),
          ),
        );
        const colorFiles = [
          ...Object.entries(variantColorImages).flatMap(([color, files]) =>
            files.map((file) => ({ color, file })),
          ),
          ...restoredColorFiles,
        ];
        if (colorFiles.length) {
          for (const item of colorFiles) {
            const resourceUrl = await uploadPendingReviewImage(
              idToken,
              item.file,
            );
            variantColorMediaUrls[item.color] = [
              ...(variantColorMediaUrls[item.color] || []),
              resourceUrl,
            ].slice(0, 5);
          }
        }
      }
      let variantDraft:
        | undefined
        | {
            options: VariantOption[];
            variants: Omit<VariantRow, "id">[];
          } = undefined;

      if (variantMode === "single") {
        const color = singleColor.trim();
        variantDraft = {
          options: [
            { name: "Size", values: [fallbackSize] },
            { name: "Color", values: [color] },
          ],
          variants: [
            {
              options: [fallbackSize, color],
              title: `${fallbackSize} / ${color}`,
              price,
              compareAtPrice,
              sku,
              quantity,
              barcode,
              weightGrams,
              measurements: hasAnyMeasurement(measurements)
                ? measurements
                : null,
            },
          ],
        };
      } else if (
        enabledOptions.length > 0 &&
        Object.keys(variantRows).length > 0
      ) {
        const colorOptionIndex = enabledOptions.findIndex(
          (option) => option.name.trim().toLowerCase() === "color",
        );
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
          mediaUrls:
            colorOptionIndex >= 0
              ? variantColorMediaUrls[v.options[colorOptionIndex]] || []
              : [],
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
          quantity: variantMode === "single" ? quantity : null,
          tracked: trackInventory === "yes",
          cost,
        },
        currency: "INR",
        tags,
        resourceUrls,
        vendor,
        productType,
        collections: [],
        garmentCategory,
        fitType,
        variantMode,
        status: statusSel,
        sku, // <-- send to server
        seo: { title: seoTitle, description: seoDescription },
        measurements: variantMode === "single" ? measurements : null,
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
      setSubmitFeedback("Product submitted successfully for admin review.");
      await clearAddProductDraft(uid, activeDraftId);
      setLocalDrafts((drafts) =>
        drafts.filter((draft) => draft.id !== activeDraftId),
      );
      setActiveDraftId(null);
      setIsAddProductOpen(false);
      clearAddProductFormState(formElement);
    } catch (err: any) {
      console.error(err);
      showSubmitError(err?.message || "Failed to create product");
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
  const [eUseCustomProductType, setEUseCustomProductType] = useState(false);
  const [eCollections, setECollections] = useState<string[]>([]);
  const [eCustomCollectionName, setECustomCollectionName] = useState("");
  const [eVendor, setEVendor] = useState("");
  const [eTags, setETags] = useState("");
  const [eSeoTitle, setESeoTitle] = useState("");
  const [eSeoDesc, setESeoDesc] = useState("");
  const [eBustSize, setEBustSize] = useState<number | "">("");
  const [eWaistSize, setEWaistSize] = useState<number | "">("");
  const [eHipSize, setEHipSize] = useState<number | "">("");
  const [eLengthSize, setELengthSize] = useState<number | "">("");
  const [eShoulderSize, setEShoulderSize] = useState<number | "">("");
  const [eInseamSize, setEInseamSize] = useState<number | "">("");

  function autofillEditFallbackMeasurements(
    size: string = fallbackSize,
    category: GarmentCategory = garmentCategory,
    fit: FitType = fitType,
  ) {
    const generated = measurementsForVariant(category, fit, size);
    if (!generated) return;
    setEBustSize(generated.chest ?? "");
    setEWaistSize(generated.waist ?? "");
    setEHipSize(generated.hip ?? "");
    setELengthSize(generated.length ?? generated.inseam ?? "");
    setEShoulderSize(generated.shoulder ?? "");
    setEInseamSize(generated.inseam ?? "");
  }

  // existing variants (live) + images (live)
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [existingVariants, setExistingVariants] = useState<ExistingVariant[]>(
    [],
  );
  const [existingProductOptions, setExistingProductOptions] = useState<
    VariantOption[]
  >([]);
  const [removeVariantIds, setRemoveVariantIds] = useState<
    Record<string, boolean>
  >({});
  const [variantQuickEdits, setVariantQuickEdits] = useState<
    Record<string, { price?: number | ""; quantity?: number | "" }>
  >({});
  const [variantMeasurementEdits, setVariantMeasurementEdits] = useState<
    Record<string, ProductMeasurements>
  >({});
  const [editColorImageFiles, setEditColorImageFiles] = useState<
    Record<string, File[]>
  >({});
  const [editColorImagePreviews, setEditColorImagePreviews] = useState<
    Record<string, string[]>
  >({});
  const [editColorImageRemovals, setEditColorImageRemovals] = useState<
    Record<string, Record<string, boolean>>
  >({});
  const [imagesLive, setImagesLive] = useState<string[]>([]);
  const [imageAddFiles, setImageAddFiles] = useState<File[]>([]);
  const [imageBusy, setImageBusy] = useState(false);
  const [deleteSel, setDeleteSel] = useState<Record<string, boolean>>({}); // url -> selected

  const editColorGroups = useMemo(() => {
    const colorIndex = existingProductOptions.findIndex(
      (option) => option.name.trim().toLowerCase() === "color",
    );
    const groups = new Map<
      string,
      { label: string; variantIds: string[]; existingUrls: string[] }
    >();
    for (const variant of existingVariants) {
      const label =
        colorIndex >= 0
          ? variant.optionValues[colorIndex] || variant.title
          : variant.optionValues.join(" / ") || variant.title;
      const current = groups.get(label) || {
        label,
        variantIds: [],
        existingUrls: [],
      };
      current.variantIds.push(variant.id);
      current.existingUrls.push(...(variant.mediaUrls || []));
      current.existingUrls = [...new Set(current.existingUrls)];
      groups.set(label, current);
    }
    return [...groups.values()];
  }, [existingProductOptions, existingVariants]);

  function addEditColorImages(color: string, files: File[]) {
    const currentFiles = editColorImageFiles[color] || [];
    const filesToAdd = files.slice(0, Math.max(0, 5 - currentFiles.length));
    if (files.length > filesToAdd.length) {
      toast.error("You can add up to 5 new photos for each colour.");
    }
    if (!filesToAdd.length) return;
    setEditColorImageFiles((current) => ({
      ...current,
      [color]: [...(current[color] || []), ...filesToAdd],
    }));
    filesToAdd.forEach((file) => {
      const reader = new FileReader();
      reader.onloadend = () =>
        setEditColorImagePreviews((current) => ({
          ...current,
          [color]: [...(current[color] || []), String(reader.result || "")],
        }));
      reader.readAsDataURL(file);
    });
  }

  function removeEditColorImage(color: string, index: number) {
    setEditColorImageFiles((current) => ({
      ...current,
      [color]: (current[color] || []).filter((_, itemIndex) => itemIndex !== index),
    }));
    setEditColorImagePreviews((current) => ({
      ...current,
      [color]: (current[color] || []).filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  function setEditColorImageRemoval(
    color: string,
    url: string,
    checked: boolean,
  ) {
    setEditColorImageRemovals((current) => ({
      ...current,
      [color]: {
        ...(current[color] || {}),
        [url]: checked,
      },
    }));
  }

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
    key: "chest" | "bust" | "waist" | "hip" | "length" | "shoulder" | "inseam",
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
      setEditing((current) =>
        current?.id === productId ? { ...current, ...(prod as MerchantProduct) } : current,
      );
      setETitle(prod.title || "");
      setEDescription(prod.description || "");
      setEPrice(typeof prod.price === "number" ? prod.price : "");
      setEStock(typeof prod.stock === "number" ? prod.stock : "");
      setECompareAt(
        typeof prod.compareAtPrice === "number" ? prod.compareAtPrice : "",
      );
      setEBarcode(prod.barcode || "");
      setEWeight(typeof prod.weightGrams === "number" ? prod.weightGrams : "");
      setEProductType(prod.productType || "");
      setEUseCustomProductType(
        Boolean(
          prod.productType &&
            !PRODUCT_TYPE_OPTIONS.includes(
              prod.productType as (typeof PRODUCT_TYPE_OPTIONS)[number],
            ),
        ),
      );
      setECollections(Array.isArray(prod.collections) ? prod.collections : []);
      setEVendor(prod.vendor || "");
      setETags((Array.isArray(prod.tags) ? prod.tags : []).join(", "));
      setESeoTitle(prod.seo?.title || "");
      setESeoDesc(prod.seo?.description || "");
      setGarmentCategory(prod.garmentCategory || "Tops");
      setFitType(prod.fitType || "Regular");
      setEBustSize(
        typeof prod.measurements?.bust === "number"
          ? prod.measurements.bust
          : typeof prod.measurements?.chest === "number"
            ? prod.measurements.chest
            : "",
      );
      setEWaistSize(
        typeof prod.measurements?.waist === "number" ? prod.measurements.waist : "",
      );
      setEHipSize(
        typeof prod.measurements?.hip === "number" ? prod.measurements.hip : "",
      );
      setELengthSize(
        typeof prod.measurements?.length === "number" ? prod.measurements.length : "",
      );
      setEShoulderSize(
        typeof prod.measurements?.shoulder === "number"
          ? prod.measurements.shoulder
          : "",
      );
      setEInseamSize(
        typeof prod.measurements?.inseam === "number" ? prod.measurements.inseam : "",
      );
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
            compareAtPrice:
              v.compareAtPrice != null ? Number(v.compareAtPrice) : undefined,
            quantity: v.quantity != null ? Number(v.quantity) : undefined,
            sku: v.sku || undefined,
            barcode: v.barcode || undefined,
            measurements: v.measurements || null,
            mediaUrls: Array.isArray(v.mediaUrls) ? v.mediaUrls : [],
          }))
        : [];

      setExistingVariants(variants);
      setExistingProductOptions(
        Array.isArray(prod.productOptions) ? prod.productOptions : [],
      );
      setRemoveVariantIds({});
      setVariantQuickEdits({});
      setEditColorImageRemovals({});
      setVariantMeasurementEdits(
        variants.reduce<Record<string, ProductMeasurements>>((acc, variant) => {
          acc[variant.id] = variant.measurements || emptyMeasurements();
          return acc;
        }, {}),
      );
      setImagesLive(
        uniqueImageUrls(
          Array.isArray(prod.imagesLive)
            ? prod.imagesLive
            : Array.isArray(prod.images)
              ? prod.images
              : Array.isArray(prod.imageUrls)
                ? prod.imageUrls
                : [],
        ),
      );
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
    setECompareAt(typeof p.compareAtPrice === "number" ? p.compareAtPrice : "");
    setEBarcode(p.barcode || "");
    setEWeight(typeof p.weightGrams === "number" ? p.weightGrams : "");
    setEProductType(p.productType || "");
    setEUseCustomProductType(
      Boolean(
        p.productType &&
          !PRODUCT_TYPE_OPTIONS.includes(
            p.productType as (typeof PRODUCT_TYPE_OPTIONS)[number],
          ),
      ),
    );
    setECollections(p.collections || []);
    setECustomCollectionName("");
    setEVendor(p.vendor || "");
    setETags((p.tags || []).join(", "));
    setESeoTitle(p.seo?.title || "");
    setESeoDesc(p.seo?.description || "");
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
    setEShoulderSize(
      typeof p.measurements?.shoulder === "number" ? p.measurements.shoulder : "",
    );
    setEInseamSize(
      typeof p.measurements?.inseam === "number" ? p.measurements.inseam : "",
    );
    setImageAddFiles([]);
    setEditColorImageFiles({});
    setEditColorImagePreviews({});
    setEditColorImageRemovals({});
    setVariantColorImages({});
    setVariantColorImagePreviews({});
    setExistingProductOptions([]);
    setImagesLive(
      uniqueImageUrls([
        ...(Array.isArray(p.images) ? p.images : []),
        ...(Array.isArray(p.imageUrls) ? p.imageUrls : []),
        p.image,
      ]),
    );
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
      setImageBusy(true);
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
      if (JSON.stringify(eCollections) !== JSON.stringify(editing.collections || []))
        payload.collections = eCollections;
      const nextSeo = {
        title: eSeoTitle.trim(),
        description: eSeoDesc.trim(),
      };
      if (
        nextSeo.title ||
        nextSeo.description ||
        JSON.stringify(nextSeo) !== JSON.stringify(editing.seo || {})
      ) {
        payload.seo = nextSeo;
      }
      if (eCompareAt !== "") payload.compareAtPrice = Number(eCompareAt);
      if (eBarcode.trim()) payload.barcode = eBarcode.trim();
      if (eWeight !== "") payload.weightGrams = Number(eWeight);

      const editedMeasurements: ProductMeasurements = {
        chest: eBustSize === "" ? null : Number(eBustSize),
        bust: eBustSize === "" ? null : Number(eBustSize),
        waist: eWaistSize === "" ? null : Number(eWaistSize),
        hip: eHipSize === "" ? null : Number(eHipSize),
        length: eLengthSize === "" ? null : Number(eLengthSize),
        shoulder: eShoulderSize === "" ? null : Number(eShoulderSize),
        inseam: eInseamSize === "" ? null : Number(eInseamSize),
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
        const colorOptionIndex = enabledOptions.findIndex(
          (option) => option.name.trim().toLowerCase() === "color",
        );
        const newVariantColorMediaUrls: Record<string, string[]> = {};
        const newVariantColorFiles = Object.entries(variantColorImages).flatMap(
          ([color, files]) => files.map((file) => ({ color, file })),
        );
        for (const item of newVariantColorFiles) {
          const resourceUrl = await uploadPendingReviewImage(idToken, item.file);
          newVariantColorMediaUrls[item.color] = [
            ...(newVariantColorMediaUrls[item.color] || []),
            resourceUrl,
          ];
        }
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
            mediaUrls:
              colorOptionIndex >= 0
                ? newVariantColorMediaUrls[v.options[colorOptionIndex]] || []
                : [],
          })),
        };
      }

      const pendingColorFiles = editColorGroups.flatMap((group) =>
        (editColorImageFiles[group.label] || []).map((file) => ({
          group,
          file,
        })),
      );
      const removeUrlsByColor = Object.fromEntries(
        editColorGroups
          .map((group) => [
            group.label,
            Object.entries(editColorImageRemovals[group.label] || {})
              .filter(([, selected]) => selected)
              .map(([url]) => url),
          ])
          .filter(([, urls]) => (urls as string[]).length),
      ) as Record<string, string[]>;
      if (pendingColorFiles.length || Object.keys(removeUrlsByColor).length) {
        const resourceUrlsByColor: Record<string, string[]> = {};
        for (let index = 0; index < pendingColorFiles.length; index += 1) {
          const item = pendingColorFiles[index];
          const resourceUrl = await uploadPendingReviewImage(idToken, item.file);
          resourceUrlsByColor[item.group.label] = [
            ...(resourceUrlsByColor[item.group.label] || []),
            resourceUrl,
          ];
        }
        payload.variantMediaUpdates = editColorGroups
          .filter(
            (group) =>
              resourceUrlsByColor[group.label]?.length ||
              removeUrlsByColor[group.label]?.length,
          )
          .map((group) => ({
            color: group.label,
            variantIds: group.variantIds,
            resourceUrls: resourceUrlsByColor[group.label] || [],
            removeResourceUrls: removeUrlsByColor[group.label] || [],
          }));
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
    } finally {
      setImageBusy(false);
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
  function positiveNum(v: any) {
    const n = num(v);
    return n != null && n > 0 ? n : undefined;
  }
  function requireBulkField<T>(
    value: T | undefined | null | "",
    message: string,
  ): T {
    if (value === "" || value == null) throw new Error(message);
    return value;
  }
  function bulkGarmentCategory(row: Record<string, any>): GarmentCategory {
    return String(row["garmentcategory"] ?? row["category"] ?? "")
      .trim()
      .toLowerCase() === "bottoms"
      ? "Bottoms"
      : "Tops";
  }
  function bulkFitType(row: Record<string, any>): FitType {
    const fit = String(row["fittype"] ?? row["fit"] ?? "")
      .trim()
      .toLowerCase();
    if (fit === "slim") return "Slim";
    if (fit === "oversized") return "Oversized";
    return "Regular";
  }
  function bulkMeasurements(
    row: Record<string, any>,
    category: GarmentCategory,
    fit: FitType,
    sizeValue = "",
  ): ProductMeasurements {
    const generated = measurementsForVariant(category, fit, sizeValue);
    return {
      ...emptyMeasurements(),
      ...generated,
      chest:
        num(row["chestsize"] ?? row["chest"] ?? row["bustsize"] ?? row["bust"]) ??
        generated?.chest ??
        null,
      bust:
        num(row["bustsize"] ?? row["bust"] ?? row["chestsize"] ?? row["chest"]) ??
        generated?.chest ??
        null,
      waist: num(row["waistsize"] ?? row["waist"]) ?? generated?.waist ?? null,
      hip: num(row["hipsize"] ?? row["hip"]) ?? generated?.hip ?? null,
      length: num(row["lengthsize"] ?? row["length"]) ?? generated?.length ?? null,
      shoulder:
        num(row["shouldersize"] ?? row["shoulder"]) ?? generated?.shoulder ?? null,
      inseam:
        num(row["inseamsize"] ?? row["inseam"]) ?? generated?.inseam ?? null,
      unit: "in",
    };
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
    const category = bulkGarmentCategory(row);
    const fit = bulkFitType(row);
    const sizeOptionIndex = options.findIndex(
      (option) => option.name.trim().toLowerCase() === "size",
    );
    const variants = combos.map((vals) => ({
      options: vals,
      title: vals.join(" / "),
      price: positiveNum(row["variantprice"]) ?? positiveNum(row["price"]),
      compareAtPrice:
        num(row["variantcompareat"]) ?? num(row["compareatprice"]) ?? undefined,
      sku: String(row["variantsku"] ?? "").trim() || undefined,
      quantity: num(row["variantqty"]) ?? num(row["quantity"]) ?? 0,
      barcode: String(row["variantbarcode"] ?? "").trim() || undefined,
      weightGrams:
        positiveNum(row["variantweightgrams"]) ??
        positiveNum(row["weightgrams"]) ??
        undefined,
      measurements: bulkMeasurements(
        row,
        category,
        fit,
        sizeOptionIndex >= 0 ? vals[sizeOptionIndex] : "",
      ),
    }));

    return { options, variants };
  }
  function rowToCreateBody(row: any) {
    const map: Record<string, any> = {};
    for (const [k, v] of Object.entries(row)) map[norm(k)] = v;

    const title = String(map["title"] ?? "").trim();
    const basePrice = positiveNum(map["price"]); // treat as base price
    if (!title || basePrice == null) throw new Error("Missing Title or valid Price");

    // NEW: delivery charge flag (defaults to true, like the Add form)
    const handleDelivery = boolFromCell(map["handledeliverycharge"], true);
    const price = basePrice + (handleDelivery ? 100 : 0);

    const compareAtPrice = requireBulkField(
      positiveNum(map["compareatprice"]),
      "Missing valid CompareAtPrice",
    );
    const cost = num(map["cost"]);
    const barcode = String(map["barcode"] ?? "").trim() || undefined;
    const weightGrams = requireBulkField(
      positiveNum(map["weightgrams"]),
      "Missing valid WeightGrams",
    );
    const quantity = num(map["quantity"]) ?? 0;

    const vendor = requireBulkField(
      String(map["vendor"] ?? "").trim(),
      "Missing Vendor",
    );
    const productType = requireBulkField(
      String(map["producttype"] ?? "").trim(),
      "Missing ProductType",
    );
    const tags = csvToArr(map["tags"]);
    const seoTitle = String(map["seotitle"] ?? "").trim() || undefined;
    const seoDescription =
      String(map["seodescription"] ?? "").trim() || undefined;
    const sku = requireBulkField(String(map["sku"] ?? "").trim(), "Missing SKU");

    const resourceUrls = csvToArr(map["imageurls"]);
    const variantDraft = buildVariantDraft(map);
    const garmentCategory = bulkGarmentCategory(map);
    const fitType = bulkFitType(map);
    const measurements = bulkMeasurements(map, garmentCategory, fitType);

    if (!seoTitle || !seoDescription) {
      throw new Error("Missing SeoTitle or SeoDescription");
    }
    if (!variantDraft) {
      const missingMeasurements =
        garmentCategory === "Tops"
          ? measurements.chest == null ||
            measurements.shoulder == null ||
            measurements.length == null
          : measurements.waist == null;
      if (missingMeasurements) {
        throw new Error("Missing required measurements");
      }
    }

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
      garmentCategory,
      fitType,
      vendor,
      productType,
      variantMode: variantDraft ? "multiple" : "single",
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
          <DialogContent className="w-[calc(100vw-2rem)] max-w-5xl max-h-[90vh] overflow-x-hidden overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add New Product</DialogTitle>
            </DialogHeader>

            <form
              id="add-product-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submitAddProduct(event.currentTarget);
              }}
              noValidate
              className="min-w-0 space-y-8"
            >
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

              <div className="space-y-3 border-t pt-4">
                <div>
                  <h3 className="font-semibold">Product variant setup</h3>
                  <p className="text-xs text-muted-foreground">
                    Choose one setup. Only the selected setup will be sent for
                    admin review.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => switchVariantMode("single")}
                    className={`rounded-lg border p-4 text-left transition-colors ${
                      variantMode === "single"
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/40"
                    }`}
                  >
                    <span className="block font-medium">Single variant</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      One size and color with one set of measurements.
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => switchVariantMode("multiple")}
                    className={`rounded-lg border p-4 text-left transition-colors ${
                      variantMode === "multiple"
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/40"
                    }`}
                  >
                    <span className="block font-medium">Multiple variants</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      Multiple size/color combinations with measurements per
                      variant.
                    </span>
                  </button>
                </div>
              </div>

              {/* Product Measurements */}
              {variantMode === "single" && (
              <div className="space-y-4 border-t pt-4">
                <div>
                  <h3 className="font-semibold">
                    Single Variant Details &amp; Measurements
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    This creates one product option and stores its size,
                    color, inventory, and garment measurements.
                  </p>
                </div>

                <div className="rounded-lg border bg-muted/20 p-4">
                  <div className="mb-3">
                    <Label>
                      Single variant photo <span className="text-destructive">*</span>
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Upload up to 5 clear photos for this variant.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-4">
                    {imagePreviews.map((preview, index) => (
                      <div key={preview} className="relative h-28 w-28">
                        <img
                          src={preview}
                          alt="Single variant preview"
                          className="h-full w-full rounded-md border object-cover"
                        />
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon"
                          className="absolute -right-2 -top-2 h-6 w-6 rounded-full"
                          onClick={() => removeLocalImage(index)}
                          title="Remove photo"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                    <label className="flex h-28 w-40 cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed hover:bg-muted/50">
                      <Upload className="mb-2 h-5 w-5 text-muted-foreground" />
                      <span className="text-sm font-medium">
                         {selectedImages.length ? "Add more photos" : "Upload photos"}
                      </span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/jpg,image/webp"
                        multiple
                        className="hidden"
                        onChange={handleImageSelect}
                      />
                    </label>
                  </div>
                </div>

                <div className="grid gap-3 rounded-md border bg-muted/20 p-3 sm:grid-cols-2 lg:grid-cols-[130px_1fr_150px_150px_auto] lg:items-end">
                  <div className="space-y-2">
                    <Label>Size</Label>
                    <Select
                      value={fallbackSize}
                      onValueChange={(value) => {
                        setFallbackSize(value);
                        autofillFallbackMeasurements(value, garmentCategory, fitType);
                      }}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {sizesForCategory(garmentCategory).map((size) => (
                          <SelectItem key={size} value={size}>{size}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="single-variant-color">Color</Label>
                    <Input
                      id="single-variant-color"
                      placeholder="e.g. Black"
                      value={singleColor}
                      onChange={(event) => setSingleColor(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Garment category</Label>
                    <Select
                      value={garmentCategory}
                      onValueChange={(value) => {
                        handleGarmentCategoryChange(value as GarmentCategory);
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
                        const fit = value as FitType;
                        setFitType(fit);
                        autofillFallbackMeasurements(fallbackSize, garmentCategory, fit);
                        generateVariants(garmentCategory, fit);
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
                  <Button type="button" variant="secondary" onClick={() => autofillFallbackMeasurements()}>
                    Auto-fill size
                  </Button>
                </div>

                <div className="max-w-sm space-y-2">
                  <Label htmlFor="quantity">
                    Single Variant Quantity{" "}
                    <span className="text-destructive">*</span>
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

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {garmentCategory === "Tops" && (
                  <div className="space-y-2">
                    <Label htmlFor="bust-size">Chest/Bust (in) <span className="text-destructive">*</span></Label>
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
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="waist-size">Waist Size (in) {garmentCategory === "Bottoms" && <span className="text-destructive">*</span>}</Label>
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

                  {garmentCategory === "Bottoms" && (
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
                  )}

                  {garmentCategory === "Tops" && (
                  <div className="space-y-2">
                    <Label htmlFor="shoulder-size">Shoulder (in) <span className="text-destructive">*</span></Label>
                    <Input
                      id="shoulder-size"
                      name="shoulder-size"
                      type="number"
                      min={0}
                      step="0.1"
                      placeholder="e.g. 17"
                      value={draftShoulderSize}
                      onChange={(e) => setDraftShoulderSize(e.target.value)}
                    />
                  </div>
                  )}

                  {garmentCategory === "Bottoms" && (
                  <div className="space-y-2">
                    <Label htmlFor="inseam-size">Inseam (in)</Label>
                    <Input
                      id="inseam-size"
                      name="inseam-size"
                      type="number"
                      min={0}
                      step="0.1"
                      placeholder="e.g. 30"
                      value={draftInseamSize}
                      onChange={(e) => setDraftInseamSize(e.target.value)}
                    />
                  </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="length-size">Length Size (in) {garmentCategory === "Tops" && <span className="text-destructive">*</span>}</Label>
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
              )}

              {/* Product meta */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="product-type">Product Type</Label>
                  <ProductTypeCombobox
                    id="product-type"
                    name="product-type"
                    value={draftProductType}
                    isCustom={useCustomProductType}
                    onValueChange={setDraftProductType}
                    onCustomChange={setUseCustomProductType}
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

              <div className="min-w-0 space-y-2">
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
              {variantMode === "multiple" && (
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
                variantColorImagePreviews={variantColorImagePreviews}
                onAddVariantColorImages={addVariantColorImages}
                onRemoveVariantColorImage={removeVariantColorImage}
              />
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="price">Selling Price ({"\u20B9"}) *</Label>
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
                      Final selling price:{" "}
                    </span>
                    <span className="font-medium">
                      {/* compute final price for display (treat empty as 0) */}
                      {"\u20B9"}
                      {(
                        Number(basePriceInput || 0) +
                        (handleDeliveryCharge ? 100 : 0)
                      ).toLocaleString("en-IN", {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      (
                      {handleDeliveryCharge
                        ? `+\u20B9100 delivery`
                        : "no delivery added"}
                      )
                    </span>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="compare-price">
                    MRP ({"\u20B9"}){" "}
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
                  <Label htmlFor="cost">Cost per Item ({"\u20B9"})</Label>
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
                  <Label htmlFor="weight">
                    Weight (grams) <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="weight"
                    name="weight"
                    type="number"
                    placeholder="500"
                    min={0}
                    required
                    value={draftWeight}
                    onChange={(e) => setDraftWeight(e.target.value)}
                  />
                </div>
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
                  <SelectTrigger id="status" className="max-w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="item-aligned" className="max-h-48">
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  If variants are provided, the product will be sent for{" "}
                  <b>Review</b> and mark it's status as <b>In review</b>.
                </p>
              </div>

              {/* Add form actions: Save draft, Discard, Submit */}
              <div className="sticky bottom-0 z-10 border-t bg-background/95 py-4 backdrop-blur">
                {submitFeedback && (
                  <p
                    role="status"
                    className="mb-3 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-900"
                  >
                    {submitFeedback}
                  </p>
                )}
                <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleClearAddProductForm}
                >
                  Clear Form
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSaveAddProductDraft}
                >
                  Save Draft
                </Button>

                <Button
                  type="button"
                  disabled={busy}
                  onClick={handleSubmitForReviewClick}
                >
                  {busy ? "Submitting..." : "Submit for review"}
                </Button>
                </div>
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
                    <TableHead>Product Type</TableHead>
                    <TableHead>Collections</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((p) => {
                    const isLocalDraft =
                      p.isLocalDraft === true || p.status === "local_draft";
                    const isShopifyDraft =
                      !isLocalDraft &&
                      (String(p.shopifyStatus || "").toUpperCase() === "DRAFT" ||
                        p.published === false);
                    const img = isLocalDraft
                      ? p.imagePreview || ""
                      : p.image || (p.images?.[0] ?? "");
                    const statusClass = isLocalDraft
                      ? "bg-purple-500/10 text-purple-700 border-purple-500/20"
                      : isShopifyDraft
                        ? "bg-sky-500/10 text-sky-700 border-sky-500/20"
                      : p.status === "approved" || p.status === "active"
                        ? "bg-green-500/10 text-green-700 border-green-500/20"
                        : p.status === "pending"
                          ? "bg-yellow-500/10 text-yellow-700 border-yellow-500/20"
                          : p.status === "update_in_review"
                            ? "bg-blue-500/10 text-blue-700 border-blue-500/20"
                            : "bg-muted text-muted-foreground border-muted";
                    const statusText = isLocalDraft
                      ? "Draft"
                      : isShopifyDraft
                        ? "Shopify draft"
                      : p.status === "approved" || p.status === "active"
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
                        <TableCell className="max-w-[260px]">
                          {p.collections?.length
                            ? p.collections.join(", ")
                            : "-"}
                        </TableCell>
                        <TableCell>
                          {p.price != null
                            ? `\u20B9${Number(p.price).toLocaleString("en-IN")}`
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
                                  onClick={() => {
                                    if (p.draft) {
                                      restoreAddDraft(p.draft);
                                      setIsAddProductOpen(true);
                                      toast.success("Draft restored");
                                    }
                                  }}
                                  title="Edit local draft"
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => {
                                    const draftId = p.draft?.id;
                                    if (draftId) {
                                      void clearAddProductDraft(uid, draftId);
                                      setLocalDrafts((drafts) =>
                                        drafts.filter(
                                          (draft) => draft.id !== draftId,
                                        ),
                                      );
                                    }
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
          <DialogContent className="w-[calc(100vw-2rem)] max-w-5xl max-h-[90vh] overflow-x-hidden overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Product</DialogTitle>
            </DialogHeader>

            {editing && (
              <form onSubmit={handleEditSubmit} className="min-w-0 space-y-6">
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
                    <ProductTypeCombobox
                      value={eProductType}
                      isCustom={eUseCustomProductType}
                      onValueChange={setEProductType}
                      onCustomChange={setEUseCustomProductType}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea
                    rows={4}
                    value={eDescription}
                    onChange={(event) => setEDescription(event.target.value)}
                  />
                </div>

                <div className="space-y-2">
                    <Label>Tags (comma-separated)</Label>
                    <Input
                      value={eTags}
                      onChange={(e) => setETags(e.target.value)}
                    />
                  </div>

                <div className="space-y-2">
                  <Label>Collections</Label>
                  <div className="flex flex-wrap gap-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" variant="outline">
                          Select collections
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="max-h-72 w-64 overflow-y-auto">
                        <DropdownMenuLabel>Collections</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {COLLECTION_OPTIONS.map((collection) => (
                          <DropdownMenuCheckboxItem
                            key={collection}
                            checked={eCollections.includes(collection)}
                            onCheckedChange={(checked) =>
                              setECollections((current) =>
                                checked
                                  ? [...new Set([...current, collection])]
                                  : current.filter((item) => item !== collection),
                              )
                            }
                          >
                            {collection}
                          </DropdownMenuCheckboxItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Input
                      className="max-w-xs"
                      placeholder="Custom collection"
                      value={eCustomCollectionName}
                      onChange={(event) => setECustomCollectionName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        const value = eCustomCollectionName.trim();
                        if (!value) return;
                        setECollections((current) => [...new Set([...current, value])]);
                        setECustomCollectionName("");
                      }}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        const value = eCustomCollectionName.trim();
                        if (!value) return;
                        setECollections((current) => [...new Set([...current, value])]);
                        setECustomCollectionName("");
                      }}
                    >
                      Add
                    </Button>
                  </div>
                  {!!eCollections.length && (
                    <div className="flex flex-wrap gap-2">
                      {eCollections.map((collection) => (
                        <Badge key={collection} variant="outline" className="gap-1">
                          {collection}
                          <button
                            type="button"
                            onClick={() =>
                              setECollections((current) =>
                                current.filter((item) => item !== collection),
                              )
                            }
                            aria-label={`Remove ${collection}`}
                          >
                            {"\u00D7"}
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4 border-t pt-4">
                  <div className="space-y-2">
                    <Label>Vendor</Label>
                    <Input
                      placeholder="Brand name"
                      value={eVendor}
                      onChange={(event) => setEVendor(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Selling Price ({"\u20B9"})</Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={ePrice}
                      onChange={(event) =>
                        setEPrice(
                          event.target.value === ""
                            ? ""
                            : Number(event.target.value),
                        )
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>MRP ({"\u20B9"})</Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder="Compare at price"
                      value={eCompareAt}
                      onChange={(event) =>
                        setECompareAt(
                          event.target.value === ""
                            ? ""
                            : Number(event.target.value),
                        )
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Stock</Label>
                    <Input
                      type="number"
                      min={0}
                      value={eStock}
                      onChange={(event) =>
                        setEStock(
                          event.target.value === ""
                            ? ""
                            : Number(event.target.value),
                        )
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Barcode (ISBN, UPC, etc.)</Label>
                    <Input
                      placeholder="123456789"
                      value={eBarcode}
                      onChange={(event) => setEBarcode(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Weight (grams)</Label>
                    <Input
                      type="number"
                      min={0}
                      placeholder="500"
                      value={eWeight}
                      onChange={(event) =>
                        setEWeight(
                          event.target.value === ""
                            ? ""
                            : Number(event.target.value),
                        )
                      }
                    />
                  </div>
                </div>

                <div className="space-y-3 border-t pt-4">
                  <h3 className="font-semibold">Search Engine Listing</h3>
                  <div className="space-y-2">
                    <Label>SEO Title</Label>
                    <Input
                      value={eSeoTitle}
                      onChange={(event) => setESeoTitle(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>SEO Description</Label>
                    <Textarea
                      rows={3}
                      value={eSeoDesc}
                      onChange={(event) => setESeoDesc(event.target.value)}
                    />
                  </div>
                </div>

                {/* Product images */}
                <div className="border-t pt-4 space-y-3">
                  {loadingDetails ? (
                    <div className="text-sm text-muted-foreground">
                      Loading product photos...
                    </div>
                  ) : editColorGroups.length > 0 ? (
                    <div className="space-y-4 rounded-md border bg-muted/20 p-3">
                      <div>
                        <h3 className="font-semibold">
                          Photos by colour variant
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          Remove or add photos under the exact colour group.
                          Changes are sent to admin review.
                        </p>
                      </div>
                      {editColorGroups.map((group) => (
                        <div key={group.label} className="space-y-2 border-t pt-3 first:border-t-0 first:pt-0">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <div className="font-medium">{group.label}</div>
                              <div className="text-xs text-muted-foreground">
                                {group.variantIds.length} size variant{group.variantIds.length === 1 ? "" : "s"}
                              </div>
                            </div>
                            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm hover:bg-muted/50">
                              <ImagePlus className="h-4 w-4" />
                              Add {group.label} photos
                              <input
                                type="file"
                                accept="image/png,image/jpeg,image/jpg,image/webp"
                                multiple
                                className="hidden"
                                onChange={(event) => {
                                  addEditColorImages(
                                    group.label,
                                    Array.from(event.target.files || []),
                                  );
                                  event.target.value = "";
                                }}
                              />
                            </label>
                          </div>

                          {!!group.existingUrls.length && (
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                              {group.existingUrls.map((url) => (
                                <label
                                  key={`${group.label}-${url}`}
                                  className={`relative block overflow-hidden rounded-md border bg-background ${
                                    editColorImageRemovals[group.label]?.[url]
                                      ? "ring-2 ring-destructive"
                                      : ""
                                  }`}
                                >
                                  <img
                                    src={url}
                                    alt={`${group.label} variant`}
                                    className="h-32 w-full object-cover"
                                  />
                                  <div className="absolute left-2 top-2 rounded bg-white/85 px-1.5 py-0.5 text-xs">
                                    <input
                                      type="checkbox"
                                      checked={
                                        !!editColorImageRemovals[group.label]?.[url]
                                      }
                                      onChange={(event) =>
                                        setEditColorImageRemoval(
                                          group.label,
                                          url,
                                          event.target.checked,
                                        )
                                      }
                                    />{" "}
                                    Remove
                                  </div>
                                </label>
                              ))}
                            </div>
                          )}

                          {!!(editColorImagePreviews[group.label] || []).length && (
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                              {(editColorImagePreviews[group.label] || []).map(
                                (preview, index) => (
                                  <div
                                    key={`${group.label}-new-${index}`}
                                    className="relative overflow-hidden rounded-md border border-dashed bg-background"
                                  >
                                    <img
                                      src={preview}
                                      alt={`${group.label} new variant`}
                                      className="h-32 w-full object-cover"
                                    />
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="secondary"
                                      className="absolute right-2 top-2"
                                      onClick={() =>
                                        removeEditColorImage(group.label, index)
                                      }
                                    >
                                      <X className="h-3 w-3" />
                                    </Button>
                                  </div>
                                ),
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <>
                      <h3 className="font-semibold">Current product photos</h3>
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted/50">
                          <ImagePlus className="h-4 w-4" />
                          Choose product photos
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/jpg,image/webp"
                            multiple
                            className="hidden"
                            onChange={(event) => {
                              onEditChooseImages(event);
                              event.target.value = "";
                            }}
                          />
                        </label>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={onEditAttachImages}
                          disabled={imageBusy || !imageAddFiles.length}
                        >
                          {imageBusy ? "Uploading..." : `Add selected${imageAddFiles.length ? ` (${imageAddFiles.length})` : ""}`}
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
                          {imageBusy ? "Removing..." : "Remove selected"}
                        </Button>
                      </div>

                      {imagesLive.length === 0 ? (
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
                    </>
                  )}
                </div>

                {/* Existing variants (live) */}
                <div className="border-t pt-4">
                  <h3 className="font-semibold mb-2">
                    Existing variants (live)
                  </h3>
                  {loadingDetails ? (
                    <div className="text-sm text-muted-foreground">
                      Loading variants...
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
                            <th className="text-left p-2">Price ({"\u20B9"})</th>
                            <th className="text-left p-2">Stock</th>
                            <th className="text-left p-2">Chest/Bust (in)</th>
                            <th className="text-left p-2">Waist (in)</th>
                            <th className="text-left p-2">Hip (in)</th>
                            <th className="text-left p-2">Length (in)</th>
                            <th className="text-left p-2">Shoulder (in)</th>
                            <th className="text-left p-2">Inseam (in)</th>
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
                                <td className="p-2">{v.sku || "\u2014"}</td>
                                <td className="p-2">{v.barcode || "\u2014"}</td>
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
                                {(
                                  [
                                    "bust",
                                    "waist",
                                    "hip",
                                    "length",
                                    "shoulder",
                                    "inseam",
                                  ] as const
                                ).map((field) => (
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
                                  ))}
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

                {/* Add more variants (planner to review) */}
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
                    variantColorImagePreviews={variantColorImagePreviews}
                    onAddVariantColorImages={addVariantColorImages}
                    onRemoveVariantColorImage={removeVariantColorImage}
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
                      ? `\u20B9${deleteTarget.price}`
                      : "—"}
                  </div>
                  <div>
                    <span className="font-medium">SKU:</span>{" "}
                    {deleteTarget.sku || "\u2014"}
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
                  . The first sheet's first row must be headers. See the sample
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
                  {bulkRunning ? "Uploading..." : "Start upload"}
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
function ProductTypeCombobox(props: {
  id?: string;
  name?: string;
  value: string;
  isCustom: boolean;
  onValueChange: (value: string) => void;
  onCustomChange: (custom: boolean) => void;
}) {
  const { id, name, value, isCustom, onValueChange, onCustomChange } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return PRODUCT_TYPE_OPTIONS;
    return PRODUCT_TYPE_OPTIONS.filter((option) =>
      option.toLowerCase().includes(normalized),
    );
  }, [query]);

  const selectedLabel = isCustom
    ? value || "Custom product type"
    : value || "Select product type";

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
          >
            <span className={value || isCustom ? "" : "text-muted-foreground"}>
              {selectedLabel}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <div className="border-b p-2">
            <div className="flex items-center rounded-md border px-2">
              <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search product type..."
                className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto p-1">
            {filteredOptions.length ? (
              filteredOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  className="flex w-full items-center rounded-sm px-2 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => {
                    onCustomChange(false);
                    onValueChange(option);
                    setQuery("");
                    setOpen(false);
                  }}
                >
                  <span className="mr-2 w-4 text-center">
                    {!isCustom && value === option ? "*" : ""}
                  </span>
                  {option}
                </button>
              ))
            ) : (
              <div className="px-2 py-3 text-sm text-muted-foreground">
                No matching product type.
              </div>
            )}
            <button
              type="button"
              className="mt-1 flex w-full items-center rounded-sm border-t px-2 py-2 text-left text-sm font-medium hover:bg-accent"
              onClick={() => {
                onCustomChange(true);
                onValueChange("");
                setQuery("");
                setOpen(false);
              }}
            >
              Add your own...
            </button>
          </div>
        </PopoverContent>
      </Popover>
      {isCustom && (
        <Input
          name={name}
          placeholder="Enter custom product type"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
        />
      )}
      {!isCustom && name ? (
        <input type="hidden" name={name} value={value} />
      ) : null}
    </div>
  );
}

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
  variantColorImagePreviews?: Record<string, string[]>;
  onAddVariantColorImages?: (color: string, files: File[]) => void;
  onRemoveVariantColorImage?: (color: string, index: number) => void;
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
    variantColorImagePreviews,
    onAddVariantColorImages,
    onRemoveVariantColorImage,
  } = props;

  const colorOption = options.find(
    (option) => option.name.trim().toLowerCase() === "color",
  );

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
    <div className="min-w-0 max-w-full space-y-3 overflow-hidden">
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
                  {v} <span className="ml-1 opacity-60">{"\u00D7"}</span>
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
                placeholder={
                  opt.name.trim().toLowerCase() === "size"
                    ? "Add sizes comma separated, e.g. S, M, L. Use M only, not medium."
                    : "Enter values (comma separated), press Add"
                }
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

      {colorOption?.values.length && onAddVariantColorImages ? (
        <div className="space-y-3 rounded-md border p-3">
          <div>
            <Label>
              Photos for each colour <span className="text-destructive">*</span>
            </Label>
            <p className="text-xs text-muted-foreground">
              Add 1-5 photos per colour. Each set is linked to every size
              using that colour, so customers never see another colour's photos.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {colorOption.values.map((color) => (
              <div key={color} className="space-y-2 rounded-md bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{color}</span>
                  <label className="cursor-pointer text-sm font-medium text-primary hover:underline">
                    Add photos
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/jpg,image/webp"
                      multiple
                      className="hidden"
                      onChange={(event) => {
                        onAddVariantColorImages(
                          color,
                          Array.from(event.target.files || []),
                        );
                        event.target.value = "";
                      }}
                    />
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(variantColorImagePreviews?.[color] || []).map(
                    (preview, index) => (
                      <div key={`${color}-${index}`} className="relative">
                        <img
                          src={preview}
                          alt={`${color} variant ${index + 1}`}
                          className="h-16 w-16 rounded-md border object-cover"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            onRemoveVariantColorImage?.(color, index)
                          }
                          className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-xs text-destructive-foreground"
                          aria-label={`Remove ${color} image ${index + 1}`}
                        >
                          {"\u00D7"}
                        </button>
                      </div>
                    ),
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

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
          <div className="w-full max-w-full overflow-x-auto overscroll-x-contain rounded-md border">
            <table className="w-full min-w-[1240px] table-fixed text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="w-[140px] text-left p-2">Variant</th>
                  <th className="w-[125px] text-left p-2">
                    Price ({"\u20B9"}) <span className="text-destructive">*</span>
                  </th>
                  <th className="w-[140px] text-left p-2">
                    Compare at ({"\u20B9"}) <span className="text-destructive">*</span>
                  </th>
                  <th className="w-[160px] text-left p-2">SKU (optional)</th>
                  <th className="w-[90px] text-left p-2">
                    Qty <span className="text-destructive">*</span>
                  </th>
                  <th className="w-[140px] text-left p-2">Barcode (optional)</th>
                  <th className="w-[105px] text-left p-2">
                    Weight (g) <span className="text-destructive">*</span>
                  </th>
                  {measurementFields.map((field) => (
                    <th key={field} className="w-[115px] text-left p-2">
                      {measurementLabels[field]}{" "}
                      {(
                        garmentCategory === "Tops"
                          ? ["chest", "length", "shoulder"].includes(field)
                          : field === "waist"
                      ) && <span className="text-destructive">*</span>}
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
                          required
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
                          required
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
                          required
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
                          required
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
                                required={
                                  garmentCategory === "Tops"
                                    ? ["chest", "length", "shoulder"].includes(field)
                                    : field === "waist"
                                }
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







