// pages/api/admin/products/create.ts
import { getAdmin } from "../../_lib/firebaseAdmin.js";
import { shopifyGraphQL } from "../../_lib/shopify.js";
import type { DocumentReference } from "firebase-admin/firestore";

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
        media(first: 10) {
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
      price: String(variant.price ?? args.basePrice),
      ...((variant.compareAtPrice ?? args.baseCompareAtPrice) != null
        ? { compareAtPrice: String(variant.compareAtPrice ?? args.baseCompareAtPrice) }
        : {}),
      ...(variant.barcode ? { barcode: variant.barcode } : {}),
      ...(variant.mediaUrls?.length ? { mediaSrc: variant.mediaUrls } : {}),
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

/* ---------------- handler ---------------- */

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  let claimedSkuRef: DocumentReference | null = null;

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

    if (
      !title ||
      price == null ||
      !vendor ||
      !rawSku ||
      compareAtPrice == null
    ) {
      return res.status(400).json({
        ok: false,
        error: "title, price, vendor, sku and compareAtPrice are required",
      });
    }

    const sku = normSku(rawSku);
    const normalizedMeasurements = normalizeMeasurements(measurements);
    const normalizedVariantDraft = normalizeVariantDraft(variantDraft);
    const variantMeasurements = buildVariantMeasurements(normalizedVariantDraft);

    // --- Shopify product input ---
    const shopifyTags = [...new Set([`merchant:${merchantId}`, ...tags])];
    const shopifyStatus = "DRAFT";

    const productInput = {
      title,
      descriptionHtml: description || "",
      vendor: vendor || "DRIPPR Marketplace",
      productType: productType || undefined,
      status: shopifyStatus,
      seo: seo || undefined,
      tags: shopifyTags,
      metafields: buildMeasurementMetafields(normalizedMeasurements),
    };

    const mediaInput =
      Array.isArray(resourceUrls) && resourceUrls.length
        ? resourceUrls.slice(0, 10).map((url: string) => ({
            originalSource: url,
            mediaContentType: "IMAGE" as const,
          }))
        : undefined;

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

    // --- 1) Create product on Shopify ---
    const createRes = await shopifyGraphQL(PRODUCT_CREATE, {
      product: productInput,
      media: mediaInput,
    });

    const userErrors = createRes?.data?.productCreate?.userErrors || [];
    if (userErrors.length) {
      return res.status(400).json({
        ok: false,
        error: userErrors.map((error: any) => error.message).join("; "),
      });
    }

    const product = createRes.data.productCreate.product;
    const firstVariant = product?.variants?.nodes?.[0];

    if (!product?.id || !firstVariant?.id) {
      throw new Error("Product created but default variant not returned.");
    }

    const locationId = normalizeLocationId(runtimeEnv("SHOPIFY_LOCATION_ID"));
    let finalVariantNodes: any[] = [firstVariant];

    if (normalizedVariantDraft?.variants?.length) {
      finalVariantNodes =
        (await createShopifyVariants({
          productId: product.id,
          variantDraft: normalizedVariantDraft,
          basePrice: Number(price),
          baseCompareAtPrice:
            compareAtPrice == null ? undefined : Number(compareAtPrice),
          baseSku: sku,
          tracked: Boolean(inventory.tracked),
          cost:
            inventory?.cost == null || inventory.cost === ""
              ? undefined
              : Number(inventory.cost),
          locationId,
        })) || [firstVariant];
    } else {
      const variantsPayload: any[] = [
        {
          id: firstVariant.id,
          price: String(price),
          ...(compareAtPrice != null
            ? { compareAtPrice: String(compareAtPrice) }
            : {}),
          ...(barcode ? { barcode } : {}),
          inventoryItem: {
            sku,
            tracked: Boolean(inventory.tracked),
            ...(inventory?.cost != null && inventory.cost !== ""
              ? { cost: String(inventory.cost) }
              : {}),
          },
        },
      ];
      const updateRes = await shopifyGraphQL(VARIANTS_BULK_UPDATE, {
        productId: product.id,
        variants: variantsPayload,
      });
      const variantErrors =
        updateRes?.data?.productVariantsBulkUpdate?.userErrors || [];
      if (variantErrors.length) {
        console.warn("productVariantsBulkUpdate errors:", variantErrors);
      }

      const inventoryItemId = firstVariant?.inventoryItem?.id;
      const inventoryQuantity = Number(inventory?.quantity);
      if (
        locationId &&
        inventoryItemId &&
        Number.isFinite(inventoryQuantity) &&
        inventoryQuantity >= 0
      ) {
        const inventoryResult = await shopifyGraphQL(INVENTORY_SET_ON_HAND, {
          input: {
            reason: "correction",
            setQuantities: [
              { inventoryItemId, locationId, quantity: inventoryQuantity },
            ],
          },
        });
        const inventoryErrors =
          inventoryResult?.data?.inventorySetOnHandQuantities?.userErrors || [];
        if (inventoryErrors.length) {
          console.warn("inventorySetOnHandQuantities errors:", inventoryErrors);
        }
      }
    }

    // --- 3) Fetch permanent CDN image URLs ---
    const cdnUrls: string[] = await fetchCdnUrlsWithRetry(product.id);

    if (!cdnUrls.length) {
      console.warn("[create] CDN images not ready; saving without image URLs.");
    }

    // --- 4) Mirror to Firestore ---
    const now = Date.now();
    const shopifyVariantIds = finalVariantNodes
      .map((variant: any) => String(variant?.id || ""))
      .filter(Boolean);
    const shopifyVariantNumericIds = shopifyVariantIds.map(
      (variantId: string) => variantId.split("/").pop() || "",
    );
    const hydratedVariantMeasurements = normalizedVariantDraft?.variants?.length
      ? normalizedVariantDraft.variants.map((variant: any, index: number) => ({
          variantId: finalVariantNodes[index]?.id || null,
          title: finalVariantNodes[index]?.title || variant.title,
          optionValues: variant.optionValues,
          measurements: variant.measurements,
        }))
      : variantMeasurements;
    const shopifyProductNumericId = String(product.id).split("/").pop() || "";
    const sellerStatus = "pending";

    const mirrorDoc = {
      id: docRef.id,
      merchantId,
      title,
      description: description || "",
      price: Number(price),
      currency,
      status: sellerStatus,
      published: false,
      sku,
      shopifyProductId: product.id,
      shopifyProductNumericId,
      shopifyVariantIds,
      shopifyVariantNumericIds,
      inventoryItemId: finalVariantNodes[0]?.inventoryItem?.id || null,
      tags: shopifyTags,

      // Permanent CDN URLs only.
      image: cdnUrls[0] || null,
      images: cdnUrls,
      imageUrls: cdnUrls,

      stock: inventory?.quantity ?? null,
      vendor: vendor || "DRIPPR Marketplace",
      productType: productType || null,
      collections: (Array.isArray(collections) ? collections : [])
        .map((collectionName: unknown) => String(collectionName).trim())
        .filter(Boolean),
      collectionsSynced: false,
      garmentCategory: garmentCategory || null,
      fitType: fitType || null,
      variantMode: variantMode === "multiple" ? "multiple" : "single",
      variantDraft: normalizedVariantDraft,
      variantMeasurements: hydratedVariantMeasurements,
      measurements: normalizedMeasurements,
      adminNotes: null,
      createdAt: now,
      updatedAt: now,
    };

    const ownerRef = shopifyProductNumericId
      ? adminDb.collection("shopifyProductOwners").doc(shopifyProductNumericId)
      : null;

    await adminDb.runTransaction(async (tx: any) => {
      tx.set(docRef, mirrorDoc);

      if (ownerRef) {
        tx.set(
          ownerRef,
          {
            shopifyProductNumericId,
            shopifyProductId: product.id,
            merchantId,
            merchantProductDocId: docRef.id,
            createdAt: now,
            updatedAt: now,
          },
          { merge: true },
        );
      }
    });

    return res.status(200).json({
      ok: true,
      productId: product.id,
      variantId: shopifyVariantIds[0] || firstVariant.id,
      firestoreId: docRef.id,
      inReview: Boolean(normalizedVariantDraft),
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
