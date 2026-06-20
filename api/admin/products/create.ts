// pages/api/admin/products/create.ts
import { getAdmin } from "../../_lib/firebaseAdmin.js";
import { shopifyGraphQL } from "../../_lib/shopify.js";

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

function normalizeMeasurements(input: any) {
  if (!input || typeof input !== "object") return null;

  const toNumOrNull = (value: any) => {
    if (value === "" || value == null) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  return {
    bust: toNumOrNull(input.bust),
    waist: toNumOrNull(input.waist),
    hip: toNumOrNull(input.hip),
    length: toNumOrNull(input.length),
    unit: "in",
  };
}

function hasAnyMeasurement(measurements: any) {
  return Boolean(
    measurements &&
      ["bust", "waist", "hip", "length"].some(
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

const MEASUREMENT_METAFIELD_NAMESPACE = "drippr_sizing";

function buildMeasurementMetafields(measurements: any) {
  if (!measurements || typeof measurements !== "object") return undefined;

  const fields = ["bust", "waist", "hip", "length"] as const;
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

/* ---------------- handler ---------------- */

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  let claimedSkuRef: FirebaseFirestore.DocumentReference | null = null;

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
      status,
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
    const shopifyStatus = normalizedVariantDraft
      ? "DRAFT"
      : status
        ? String(status).toUpperCase()
        : undefined;

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

    // --- 2) Update default variant fields ---
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
          ...(typeof inventory.tracked === "boolean"
            ? { tracked: Boolean(inventory.tracked) }
            : {}),
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

    // --- 3) Fetch permanent CDN image URLs ---
    const cdnUrls: string[] = await fetchCdnUrlsWithRetry(product.id);

    if (!cdnUrls.length) {
      console.warn("[create] CDN images not ready; saving without image URLs.");
    }

    // --- 4) Mirror to Firestore ---
    const now = Date.now();
    const numericVariantId = String(firstVariant.id).split("/").pop();
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
      shopifyVariantIds: [firstVariant.id],
      shopifyVariantNumericIds: [numericVariantId],
      tags: shopifyTags,

      // Permanent CDN URLs only.
      image: cdnUrls[0] || null,
      images: cdnUrls,
      imageUrls: cdnUrls,

      stock: inventory?.quantity ?? null,
      vendor: vendor || "DRIPPR Marketplace",
      productType: productType || null,
      variantDraft: normalizedVariantDraft,
      variantMeasurements,
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
      variantId: firstVariant.id,
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
