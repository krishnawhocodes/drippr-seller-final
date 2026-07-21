// pages/api/admin/products/create.ts
import { getAdmin } from "../../_lib/firebaseAdmin.js";
import { shopifyGraphQL } from "../../_lib/shopify.js";

type FirestoreDeleteRef = {
  delete: () => Promise<unknown>;
};

/* ---------------- helpers: sku ---------------- */
function normSku(raw: string): string {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "-");
}

function skuClaimId(uid: string, sku: string) {
  return `${uid}__${normSku(sku)}`;
}

function normalizeLocationId(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  return raw.startsWith("gid://shopify/Location/")
    ? raw
    : `gid://shopify/Location/${raw}`;
}

function runtimeEnv(name: string) {
  const runtime = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  };
  return runtime.process?.env?.[name];
}

function normalizeMeasurements(input: any) {
  if (!input || typeof input !== "object") return null;

  const toNumOrNull = (value: any) => {
    if (value === "" || value == null) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  return {
    chest: toNumOrNull(input.chest ?? input.bust),
    bust: toNumOrNull(input.bust),
    waist: toNumOrNull(input.waist),
    hip: toNumOrNull(input.hip),
    length: toNumOrNull(input.length),
    shoulder: toNumOrNull(input.shoulder),
    inseam: toNumOrNull(input.inseam),
    unit: "in",
  };
}

function hasAnyMeasurement(measurements: any) {
  return Boolean(
    measurements &&
      ["chest", "bust", "waist", "hip", "length", "shoulder", "inseam"].some(
        (key) => typeof measurements[key] === "number",
      ),
  );
}

function normalizeVariantDraft(input: any) {
  if (!input || typeof input !== "object") return null;

  const options = Array.isArray(input.options)
    ? input.options
        .map((option: any) => ({
          name: String(option?.name || "").trim(),
          values: Array.isArray(option?.values)
            ? option.values.map((value: any) => String(value).trim()).filter(Boolean)
            : [],
        }))
        .filter((option: any) => option.name && option.values.length)
    : [];

  const variants = Array.isArray(input.variants)
    ? input.variants
        .map((variant: any) => {
          const optionValues = Array.isArray(variant?.optionValues)
            ? variant.optionValues
            : Array.isArray(variant?.options)
              ? variant.options
              : [];
          const normalizedMeasurements = normalizeMeasurements(
            variant?.measurements,
          );
          return {
            options: optionValues.map((value: any) => String(value).trim()).filter(Boolean),
            optionValues: optionValues
              .map((value: any) => String(value).trim())
              .filter(Boolean),
            title:
              String(variant?.title || "").trim() ||
              optionValues.map((value: any) => String(value).trim()).join(" / "),
            price:
              variant?.price == null || variant.price === ""
                ? undefined
                : Number(variant.price),
            compareAtPrice:
              variant?.compareAtPrice == null || variant.compareAtPrice === ""
                ? undefined
                : Number(variant.compareAtPrice),
            sku: String(variant?.sku || "").trim() || undefined,
            quantity:
              variant?.quantity == null || variant.quantity === ""
                ? undefined
                : Number(variant.quantity),
            barcode: String(variant?.barcode || "").trim() || undefined,
            weightGrams:
              variant?.weightGrams == null || variant.weightGrams === ""
                ? undefined
                : Number(variant.weightGrams),
            mediaUrls: Array.isArray(variant?.mediaUrls)
              ? variant.mediaUrls
                  .map((url: unknown) => String(url).trim())
                  .filter(Boolean)
              : [],
            measurements: hasAnyMeasurement(normalizedMeasurements)
              ? normalizedMeasurements
              : null,
          };
        })
        .filter((variant: any) => variant.optionValues.length)
    : [];

  return options.length || variants.length ? { options, variants } : null;
}

function toFiniteNumber(value: any) {
  if (value === "" || value == null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isPositiveNumber(value: any) {
  const parsed = toFiniteNumber(value);
  return parsed !== undefined && parsed > 0;
}

function isNonNegativeNumber(value: any) {
  const parsed = toFiniteNumber(value);
  return parsed !== undefined && parsed >= 0;
}

const SELLER_DELIVERY_PRICE_BUMP = 100;

function sellerVariantPriceForShopify(price: unknown, fallback: unknown) {
  const raw = Number(price == null || price === "" ? fallback : price);
  return Number.isFinite(raw) ? raw + SELLER_DELIVERY_PRICE_BUMP : raw;
}

function missingMeasurementFields(measurements: any, category: any) {
  const normalizedCategory = category === "Bottoms" ? "Bottoms" : "Tops";
  const requiredFields =
    normalizedCategory === "Tops"
      ? (["chest", "shoulder", "length"] as const)
      : (["waist"] as const);

  return requiredFields.filter(
    (field) => typeof measurements?.[field] !== "number",
  );
}

function inferVariantMode(
  variantMode: any,
  variantDraft: any,
): "single" | "multiple" {
  if (variantMode === "single" || variantMode === "multiple") {
    return variantMode;
  }

  return (variantDraft?.variants?.length || 0) > 1 ? "multiple" : "single";
}

function validateCreatePayload(args: {
  title: any;
  description: any;
  price: any;
  compareAtPrice: any;
  vendor: any;
  productType: any;
  rawSku: any;
  weightGrams: any;
  inventory: any;
  seo: any;
  variantMode: "single" | "multiple";
  variantDraft: any;
  measurements: any;
  garmentCategory: any;
}) {
  const title = String(args.title || "").trim();
  const description = String(args.description || "").trim();
  const vendor = String(args.vendor || "").trim();
  const productType = String(args.productType || "").trim();
  const sku = String(args.rawSku || "").trim();
  const seoTitle = String(args.seo?.title || "").trim();
  const seoDescription = String(args.seo?.description || "").trim();

  if (!title) return "Product title is required.";
  if (!description) return "Product description is required.";
  if (!isPositiveNumber(args.price)) return "Please enter a valid selling price.";
  if (!isPositiveNumber(args.compareAtPrice)) return "MRP is required.";
  if (!sku) return "SKU is required.";
  if (!vendor) return "Vendor name is required.";
  if (!productType) return "Product type is required.";
  if (!seoTitle || !seoDescription) {
    return "SEO Title and SEO Description are required.";
  }

  const variants = Array.isArray(args.variantDraft?.variants)
    ? args.variantDraft.variants
    : [];

  if (args.variantMode === "single") {
    if (variants.length > 1) {
      return "Single variant products cannot include multiple variant rows.";
    }

    const singleVariant = variants[0] || {};
    const singleWeight = singleVariant.weightGrams ?? args.weightGrams;
    const singleQuantity = singleVariant.quantity ?? args.inventory?.quantity;

    if (!isPositiveNumber(singleWeight)) return "Product weight is required.";
    if (!isNonNegativeNumber(singleQuantity)) {
      return "Quantity is required for the single variant.";
    }
    if (missingMeasurementFields(args.measurements, args.garmentCategory).length) {
      return "Please add all required garment measurements for the selected category.";
    }
    return null;
  }

  if (!variants.length) {
    return "Add at least one complete variant combination before submitting.";
  }

  const options = Array.isArray(args.variantDraft?.options)
    ? args.variantDraft.options
    : [];
  const colorOption = options.find(
    (option: any) => String(option?.name || "").trim().toLowerCase() === "color",
  );
  if (!colorOption?.values?.length) {
    return "Add a Color option for variant-wise photos.";
  }

  if (variants.some((variant: any) => !isPositiveNumber(variant.price))) {
    return "Enter a selling price for every variant.";
  }
  if (variants.some((variant: any) => !isPositiveNumber(variant.compareAtPrice))) {
    return "Enter MRP for every variant.";
  }
  if (variants.some((variant: any) => !isNonNegativeNumber(variant.quantity))) {
    return "Enter a quantity for every variant.";
  }
  if (variants.some((variant: any) => !isPositiveNumber(variant.weightGrams))) {
    return "Enter product weight for every variant.";
  }
  if (
    variants.some(
      (variant: any) =>
        missingMeasurementFields(variant.measurements, args.garmentCategory).length,
    )
  ) {
    return "Please add all required garment measurements for every variant.";
  }

  return null;
}

function buildVariantMeasurements(variantDraft: any) {
  if (!variantDraft?.variants?.length) return [];

  return variantDraft.variants
    .map((variant: any) => ({
      variantId: variant.variantId || null,
      title: variant.title || variant.optionValues?.join(" / ") || "",
      optionValues: variant.optionValues || variant.options || [],
      measurements: hasAnyMeasurement(variant.measurements)
        ? variant.measurements
        : null,
    }))
    .filter((variant: any) => variant.measurements);
}

const MEASUREMENT_METAFIELD_NAMESPACE = "garment_sizing";

function buildMeasurementMetafields(measurements: any) {
  if (!measurements || typeof measurements !== "object") return undefined;

  const fields = ["chest", "length", "shoulder", "waist", "hip", "inseam"] as const;
  const metafields = fields
    .map((key) => {
      const value = measurements[key];
      return typeof value === "number"
        ? {
            namespace: MEASUREMENT_METAFIELD_NAMESPACE,
            key,
            type: "number_decimal",
            value: String(value),
          }
        : null;
    })
    .filter(Boolean);

  return metafields.length ? metafields : undefined;
}

/* ---------------- Shopify GQL ---------------- */

// Create product and optionally attach images via staged resourceUrls.
const PRODUCT_CREATE = /* GraphQL */ `
  mutation productCreate(
    $product: ProductCreateInput!
    $media: [CreateMediaInput!]
  ) {
    productCreate(product: $product, media: $media) {
      product {
        id
        title
        handle
        status
        media(first: 100) {
          edges {
            node {
              mediaContentType
              ... on MediaImage {
                id
                image {
                  url
                  altText
                }
              }
            }
          }
        }
        variants(first: 5) {
          nodes {
            id
            inventoryItem {
              id
            }
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// Definitive, permanent CDN URLs live here.
const PRODUCT_IMAGES_QUERY = /* GraphQL */ `
  query productImages($id: ID!) {
    product(id: $id) {
      id
      images(first: 100) {
        nodes {
          url
        }
      }
    }
  }
`;

const VARIANTS_BULK_UPDATE = /* GraphQL */ `
  mutation productVariantsBulkUpdate(
    $productId: ID!
    $variants: [ProductVariantsBulkInput!]!
  ) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const PRODUCT_OPTIONS_CREATE = /* GraphQL */ `
  mutation productOptionsCreate(
    $productId: ID!
    $options: [OptionCreateInput!]!
  ) {
    productOptionsCreate(
      productId: $productId
      options: $options
      variantStrategy: LEAVE_AS_IS
    ) {
      product {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const VARIANTS_BULK_CREATE = /* GraphQL */ `
  mutation productVariantsBulkCreate(
    $productId: ID!
    $variants: [ProductVariantsBulkInput!]!
  ) {
    productVariantsBulkCreate(
      productId: $productId
      variants: $variants
      strategy: REMOVE_STANDALONE_VARIANT
    ) {
      productVariants {
        id
        title
        selectedOptions {
          name
          value
        }
        inventoryItem {
          id
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const PRODUCT_VARIANT_APPEND_MEDIA = /* GraphQL */ `
  mutation productVariantAppendMedia(
    $productId: ID!
    $variantMedia: [ProductVariantAppendMediaInput!]!
  ) {
    productVariantAppendMedia(
      productId: $productId
      variantMedia: $variantMedia
    ) {
      productVariants {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const INVENTORY_SET_ON_HAND = /* GraphQL */ `
  mutation inventorySetOnHandQuantities(
    $input: InventorySetOnHandQuantitiesInput!
  ) {
    inventorySetOnHandQuantities(input: $input) {
      inventoryAdjustmentGroup {
        createdAt
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/* ---------------- util: CDN fetch with retry ---------------- */

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function listCdnImageUrls(productId: string): Promise<string[]> {
  const response = await shopifyGraphQL(PRODUCT_IMAGES_QUERY, {
    id: productId,
  });
  const nodes = response?.data?.product?.images?.nodes || [];
  return nodes.map((node: any) => String(node.url)).filter(Boolean);
}

/**
 * Poll Shopify a few times until CDN URLs appear.
 * We intentionally do not fall back to staged temporary URLs.
 */
async function fetchCdnUrlsWithRetry(productId: string): Promise<string[]> {
  const tries = 6;
  const baseDelay = 700;

  for (let i = 0; i < tries; i += 1) {
    const urls = await listCdnImageUrls(productId);
    if (urls.length) return urls;
    await sleep(baseDelay * (i + 1));
  }

  return [];
}

async function createShopifyVariants(args: {
  productId: string;
  variantDraft: any;
  basePrice: number;
  baseCompareAtPrice?: number;
  baseSku: string;
  tracked: boolean;
  cost?: number;
  locationId: string | null;
}) {
  const { variantDraft } = args;
  if (!variantDraft?.options?.length || !variantDraft?.variants?.length) {
    return null;
  }

  const optionsInput = variantDraft.options.map((option: any) => ({
    name: option.name,
    values: option.values.map((value: string) => ({ name: value })),
  }));
  const optionsResult = await shopifyGraphQL(PRODUCT_OPTIONS_CREATE, {
    productId: args.productId,
    options: optionsInput,
  });
  const optionErrors =
    optionsResult?.data?.productOptionsCreate?.userErrors || [];
  if (optionErrors.length) {
    throw new Error(optionErrors.map((error: any) => error.message).join("; "));
  }

  const variantsInput = variantDraft.variants.map(
    (variant: any, index: number) => ({
      optionValues: variantDraft.options.map((option: any, optionIndex: number) => ({
        optionName: option.name,
        name: variant.optionValues[optionIndex],
      })),
      price: String(sellerVariantPriceForShopify(variant.price, args.basePrice)),
      ...((variant.compareAtPrice ?? args.baseCompareAtPrice) != null
        ? { compareAtPrice: String(variant.compareAtPrice ?? args.baseCompareAtPrice) }
        : {}),
      ...(variant.barcode ? { barcode: variant.barcode } : {}),
      inventoryItem: {
        sku: variant.sku || `${args.baseSku}-${index + 1}`,
        tracked: args.tracked,
        ...(args.cost != null ? { cost: String(args.cost) } : {}),
      },
      metafields: buildMeasurementMetafields(variant.measurements),
    }),
  );

  const variantsResult = await shopifyGraphQL(VARIANTS_BULK_CREATE, {
    productId: args.productId,
    variants: variantsInput,
  });
  const variantErrors =
    variantsResult?.data?.productVariantsBulkCreate?.userErrors || [];
  if (variantErrors.length) {
    throw new Error(variantErrors.map((error: any) => error.message).join("; "));
  }

  const createdVariants =
    variantsResult?.data?.productVariantsBulkCreate?.productVariants || [];
  if (args.locationId) {
    const setQuantities = createdVariants
      .map((created: any, index: number) => ({
        inventoryItemId: created?.inventoryItem?.id,
        locationId: args.locationId,
        quantity: Number(variantDraft.variants[index]?.quantity ?? 0),
      }))
      .filter(
        (item: any) =>
          item.inventoryItemId && Number.isFinite(item.quantity) && item.quantity >= 0,
      );
    if (setQuantities.length) {
      const inventoryResult = await shopifyGraphQL(INVENTORY_SET_ON_HAND, {
        input: { reason: "correction", setQuantities },
      });
      const inventoryErrors =
        inventoryResult?.data?.inventorySetOnHandQuantities?.userErrors || [];
      if (inventoryErrors.length) {
        console.warn("variant inventory errors:", inventoryErrors);
      }
    }
  }

  return createdVariants;
}

async function associateVariantMedia(args: {
  productId: string;
  variantDraft: any;
  createdVariants: any[];
  mediaIdBySource: Map<string, string>;
}) {
  const variantMedia = args.createdVariants
    .flatMap((variant: any) => {
      const createdOptionKey = Array.isArray(variant?.selectedOptions)
        ? variant.selectedOptions
            .map((option: any) => String(option?.value || "").trim())
            .join("|")
        : "";
      const matchingDraft = (args.variantDraft?.variants || []).find(
        (draftVariant: any) =>
          (draftVariant.optionValues || draftVariant.options || [])
            .map((value: unknown) => String(value).trim())
            .join("|") === createdOptionKey,
      );
      const mediaIds = [
        ...new Set(
          (matchingDraft?.mediaUrls || [])
            .map((url: string) => args.mediaIdBySource.get(url))
            .filter(Boolean),
        ),
      ];
      return variant?.id && mediaIds.length
        ? mediaIds.map((mediaId) => ({
            variantId: variant.id,
            mediaIds: [mediaId],
          }))
        : [];
    })
    .filter(Boolean);

  if (!variantMedia.length) return;
  for (const mediaInput of variantMedia) {
    const result = await shopifyGraphQL(PRODUCT_VARIANT_APPEND_MEDIA, {
      productId: args.productId,
      variantMedia: [mediaInput],
    });
    const errors = result?.data?.productVariantAppendMedia?.userErrors || [];
    if (errors.length) {
      throw new Error(errors.map((error: any) => error.message).join("; "));
    }
  }
}

/* ---------------- handler ---------------- */

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  let claimedSkuRef: FirestoreDeleteRef | null = null;

  try {
    const { adminAuth, adminDb } = getAdmin();

    // --- auth ---
    const authHeader = String(req.headers.authorization || "");
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!token) {
      return res
        .status(401)
        .json({ ok: false, error: "Missing Authorization" });
    }

    const decoded = await adminAuth.verifyIdToken(token);
    const merchantId = decoded.uid as string;

    // --- input from React form ---
    const body = req.body || {};
    const {
      title,
      description,
      price,
      compareAtPrice,
      barcode,
      weightGrams,
      inventory = {},
      currency = "INR",
      tags = [],
      resourceUrls = [],
      vendor,
      productType,
      collections = [],
      garmentCategory,
      fitType,
      variantMode,
      seo,
      sku: rawSku,
      variantDraft,
      measurements,
    } = body;

    const sku = normSku(rawSku);
    const normalizedMeasurements = normalizeMeasurements(measurements);
    const normalizedVariantDraft = normalizeVariantDraft(variantDraft);
    const normalizedVariantMode = inferVariantMode(
      variantMode,
      normalizedVariantDraft,
    );
    const validationError = validateCreatePayload({
      title,
      description,
      price,
      compareAtPrice,
      vendor,
      productType,
      rawSku,
      weightGrams,
      inventory,
      seo,
      variantMode: normalizedVariantMode,
      variantDraft: normalizedVariantDraft,
      measurements: normalizedMeasurements,
      garmentCategory,
    });
    if (validationError) {
      return res.status(400).json({ ok: false, error: validationError });
    }

    const variantMeasurements = buildVariantMeasurements(normalizedVariantDraft);

    const shopifyTags = [...new Set([`merchant:${merchantId}`, ...tags])];
    const baseMediaUrls = Array.isArray(resourceUrls)
      ? resourceUrls.map((url: unknown) => String(url).trim()).filter(Boolean)
      : [];
    const variantMediaUrls = (normalizedVariantDraft?.variants || []).flatMap(
      (variant: any) =>
        Array.isArray(variant.mediaUrls) ? variant.mediaUrls : [],
    );
    const reviewImageUrls = [
      ...new Set([...baseMediaUrls, ...variantMediaUrls]),
    ].slice(0, 100);

    // --- SKU claim per merchant ---
    const docRef = adminDb.collection("merchantProducts").doc();
    const claimRef = adminDb
      .collection("skuClaims")
      .doc(skuClaimId(merchantId, sku));

    try {
      await claimRef.create({
        merchantId,
        productDocId: docRef.id,
        createdAt: Date.now(),
      });
      claimedSkuRef = claimRef;
    } catch {
      return res
        .status(409)
        .json({ ok: false, error: "SKU already used by you" });
    }

    // --- Mirror to Firestore for admin review only.
    // Shopify creation is intentionally deferred until queue approval.
    const now = Date.now();
    const sellerStatus = "pending";
    const isMultipleVariantProduct =
      normalizedVariantMode === "multiple" ||
      (normalizedVariantDraft?.variants?.length || 0) > 1;
    const totalVariantStock = isMultipleVariantProduct
      ? (normalizedVariantDraft?.variants || []).reduce(
          (total: number, variant: any) =>
            total +
            (Number.isFinite(Number(variant.quantity))
              ? Number(variant.quantity)
              : 0),
          0,
        )
      : Number(inventory?.quantity ?? 0);

    const mirrorDoc = {
      id: docRef.id,
      merchantId,
      title,
      description: description || "",
      price: Number(price),
      compareAtPrice: Number(compareAtPrice),
      currency,
      status: sellerStatus,
      published: false,
      sku,
      barcode: barcode || null,
      seo: seo || null,
      shopifyProductId: null,
      shopifyProductNumericId: null,
      shopifyVariantIds: [],
      shopifyVariantNumericIds: [],
      inventoryItemId: null,
      inventory: {
        quantity:
          inventory?.quantity == null || inventory.quantity === ""
            ? null
            : Number(inventory.quantity),
        tracked: inventory?.tracked !== false,
        cost:
          inventory?.cost == null || inventory.cost === ""
            ? null
            : Number(inventory.cost),
      },
      tags: shopifyTags,

      image: reviewImageUrls[0] || null,
      images: reviewImageUrls,
      imageUrls: reviewImageUrls,
      resourceUrls: baseMediaUrls,

      stock: Number.isFinite(totalVariantStock) ? totalVariantStock : null,
      vendor: vendor || "DRIPPR Marketplace",
      productType: productType || null,
      collections: (Array.isArray(collections) ? collections : [])
        .map((collectionName: unknown) => String(collectionName).trim())
        .filter(Boolean),
      collectionsSynced: false,
      garmentCategory: garmentCategory || null,
      fitType: fitType || null,
      weightGrams: toFiniteNumber(weightGrams) ?? null,
      variantMode: isMultipleVariantProduct ? "multiple" : "single",
      variantDraft: normalizedVariantDraft,
      variantMeasurements,
      measurements: normalizedMeasurements,
      adminNotes: null,
      createdAt: now,
      updatedAt: now,
    };

    await docRef.set(mirrorDoc);

    return res.status(200).json({
      ok: true,
      firestoreId: docRef.id,
      inReview: true,
    });
  } catch (error: any) {
    try {
      if (claimedSkuRef) await claimedSkuRef.delete();
    } catch {
      // ignore SKU claim rollback failure
    }

    console.error("create product error:", error?.message || error);
    return res.status(500).json({
      ok: false,
      error: error?.message || "Internal error",
    });
  }
}
