// api/admin/products/update.ts
import { getAdmin } from "../../_lib/firebaseAdmin.js";
import ImageKit from "imagekit";
import { shopifyGraphQL } from "../../_lib/shopify.js";

const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY || "",
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY || "",
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT || "",
});

/* ---------------- Small helpers ---------------- */
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

const MEASUREMENT_METAFIELD_NAMESPACE = "garment_sizing";

function hasAnyMeasurement(measurements: any) {
  return Boolean(
    measurements &&
      ["chest", "bust", "waist", "hip", "length", "shoulder", "inseam"].some(
        (key) => typeof measurements[key] === "number",
      ),
  );
}

function normalizeVariantMeasurements(input: any) {
  if (!Array.isArray(input)) return [];

  return input
    .map((item: any) => {
      const measurements = normalizeMeasurements(item?.measurements);
      return {
        variantId: String(item?.variantId || item?.id || "").trim() || null,
        title: String(item?.title || "").trim(),
        optionValues: Array.isArray(item?.optionValues)
          ? item.optionValues.map((value: any) => String(value).trim()).filter(Boolean)
          : Array.isArray(item?.options)
            ? item.options.map((value: any) => String(value).trim()).filter(Boolean)
          : [],
        measurements: hasAnyMeasurement(measurements) ? measurements : null,
      };
    })
    .filter((item: any) => item.variantId || item.optionValues.length);
}

function readMeasurementMetafields(nodes: any[]) {
  const measurements: any = { unit: "in" };
  for (const node of nodes || []) {
    if (!["chest", "waist", "hip", "length", "shoulder", "inseam"].includes(node?.key)) continue;
    const value = Number(node.value);
    measurements[node.key] = Number.isFinite(value) ? value : null;
  }
  return hasAnyMeasurement(measurements) ? measurements : null;
}

function textFromHtml(value: unknown) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/(?:&nbsp;|&#160;)/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n$/, "");
}

function firstNonEmptyString(...values: unknown[]) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function valuesEqual(left: any, right: any) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

const SELLER_DELIVERY_PRICE_BUMP = 100;

function finiteMoney(value: unknown) {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function moneyEquals(left: unknown, right: unknown) {
  const leftNumber = finiteMoney(left);
  const rightNumber = finiteMoney(right);
  return (
    leftNumber != null &&
    rightNumber != null &&
    Math.abs(leftNumber - rightNumber) < 0.005
  );
}

function optionValuesKey(values: unknown[]) {
  return values
    .map((value) => String(value || "").trim().toLowerCase())
    .join("|");
}

function storedVariantBasePrice(
  doc: any,
  shopifyVariant: any,
  index: number,
) {
  const draftVariants = Array.isArray(doc.variantDraft?.variants)
    ? doc.variantDraft.variants
    : [];
  const variantId = String(shopifyVariant?.id || "").trim();
  const sku = String(shopifyVariant?.sku || "").trim().toUpperCase();
  const selectedValues = Array.isArray(shopifyVariant?.selectedOptions)
    ? shopifyVariant.selectedOptions.map((option: any) => option?.value)
    : [];
  const selectedKey = optionValuesKey(selectedValues);

  const matchingDraft =
    draftVariants.find((variant: any) => {
      const savedId = String(
        variant?.variantId || variant?.shopifyVariantId || "",
      ).trim();
      return savedId && savedId === variantId;
    }) ||
    draftVariants.find(
      (variant: any) =>
        sku &&
        String(variant?.sku || "").trim().toUpperCase() === sku,
    ) ||
    draftVariants.find((variant: any) => {
      const values = Array.isArray(variant?.optionValues)
        ? variant.optionValues
        : Array.isArray(variant?.options)
          ? variant.options
          : [];
      return selectedKey && optionValuesKey(values) === selectedKey;
    }) ||
    draftVariants[index];

  const variantPrice = finiteMoney(matchingDraft?.price);
  if (variantPrice != null) {
    return { price: variantPrice, includesDelivery: false };
  }

  const productPrice = finiteMoney(doc.price);
  if (productPrice == null) return null;
  const legacySinglePrice =
    doc.priceIncludesDelivery === true ||
    (doc.deliveryChargeAmount == null &&
      String(doc.variantMode || "").trim().toLowerCase() === "single");
  return { price: productPrice, includesDelivery: legacySinglePrice };
}

function reconcileShopifyVariantPrices(doc: any, shopifyVariants: any[]) {
  const updates: Array<{ id: string; price: string }> = [];
  const finalPrices: number[] = [];

  shopifyVariants.forEach((variant: any, index: number) => {
    const livePrice = finiteMoney(variant?.price);
    const stored = storedVariantBasePrice(doc, variant, index);
    if (livePrice == null || !stored) {
      if (livePrice != null) finalPrices[index] = livePrice;
      return;
    }

    const expectedPrice = stored.includesDelivery
      ? stored.price
      : stored.price + SELLER_DELIVERY_PRICE_BUMP;
    if (
      variant?.id &&
      !moneyEquals(livePrice, expectedPrice) &&
      moneyEquals(livePrice, stored.price)
    ) {
      updates.push({ id: String(variant.id), price: String(expectedPrice) });
      finalPrices[index] = expectedPrice;
      return;
    }

    finalPrices[index] = livePrice;
  });

  return { updates, finalPrices };
}

function mergeRemovedRecoveryVariantDraft(args: {
  currentDraft: any;
  requestedDraft: any;
  quickVariants: any[];
  shopifyVariantIds: unknown[];
  mediaUpdates: any[];
  removeVariantIds: unknown[];
}) {
  const currentOptions = Array.isArray(args.currentDraft?.options)
    ? args.currentDraft.options
    : [];
  const requestedOptions = Array.isArray(args.requestedDraft?.options)
    ? args.requestedDraft.options
    : [];
  const options = currentOptions.map((option: any) => ({
    ...option,
    name: String(option?.name || "").trim(),
    values: Array.isArray(option?.values) ? [...option.values] : [],
  }));
  for (const requestedOption of requestedOptions) {
    const name = String(requestedOption?.name || "").trim();
    if (!name) continue;
    const existing = options.find(
      (option: any) => option.name.toLowerCase() === name.toLowerCase(),
    );
    const values = Array.isArray(requestedOption?.values)
      ? requestedOption.values
      : [];
    if (existing) {
      existing.values = [
        ...new Set([
          ...existing.values,
          ...values.map((value: unknown) => String(value).trim()).filter(Boolean),
        ]),
      ];
    } else {
      options.push({
        ...requestedOption,
        name,
        values: values
          .map((value: unknown) => String(value).trim())
          .filter(Boolean),
      });
    }
  }

  const currentVariants = Array.isArray(args.currentDraft?.variants)
    ? args.currentDraft.variants
    : [];
  const requestedVariants = Array.isArray(args.requestedDraft?.variants)
    ? args.requestedDraft.variants
    : [];
  let variants = currentVariants.map((variant: any) => ({
    ...variant,
    optionValues: Array.isArray(variant?.optionValues)
      ? [...variant.optionValues]
      : Array.isArray(variant?.options)
        ? [...variant.options]
        : [],
    mediaUrls: Array.isArray(variant?.mediaUrls)
      ? [...variant.mediaUrls]
      : [],
  }));
  const variantKey = (variant: any) =>
    optionValuesKey(
      Array.isArray(variant?.optionValues)
        ? variant.optionValues
        : Array.isArray(variant?.options)
          ? variant.options
          : [],
    );
  for (const requestedVariant of requestedVariants) {
    const key = variantKey(requestedVariant);
    const index = variants.findIndex((variant: any) => variantKey(variant) === key);
    if (index >= 0) {
      variants[index] = {
        ...variants[index],
        ...requestedVariant,
        mediaUrls: [
          ...new Set([
            ...(variants[index].mediaUrls || []),
            ...(Array.isArray(requestedVariant?.mediaUrls)
              ? requestedVariant.mediaUrls
              : []),
          ]),
        ],
      };
    } else {
      variants.push({
        ...requestedVariant,
        optionValues: Array.isArray(requestedVariant?.optionValues)
          ? [...requestedVariant.optionValues]
          : Array.isArray(requestedVariant?.options)
            ? [...requestedVariant.options]
            : [],
        mediaUrls: Array.isArray(requestedVariant?.mediaUrls)
          ? [...requestedVariant.mediaUrls]
          : [],
      });
    }
  }

  const savedVariantIds = Array.isArray(args.shopifyVariantIds)
    ? args.shopifyVariantIds.map((id) => String(id || ""))
    : [];
  const removeVariantIds = new Set(
    (args.removeVariantIds || []).map((id) => String(id || "")),
  );
  for (const quickVariant of args.quickVariants || []) {
    const index = savedVariantIds.indexOf(String(quickVariant?.id || ""));
    if (index < 0 || !variants[index]) continue;
    if (quickVariant.price != null && quickVariant.price !== "") {
      variants[index].price = Number(quickVariant.price);
    }
    if (quickVariant.quantity != null && quickVariant.quantity !== "") {
      variants[index].quantity = Number(quickVariant.quantity);
    }
  }
  if (removeVariantIds.size) {
    variants = variants.filter(
      (_variant: any, index: number) =>
        !removeVariantIds.has(savedVariantIds[index] || ""),
    );
  }

  const colorOptionIndex = options.findIndex(
    (option: any) => option.name.toLowerCase() === "color",
  );
  const mediaGroups = Array.isArray(args.mediaUpdates)
    ? args.mediaUpdates
    : [];
  for (const group of mediaGroups) {
    const groupLabel = String(group?.color || "").trim().toLowerCase();
    const additions = Array.isArray(group?.resourceUrls)
      ? group.resourceUrls.map((url: unknown) => String(url).trim()).filter(Boolean)
      : [];
    const removals = new Set(
      Array.isArray(group?.removeResourceUrls)
        ? group.removeResourceUrls
            .map((url: unknown) => String(url).trim())
            .filter(Boolean)
        : [],
    );
    variants.forEach((variant: any) => {
      const values = variant.optionValues || variant.options || [];
      const variantLabel =
        colorOptionIndex >= 0
          ? String(values[colorOptionIndex] || "").trim().toLowerCase()
          : variants.length === 1
            ? groupLabel
            : "";
      if (!groupLabel || variantLabel !== groupLabel) return;
      variant.mediaUrls = [
        ...new Set([
          ...(Array.isArray(variant.mediaUrls)
            ? variant.mediaUrls.filter((url: string) => !removals.has(url))
            : []),
          ...additions,
        ]),
      ];
    });
  }

  return variants.length ? { options, variants } : null;
}

function mergeRemovedRecoveryProductImages(doc: any, mediaUpdates: any[]) {
  const sellerUploads = Array.isArray(doc.resourceUrls)
    ? doc.resourceUrls
    : [];
  const currentShopifyImages = [
    ...(Array.isArray(doc.images) ? doc.images : []),
    ...(Array.isArray(doc.imageUrls) ? doc.imageUrls : []),
    doc.image,
  ];
  const current = (sellerUploads.length ? sellerUploads : currentShopifyImages)
    .map((url: unknown) => String(url || "").trim())
    .filter(Boolean);
  const additions = (mediaUpdates || []).flatMap((group: any) =>
    Array.isArray(group?.resourceUrls) ? group.resourceUrls : [],
  );
  const removals = new Set(
    (mediaUpdates || []).flatMap((group: any) =>
      Array.isArray(group?.removeResourceUrls)
        ? group.removeResourceUrls.map((url: unknown) => String(url).trim())
        : [],
    ),
  );
  return [
    ...new Set([
      ...current.filter((url: string) => !removals.has(url)),
      ...additions.map((url: unknown) => String(url).trim()).filter(Boolean),
    ]),
  ];
}

function buildChangeSummary(
  current: Record<string, any>,
  requested: Record<string, any>,
  instantApplied: string[],
) {
  const base: Record<string, { old: any; new: any }> = {};

  for (const [field, nextValue] of Object.entries(requested)) {
    const currentValue = current[field];
    if (!valuesEqual(currentValue, nextValue)) {
      base[field] = { old: currentValue ?? null, new: nextValue ?? null };
    }
  }

  return {
    instantApplied,
    base,
    note: "Highlighted values are pending admin approval before Shopify is updated.",
  };
}

function sanitizeAddDraft(input: any) {
  const draft = input && typeof input === "object" ? input : {};
  const id = String(draft.id || "").trim();
  if (!id) return null;
  const keepRemotePreview = (url: unknown) =>
    /^https?:\/\//i.test(String(url || ""));
  const variantColorImagePreviews = Object.fromEntries(
    Object.entries(draft.variantColorImagePreviews || {})
      .map(([color, previews]: [string, any]) => [
        String(color).trim(),
        Array.isArray(previews)
          ? previews.map((url) => String(url || "")).filter(keepRemotePreview)
          : [],
      ])
      .filter(([color, previews]) => color && (previews as string[]).length),
  );
  return {
    ...draft,
    id,
    title: String(draft.title || "").trim() || undefined,
    description: String(draft.description || "").trim() || undefined,
    sku: String(draft.sku || "").trim() || undefined,
    vendor: String(draft.vendor || "").trim() || undefined,
    productType: String(draft.productType || "").trim() || undefined,
    imagePreviews: Array.isArray(draft.imagePreviews)
      ? draft.imagePreviews
          .map((url: unknown) => String(url || ""))
          .filter(keepRemotePreview)
      : [],
    variantColorImagePreviews,
    createdAt: Number(draft.createdAt || Date.now()),
    updatedAt: Date.now(),
  };
}

/* ---------------- Shopify GQL ---------------- */

// NOTE: removed variant.weight & variant.weightUnit (they caused 500)
const PRODUCT_DETAILS_QUERY = /* GraphQL */ `
  query product($id: ID!) {
    product(id: $id) {
      id
      status
      title
      descriptionHtml
      vendor
      productType
      tags
      seo {
        title
        description
      }
      options {
        name
        values
      }
      variants(first: 100) {
        nodes {
          id
          title
          sku
          price
          compareAtPrice
          barcode
          inventoryQuantity
          selectedOptions {
            name
            value
          }
          metafields(namespace: "garment_sizing", first: 10) {
            nodes {
              key
              value
            }
          }
        }
      }
      images(first: 100) {
        nodes {
          id
          url
          altText
          variants(first: 20) {
            nodes {
              id
            }
          }
        }
      }
    }
  }
`;

const PRODUCT_STATUS_QUERY = /* GraphQL */ `
  query productStatus($id: ID!) {
    product(id: $id) {
      id
      status
      variants(first: 100) {
        nodes {
          id
          sku
          price
          selectedOptions {
            name
            value
          }
        }
      }
      images(first: 1) {
        nodes {
          url
        }
      }
    }
  }
`;

const PRODUCT_BY_SKU_QUERY = /* GraphQL */ `
  query productBySku($query: String!) {
    productVariants(first: 10, query: $query) {
      nodes {
        sku
        product {
          id
          status
        }
      }
    }
  }
`;

// live edits (price only here)
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

// absolute stock (optional: needs SHOPIFY_LOCATION_ID + inventoryItemId on doc)
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

// stage uploads (same as /uploads/start)
const STAGED_UPLOADS_CREATE = /* GraphQL */ `
  mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters {
          name
          value
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// attach staged images to an existing product
const PRODUCT_CREATE_MEDIA = /* GraphQL */ `
  mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media {
        id
        status
      }
      mediaUserErrors {
        field
        message
      }
    }
  }
`;

// list product images (CDN urls)
const PRODUCT_IMAGES_QUERY = /* GraphQL */ `
  query productImages($id: ID!) {
    product(id: $id) {
      id
      images(first: 100) {
        nodes {
          id
          url
        }
      }
      media(first: 100) {
        nodes {
          id
          mediaContentType
          ... on MediaImage {
            image {
              url
            }
          }
        }
      }
    }
  }
`;

const PRODUCT_DELETE_MEDIA = /* GraphQL */ `
  mutation productDeleteMedia($productId: ID!, $mediaIds: [ID!]!) {
    productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
      deletedMediaIds
      deletedProductImageIds
      mediaUserErrors {
        field
        message
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// delete a single image by id
const PRODUCT_IMAGE_DELETE = /* GraphQL */ `
  mutation productImageDelete($id: ID!) {
    productImageDelete(id: $id) {
      deletedImageId
      userErrors {
        field
        message
      }
    }
  }
`;

// hard-delete product in Shopify (we'll use this in the safe deletion flow)
const PRODUCT_DELETE = /* GraphQL */ `
  mutation productDelete($input: ProductDeleteInput!) {
    productDelete(input: $input) {
      deletedProductId
      userErrors {
        field
        message
      }
    }
  }
`;

/* ---------------- Helpers ---------------- */

async function listImageUrls(
  productId: string,
): Promise<{
  idsByUrl: Record<string, string>;
  mediaIdsByUrl: Record<string, string>;
  urls: string[];
}> {
  const r = await shopifyGraphQL(PRODUCT_IMAGES_QUERY, { id: productId });
  const nodes = r?.data?.product?.images?.nodes || [];
  const mediaNodes = r?.data?.product?.media?.nodes || [];
  const urls: string[] = [];
  const idsByUrl: Record<string, string> = {};
  const mediaIdsByUrl: Record<string, string> = {};
  for (const n of nodes) {
    if (n?.url && n?.id) {
      urls.push(String(n.url));
      for (const key of imageUrlLookupKeys(String(n.url))) {
        idsByUrl[key] = String(n.id);
      }
    }
  }
  for (const n of mediaNodes) {
    if (n?.image?.url && n?.id) {
      for (const key of imageUrlLookupKeys(String(n.image.url))) {
        mediaIdsByUrl[key] = String(n.id);
      }
    }
  }
  return { idsByUrl, mediaIdsByUrl, urls };
}

function imageUrlLookupKeys(url: string) {
  const raw = String(url || "").trim();
  if (!raw) return [];
  const withoutQuery = raw.split("?")[0];
  const keys = new Set([raw, withoutQuery]);
  try {
    const parsed = new URL(raw);
    const pathname = decodeURIComponent(parsed.pathname || "");
    const normalizedPath = pathname.replace(/(_\d+x\d+|_pico|_icon|_thumb|_small|_compact|_medium|_large|_grande|_master)(?=\.[a-z0-9]+$)/i, "");
    keys.add(`${parsed.hostname}${pathname}`.toLowerCase());
    keys.add(`${parsed.hostname}${normalizedPath}`.toLowerCase());
    keys.add(pathname.toLowerCase());
    keys.add(normalizedPath.toLowerCase());
    const filename = normalizedPath.split("/").filter(Boolean).pop();
    if (filename) keys.add(filename.toLowerCase());
  } catch {
    const filename = withoutQuery.split("/").filter(Boolean).pop();
    if (filename) keys.add(filename.toLowerCase());
  }
  return [...keys].filter(Boolean);
}

function normalizeShopifyProductId(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (raw.startsWith("gid://shopify/Product/")) return raw;
  const numericId = raw.split("/").pop() || "";
  return /^\d+$/.test(numericId)
    ? `gid://shopify/Product/${numericId}`
    : null;
}

function resolveShopifyProductId(doc: any) {
  return (
    normalizeShopifyProductId(doc.shopifyProductId) ||
    normalizeShopifyProductId(doc.shopifyProductNumericId) ||
    normalizeShopifyProductId(doc.productId) ||
    normalizeShopifyProductId(doc.shopifyId)
  );
}

async function recoverShopifyProductBySku(doc: any) {
  const workflowStatus = String(doc.status || "").trim().toLowerCase();
  if (
    [
      "pending",
      "update_in_review",
      "rejected",
      "local_draft",
      "deleted",
    ].includes(workflowStatus)
  ) {
    return null;
  }

  const sku = String(doc.sku || "").trim();
  if (!sku) return null;
  const escapedSku = sku.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const result = await shopifyGraphQL(PRODUCT_BY_SKU_QUERY, {
    query: `sku:"${escapedSku}"`,
  });
  const expectedSku = sku.toUpperCase();
  const match = (result?.data?.productVariants?.nodes || []).find(
    (node: any) =>
      String(node?.sku || "").trim().toUpperCase() === expectedSku &&
      normalizeShopifyProductId(node?.product?.id),
  );
  if (!match?.product) return null;

  return {
    id: normalizeShopifyProductId(match.product.id),
    status: String(match.product.status || "").trim().toUpperCase(),
  };
}

/* ---------------- Handler ---------------- */

export default async function handler(req: any, res: any) {
  try {
    const { adminAuth, adminDb } = getAdmin();

    // --- auth ---
    const authHeader = String(req.headers.authorization || "");
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token)
      return res
        .status(401)
        .json({ ok: false, error: "Missing Authorization" });

    const decoded = await adminAuth.verifyIdToken(token);
    const uid = decoded.uid as string;

    /* ============= GET (back-compat simple fetch) ============= */
    if (req.method === "GET") {
      const id = String(req.query.id || "");
      if (!id) return res.status(400).json({ ok: false, error: "Missing id" });

      const snap = await adminDb.collection("merchantProducts").doc(id).get();
      if (!snap.exists)
        return res.status(404).json({ ok: false, error: "Not found" });

      const doc = snap.data() || {};
      if (doc.merchantId && doc.merchantId !== uid) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }

      return res
        .status(200)
        .json({ ok: true, product: { id: snap.id, ...doc } });
    }

    /* ============= POST ============= */
    if (req.method === "POST") {
      const body = req.body || {};
      const op = typeof body.op === "string" ? body.op : "";

      /* ---------- ImageKit signing / save media (unchanged) ---------- */
      if (op === "mediaSign") {
        if (
          !process.env.IMAGEKIT_PUBLIC_KEY ||
          !process.env.IMAGEKIT_URL_ENDPOINT ||
          !process.env.IMAGEKIT_PRIVATE_KEY
        ) {
          return res
            .status(500)
            .json({ ok: false, error: "ImageKit not configured on server" });
        }
        const authParams = imagekit.getAuthenticationParameters();
        return res.status(200).json({
          ok: true,
          auth: authParams,
          publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
          urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
        });
      }

      if (op === "mediaSave") {
        const records = Array.isArray(body.records) ? body.records : [];
        if (!records.length)
          return res
            .status(400)
            .json({ ok: false, error: "No records to save" });

        const batch = adminDb.batch();
        const now = Date.now();

        for (const rec of records) {
          const ref = adminDb.collection("merchantMedia").doc();
          batch.set(ref, {
            id: ref.id,
            merchantId: uid,
            fileId: rec.fileId || rec.file_id || null,
            name: rec.name || null,
            url: rec.url,
            thumbnailUrl: rec.thumbnailUrl || rec.thumbnail_url || rec.url,
            width: rec.width ?? null,
            height: rec.height ?? null,
            size: rec.size ?? null,
            format: rec.format ?? null,
            createdAt: now,
          });
        }

        await batch.commit();
        return res.status(200).json({ ok: true, saved: records.length });
      }

      if (op === "draftSave") {
        const draft = sanitizeAddDraft(body.draft);
        if (!draft) {
          return res
            .status(400)
            .json({ ok: false, error: "Missing draft id" });
        }
        const ref = adminDb.collection("merchantProducts").doc(draft.id);
        const now = Date.now();
        await ref.set(
          {
            id: draft.id,
            merchantId: uid,
            status: "local_draft",
            published: false,
            title: draft.title || "Untitled draft",
            description: draft.description || "",
            price:
              draft.basePriceInput && Number.isFinite(Number(draft.basePriceInput))
                ? Number(draft.basePriceInput)
                : null,
            sellerDisplayPrice:
              draft.basePriceInput && Number.isFinite(Number(draft.basePriceInput))
                ? Number(draft.basePriceInput) + SELLER_DELIVERY_PRICE_BUMP
                : null,
            deliveryChargeAmount: SELLER_DELIVERY_PRICE_BUMP,
            priceIncludesDelivery: false,
            compareAtPrice:
              draft.compareAtPrice == null ? null : Number(draft.compareAtPrice),
            productType: draft.productType || null,
            variantMode: draft.variantMode || "single",
            collections: Array.isArray(draft.collections) ? draft.collections : [],
            sku: draft.sku || null,
            vendor: draft.vendor || null,
            tags: Array.isArray(draft.tags) ? draft.tags : [],
            image: draft.imagePreviews?.[0] || null,
            images: draft.imagePreviews || [],
            imageUrls: draft.imagePreviews || [],
            draft,
            createdAt: Number(draft.createdAt || now),
            updatedAt: now,
          },
          { merge: true },
        );
        return res.status(200).json({ ok: true, id: draft.id });
      }

      if (op === "draftDelete") {
        const draftId = String(body.draftId || "").trim();
        if (!draftId) {
          return res
            .status(400)
            .json({ ok: false, error: "Missing draft id" });
        }
        const ref = adminDb.collection("merchantProducts").doc(draftId);
        const snap = await ref.get();
        if (!snap.exists) return res.status(200).json({ ok: true });
        const doc = snap.data() || {};
        if (doc.merchantId && doc.merchantId !== uid) {
          return res.status(403).json({ ok: false, error: "Forbidden" });
        }
        if (doc.status === "local_draft") {
          await ref.delete();
        }
        return res.status(200).json({ ok: true });
      }

      if (op === "syncShopifyProducts") {
        const rawIds: unknown[] = Array.isArray(body.ids) ? body.ids : [];
        const ids = [
          ...new Set(
            rawIds
              .map((id) => String(id || "").trim())
              .filter(Boolean),
          ),
        ];
        if (!ids.length) {
          return res.status(200).json({ ok: true, synced: 0, deleted: 0 });
        }

        const now = Date.now();
        let synced = 0;
        let deleted = 0;
        let linked = 0;
        let unresolved = 0;
        for (const id of ids.slice(0, 25)) {
          const ref = adminDb.collection("merchantProducts").doc(id);
          const snap = await ref.get();
          if (!snap.exists) continue;
          const doc = snap.data() || {};
          if (doc.merchantId && doc.merchantId !== uid) continue;
          if (doc.status === "deleted") continue;

          try {
            let shopifyProductId = resolveShopifyProductId(doc);
            let product: any = null;

            if (!shopifyProductId) {
              product = await recoverShopifyProductBySku(doc);
              shopifyProductId = product?.id || null;
              if (shopifyProductId) linked += 1;
            }
            if (!shopifyProductId) {
              unresolved += 1;
              continue;
            }
            if (
              !product ||
              !Array.isArray(product?.variants?.nodes) ||
              !Array.isArray(product?.images?.nodes)
            ) {
              const result = await shopifyGraphQL(PRODUCT_STATUS_QUERY, {
                id: shopifyProductId,
              });
              product = result?.data?.product || null;
            }
            if (!product) {
              await ref.set(
                {
                  ...(doc.status === "update_in_review"
                    ? {}
                    : { status: "deleted" }),
                  published: false,
                  shopifyStatus: "DELETED",
                  shopifyDeletedAt: now,
                  updatedAt: now,
                },
                { merge: true },
              );
              deleted += 1;
              synced += 1;
              continue;
            }

            const shopifyStatus = String(product.status || "")
              .trim()
              .toUpperCase();
            if (["ACTIVE", "DRAFT", "ARCHIVED"].includes(shopifyStatus)) {
              const canonicalProductId =
                normalizeShopifyProductId(product.id) || shopifyProductId;
              const shopifyVariants = Array.isArray(product?.variants?.nodes)
                ? product.variants.nodes
                : [];
              const priceReconciliation = reconcileShopifyVariantPrices(
                doc,
                shopifyVariants,
              );
              if (priceReconciliation.updates.length) {
                const updateResult = await shopifyGraphQL(
                  VARIANTS_BULK_UPDATE,
                  {
                    productId: canonicalProductId,
                    variants: priceReconciliation.updates,
                  },
                );
                const priceErrors =
                  updateResult?.data?.productVariantsBulkUpdate?.userErrors ||
                  [];
                if (priceErrors.length) {
                  console.warn(
                    "Shopify delivery-price reconciliation failed:",
                    priceErrors,
                  );
                  priceReconciliation.updates.forEach((update) => {
                    const variantIndex = shopifyVariants.findIndex(
                      (variant: any) => String(variant?.id) === update.id,
                    );
                    if (variantIndex >= 0) {
                      priceReconciliation.finalPrices[variantIndex] =
                        finiteMoney(shopifyVariants[variantIndex]?.price) ?? 0;
                    }
                  });
                }
              }
              const firstShopifyPrice =
                priceReconciliation.finalPrices.find(
                  (price) => finiteMoney(price) != null,
                ) ?? null;
              const firstShopifyImage = String(
                product?.images?.nodes?.[0]?.url || "",
              ).trim();
              await ref.set(
                {
                  shopifyProductId: canonicalProductId,
                  shopifyProductNumericId:
                    canonicalProductId.split("/").pop() || null,
                  shopifyStatus,
                  published: shopifyStatus === "ACTIVE",
                  ...(firstShopifyPrice != null
                    ? {
                        shopifyPrice: firstShopifyPrice,
                        sellerDisplayPrice: firstShopifyPrice,
                      }
                    : {}),
                  ...(firstShopifyImage ? { image: firstShopifyImage } : {}),
                  shopifyDeletedAt: null,
                  updatedAt: now,
                },
                { merge: true },
              );
              synced += 1;
            }
          } catch (error) {
            console.warn("syncShopifyProducts failed for", id, error);
          }
        }

        return res
          .status(200)
          .json({ ok: true, synced, deleted, linked, unresolved });
      }

      /* ---------- New: image edit pipeline ---------- */

      // 1) return staged targets for files
      if (op === "imagesStage") {
        const files = Array.isArray(body.files) ? body.files : [];
        if (!files.length)
          return res
            .status(400)
            .json({ ok: false, error: "No files provided" });

        const input = files.map((f: any) => ({
          resource: "IMAGE",
          filename: String(f.filename || "image.jpg"),
          mimeType: String(f.mimeType || "image/jpeg"),
          fileSize: String(f.fileSize),
          httpMethod: "POST",
        }));

        const r = await shopifyGraphQL(STAGED_UPLOADS_CREATE, { input });
        const userErrors = r?.data?.stagedUploadsCreate?.userErrors || [];
        if (userErrors.length) {
          return res
            .status(400)
            .json({
              ok: false,
              error: userErrors.map((e: any) => e.message).join("; "),
            });
        }
        const targets = r?.data?.stagedUploadsCreate?.stagedTargets || [];
        return res.status(200).json({ ok: true, targets });
      }

      // 2) attach staged images and mirror urls
      if (op === "imagesAttach") {
        const mpDocId = String(body.id || "");
        const resourceUrls: string[] = Array.isArray(body.resourceUrls)
          ? body.resourceUrls
          : [];
        if (!mpDocId)
          return res.status(400).json({ ok: false, error: "Missing id" });
        if (!resourceUrls.length)
          return res.status(400).json({ ok: false, error: "No resourceUrls" });

        const ref = adminDb.collection("merchantProducts").doc(mpDocId);
        const snap = await ref.get();
        if (!snap.exists)
          return res.status(404).json({ ok: false, error: "Not found" });

        const doc = snap.data() || {};
        if (doc.merchantId && doc.merchantId !== uid)
          return res.status(403).json({ ok: false, error: "Forbidden" });

        const shopifyProductId: string | undefined = doc.shopifyProductId;
        if (!shopifyProductId)
          return res
            .status(400)
            .json({ ok: false, error: "No Shopify product id" });

        const media = resourceUrls.map((u) => ({
          originalSource: u,
          mediaContentType: "IMAGE" as const,
        }));
        const attachRes = await shopifyGraphQL(PRODUCT_CREATE_MEDIA, {
          productId: shopifyProductId,
          media,
        });
        const mErrors =
          attachRes?.data?.productCreateMedia?.mediaUserErrors || [];
        if (mErrors.length) {
          return res
            .status(400)
            .json({
              ok: false,
              error: mErrors.map((e: any) => e.message).join("; "),
            });
        }

        const { urls } = await listImageUrls(shopifyProductId);
        const now = Date.now();
        await ref.set(
          { images: urls, image: urls[0] || null, updatedAt: now },
          { merge: true },
        );

        return res.status(200).json({ ok: true, images: urls });
      }

      // 3) delete selected images by URL
      if (op === "imagesDelete") {
        const mpDocId = String(body.id || "");
        const urlsToDelete: string[] = Array.isArray(body.urls)
          ? body.urls
          : [];
        if (!mpDocId)
          return res.status(400).json({ ok: false, error: "Missing id" });
        if (!urlsToDelete.length)
          return res.status(400).json({ ok: false, error: "No urls" });

        const ref = adminDb.collection("merchantProducts").doc(mpDocId);
        const snap = await ref.get();
        if (!snap.exists)
          return res.status(404).json({ ok: false, error: "Not found" });

        const doc = snap.data() || {};
        if (doc.merchantId && doc.merchantId !== uid)
          return res.status(403).json({ ok: false, error: "Forbidden" });

        const shopifyProductId: string | undefined = doc.shopifyProductId;
        if (!shopifyProductId)
          return res
            .status(400)
            .json({ ok: false, error: "No Shopify product id" });

        const { idsByUrl, mediaIdsByUrl } = await listImageUrls(shopifyProductId);

        const mediaIds = new Set<string>();
        const legacyImageIds = new Set<string>();
        for (const u of urlsToDelete) {
          for (const key of imageUrlLookupKeys(u)) {
            const mediaId = mediaIdsByUrl[key];
            if (mediaId) mediaIds.add(mediaId);
            const imgId = idsByUrl[key];
            if (imgId) legacyImageIds.add(imgId);
          }
        }

        if (mediaIds.size) {
          try {
            const del = await shopifyGraphQL(PRODUCT_DELETE_MEDIA, {
              productId: shopifyProductId,
              mediaIds: [...mediaIds],
            });
            const errs = [
              ...(del?.data?.productDeleteMedia?.mediaUserErrors || []),
              ...(del?.data?.productDeleteMedia?.userErrors || []),
            ];
            if (errs.length) console.warn("productDeleteMedia errors:", errs);
          } catch (e) {
            console.warn("productDeleteMedia failed:", e);
          }
        }

        for (const imgId of legacyImageIds) {
          try {
            const del = await shopifyGraphQL(PRODUCT_IMAGE_DELETE, {
              id: imgId,
            });
            const errs = del?.data?.productImageDelete?.userErrors || [];
            if (errs.length) console.warn("productImageDelete fallback errors:", errs);
          } catch (e) {
            console.warn("productImageDelete fallback failed:", e);
          }
        }

        const refreshed = await listImageUrls(shopifyProductId);
        const now = Date.now();
        await ref.set(
          {
            images: refreshed.urls,
            image: refreshed.urls[0] || null,
            updatedAt: now,
          },
          { merge: true },
        );

        return res.status(200).json({ ok: true, images: refreshed.urls });
      }

      /* ---------- Details for edit drawer ---------- */
      if (op === "details") {
        const id = String(body.id || "");
        if (!id)
          return res.status(400).json({ ok: false, error: "Missing id" });

        const ref = adminDb.collection("merchantProducts").doc(id);
        const snap = await ref.get();
        if (!snap.exists)
          return res.status(404).json({ ok: false, error: "Not found" });

        const doc = snap.data() || {};
        if (doc.merchantId && doc.merchantId !== uid) {
          return res.status(403).json({ ok: false, error: "Forbidden" });
        }

        let productOptions: any[] = [];
        let variants: any[] = [];
        let imagesLive: string[] = [];
        let liveProduct: any = null;

        let shopifyProductId = resolveShopifyProductId(doc);
        if (!shopifyProductId) {
          const recoveredProduct = await recoverShopifyProductBySku(doc);
          shopifyProductId = recoveredProduct?.id || null;
        }

        if (shopifyProductId) {
          try {
            const r = await shopifyGraphQL(PRODUCT_DETAILS_QUERY, {
              id: shopifyProductId,
            });
            const p = r?.data?.product;

            if (!p) {
              const removedRecoveryAvailable =
                doc.removedEditUsed !== true &&
                (String(doc.shopifyStatus || "").trim().toUpperCase() ===
                  "DELETED" ||
                  doc.shopifyDeletedAt != null ||
                  doc.status === "deleted");
              await ref.set(
                {
                  ...(doc.status === "update_in_review"
                    ? {}
                    : { status: "deleted" }),
                  published: false,
                  shopifyStatus: "DELETED",
                  shopifyDeletedAt: Date.now(),
                  updatedAt: Date.now(),
                },
                { merge: true },
              );
              if (!removedRecoveryAvailable) {
                return res.status(404).json({
                  ok: false,
                  error:
                    "This product no longer exists in Shopify and its one-time edit chance is unavailable.",
                });
              }
              shopifyProductId = null;
            }

            if (p) {
              liveProduct = p;
              const mediaUrlsByVariant = new Map<string, string[]>();
              const mediaUrlsByColor = new Map<string, string[]>();
              for (const image of p.images?.nodes || []) {
                const imageUrl = String(image?.url || "").trim();
                if (!imageUrl) continue;
                const altText = String(image?.altText || "").toLowerCase();
                if (
                  altText.includes("drippr_color:") ||
                  altText.includes("drippr-color:")
                ) {
                  const color = altText
                    .replace("drippr-color:", "drippr_color:")
                    .split("drippr_color:")
                    .pop()
                    ?.split("|")?.[0]
                    ?.trim();
                  if (color) {
                    mediaUrlsByColor.set(color, [
                      ...(mediaUrlsByColor.get(color) || []),
                      imageUrl,
                    ]);
                  }
                }
                for (const variant of image?.variants?.nodes || []) {
                  const variantId = String(variant?.id || "").trim();
                  if (!variantId) continue;
                  mediaUrlsByVariant.set(variantId, [
                    ...(mediaUrlsByVariant.get(variantId) || []),
                    imageUrl,
                  ]);
                }
              }

              productOptions = (p.options || []).map((o: any) => ({
                name: o.name || "",
                values: Array.isArray(o.values)
                  ? o.values.filter((v: any) => typeof v === "string")
                  : [],
              }));

              variants = (p.variants?.nodes || []).map((v: any) => {
                const opts = Array.isArray(v.selectedOptions)
                  ? v.selectedOptions.map((so: any) => String(so.value))
                  : [];
                return {
                  id: v.id,
                  title: v.title,
                  optionValues: opts,
                  price: v.price != null ? Number(v.price) : undefined,
                  compareAtPrice:
                    v.compareAtPrice != null ? Number(v.compareAtPrice) : undefined,
                  quantity:
                    typeof v.inventoryQuantity === "number"
                      ? v.inventoryQuantity
                      : undefined,
                  sku: v.sku || undefined,
                  barcode: v.barcode || undefined,
                  measurements: readMeasurementMetafields(
                    v.metafields?.nodes || [],
                  ),
                  mediaUrls: mediaUrlsByVariant.get(String(v.id)) || [],
                };
              });
              if (mediaUrlsByColor.size) {
                const colorOptionIndex = productOptions.findIndex(
                  (option: any) =>
                    String(option?.name || "").trim().toLowerCase() === "color",
                );
                if (colorOptionIndex >= 0) {
                  variants = variants.map((variant: any) => {
                    if (variant.mediaUrls?.length) return variant;
                    const color = String(
                      variant.optionValues?.[colorOptionIndex] || "",
                    )
                      .trim()
                      .toLowerCase();
                    const mediaUrls = mediaUrlsByColor.get(color) || [];
                    return mediaUrls.length
                      ? { ...variant, mediaUrls: [...new Set(mediaUrls)] }
                      : variant;
                  });
                }
              }

              imagesLive = (p.images?.nodes || [])
                .map((n: any) => String(n.url))
                .filter(Boolean);
            }
          } catch (err: any) {
            console.error(
              "[details:product]",
              err?.response?.errors || err?.message || err,
            );
          }
        }

        const savedSellerUploadImages = [
          ...(Array.isArray(doc.resourceUrls) ? doc.resourceUrls : []),
          ...(Array.isArray(doc.variantDraft?.variants)
            ? doc.variantDraft.variants.flatMap((variant: any) =>
                Array.isArray(variant?.mediaUrls) ? variant.mediaUrls : [],
              )
            : []),
          ...(Array.isArray(doc.pendingUpdates?.variantDraft?.variants)
            ? doc.pendingUpdates.variantDraft.variants.flatMap((variant: any) =>
                Array.isArray(variant?.mediaUrls) ? variant.mediaUrls : [],
              )
            : []),
        ]
          .map((url: unknown) => String(url || "").trim())
          .filter(Boolean);
        const savedCurrentImages = [
          ...(Array.isArray(doc.images) ? doc.images : []),
          ...(Array.isArray(doc.imageUrls) ? doc.imageUrls : []),
          doc.image,
        ]
          .map((url: unknown) => String(url || "").trim())
          .filter(Boolean);
        const isRemovedShopifyProduct =
          String(doc.shopifyStatus || "").trim().toUpperCase() === "DELETED" ||
          doc.shopifyDeletedAt != null ||
          doc.status === "deleted";
        const savedProductImages = isRemovedShopifyProduct
          ? [...savedSellerUploadImages, ...savedCurrentImages]
          : [...savedCurrentImages, ...savedSellerUploadImages];
        imagesLive = imagesLive.length
          ? [...new Set(imagesLive)]
          : [...new Set(savedProductImages)];

        const savedVariantMedia = [
          ...(Array.isArray(doc.variantDraft?.variants)
            ? doc.variantDraft.variants
            : []),
          ...(Array.isArray(doc.pendingUpdates?.variantDraft?.variants)
            ? doc.pendingUpdates.variantDraft.variants
            : []),
        ];
        if (savedVariantMedia.length && variants.length) {
          const savedVariantSourceUrls = [
            ...new Set(
              savedVariantMedia.flatMap((item: any) =>
                Array.isArray(item?.mediaUrls)
                  ? item.mediaUrls
                      .map((url: unknown) => String(url || "").trim())
                      .filter(Boolean)
                  : [],
              ),
            ),
          ];
          const liveUrlByLookupKey = new Map<string, string>();
          imagesLive.forEach((url) => {
            imageUrlLookupKeys(url).forEach((key) =>
              liveUrlByLookupKey.set(key, url),
            );
          });
          const liveUrlBySavedSource = new Map<string, string>();
          savedVariantSourceUrls.forEach((savedUrl, index) => {
            const exactLiveUrl = imageUrlLookupKeys(savedUrl)
              .map((key) => liveUrlByLookupKey.get(key))
              .find(Boolean);
            const positionalLiveUrl = imagesLive[index];
            const liveUrl = exactLiveUrl || positionalLiveUrl;
            if (liveUrl) liveUrlBySavedSource.set(savedUrl, liveUrl);
          });

          variants = variants.map((variant: any) => {
            const optionKey = (variant.optionValues || [])
              .map((value: unknown) => String(value).trim())
              .join("|");
            const saved = savedVariantMedia.find(
              (item: any) =>
                (item.optionValues || item.options || [])
                  .map((value: unknown) => String(value).trim())
                  .join("|") === optionKey,
            );
            const savedMediaUrls = Array.isArray(saved?.mediaUrls)
              ? saved.mediaUrls
                  .map((url: unknown) => String(url || "").trim())
                  .filter(Boolean)
              : [];
            const hydratedSavedUrls = savedMediaUrls
              .map((url: string) =>
                imagesLive.length ? liveUrlBySavedSource.get(url) : url,
              )
              .filter(Boolean);
            const mediaUrls = [
              ...new Set([
                ...(Array.isArray(variant.mediaUrls)
                  ? variant.mediaUrls
                  : []),
                ...hydratedSavedUrls,
              ]),
            ];
            return mediaUrls.length ? { ...variant, mediaUrls } : variant;
          });
        }
        if (!productOptions.length && Array.isArray(doc.variantDraft?.options)) {
          productOptions = doc.variantDraft.options
            .map((option: any) => ({
              name: String(option?.name || "").trim(),
              values: Array.isArray(option?.values)
                ? option.values
                    .map((value: unknown) => String(value).trim())
                    .filter(Boolean)
                : [],
            }))
            .filter((option: any) => option.name && option.values.length);
        }
        if (!variants.length && Array.isArray(doc.variantDraft?.variants)) {
          const measurementsByOptionKey = new Map<string, any>();
          for (const item of normalizeVariantMeasurements(
            doc.variantMeasurements || [],
          )) {
            const key = (item.optionValues || [])
              .map((value: unknown) => String(value).trim())
              .join("|");
            if (key) measurementsByOptionKey.set(key, item);
          }
          const savedShopifyVariantIds = Array.isArray(doc.shopifyVariantIds)
            ? doc.shopifyVariantIds
            : [];
          variants = doc.variantDraft.variants.map((variant: any, index: number) => {
            const optionValues = Array.isArray(variant?.optionValues)
              ? variant.optionValues
              : Array.isArray(variant?.options)
                ? variant.options
                : [];
            const optionKey = optionValues
              .map((value: unknown) => String(value).trim())
              .join("|");
            const savedMeasurement = measurementsByOptionKey.get(optionKey);
            return {
              id:
                savedMeasurement?.variantId ||
                variant.variantId ||
                savedShopifyVariantIds[index] ||
                `draft-variant-${index}`,
              title:
                variant.title ||
                optionValues.map((value: unknown) => String(value)).join(" / "),
              optionValues,
              price: variant.price != null ? Number(variant.price) : undefined,
              compareAtPrice:
                variant.compareAtPrice != null
                  ? Number(variant.compareAtPrice)
                  : undefined,
              quantity:
                variant.quantity != null ? Number(variant.quantity) : undefined,
              sku: variant.sku || undefined,
              barcode: variant.barcode || undefined,
              measurements:
                savedMeasurement?.measurements || variant.measurements || null,
              mediaUrls: Array.isArray(variant.mediaUrls)
                ? variant.mediaUrls
                : [],
            };
          });
        }
        if (
          variants.length === 1 &&
          imagesLive.length &&
          (liveProduct || !variants[0]?.mediaUrls?.length)
        ) {
          variants[0] = {
            ...variants[0],
            mediaUrls: [
              ...new Set([
                ...(Array.isArray(variants[0]?.mediaUrls)
                  ? variants[0].mediaUrls
                  : []),
                ...imagesLive,
              ]),
            ],
          };
        }
        if (
          !variants.length &&
          isRemovedShopifyProduct &&
          doc.removedEditUsed !== true
        ) {
          const recoveryLabel =
            firstNonEmptyString(doc.singleColor, doc.color, "Product photos");
          productOptions = [
            { name: "Title", values: [recoveryLabel] },
          ];
          variants = [
            {
              id: "removed-recovery-default",
              title: recoveryLabel,
              optionValues: [recoveryLabel],
              price: finiteMoney(doc.price) ?? undefined,
              compareAtPrice: finiteMoney(doc.compareAtPrice) ?? undefined,
              quantity:
                finiteMoney(doc.stock ?? doc.inventory?.quantity) ?? undefined,
              sku: doc.sku || undefined,
              barcode: doc.barcode || undefined,
              measurements: normalizeMeasurements(doc.measurements),
              mediaUrls: imagesLive,
            },
          ];
        }

        const firstVariant = variants[0] || {};
        const hydratedSeo = {
          title: firstNonEmptyString(
            liveProduct?.seo?.title,
            doc.pendingUpdates?.seo?.title,
            doc.seo?.title,
            doc.seoTitle,
            doc.seo_title,
            doc.draft?.seoTitle,
            liveProduct?.title,
            doc.title,
          ),
          description: firstNonEmptyString(
            liveProduct?.seo?.description,
            doc.pendingUpdates?.seo?.description,
            doc.seo?.description,
            doc.seoDescription,
            doc.seo_description,
            doc.draft?.seoDescription,
            textFromHtml(liveProduct?.descriptionHtml),
            doc.description,
          ),
        };
        if (liveProduct && shopifyProductId) {
          const canonicalProductId =
            normalizeShopifyProductId(liveProduct.id) || shopifyProductId;
          await ref.set(
            {
              shopifyProductId: canonicalProductId,
              shopifyProductNumericId:
                canonicalProductId.split("/").pop() || null,
              shopifyStatus: String(liveProduct.status || "")
                .trim()
                .toUpperCase(),
              published:
                String(liveProduct.status || "").trim().toUpperCase() ===
                "ACTIVE",
              ...(imagesLive.length
                ? {
                    image: imagesLive[0],
                    images: imagesLive,
                    imageUrls: imagesLive,
                  }
                : {}),
              ...(firstVariant.price != null
                ? {
                    shopifyPrice: Number(firstVariant.price),
                    sellerDisplayPrice: Number(firstVariant.price),
                  }
                : {}),
              updatedAt: Date.now(),
            },
            { merge: true },
          );
        }

        return res.status(200).json({
          ok: true,
          product: {
            id: snap.id,
            ...doc,
            title: liveProduct?.title || doc.title || "",
            description:
              textFromHtml(liveProduct?.descriptionHtml) ||
              textFromHtml((doc as any).descriptionHtml) ||
              doc.description ||
              "",
            vendor: liveProduct?.vendor || doc.vendor || "",
            productType: liveProduct?.productType || doc.productType || "",
            tags: Array.isArray(liveProduct?.tags)
              ? liveProduct.tags
              : Array.isArray(doc.tags)
                ? doc.tags
                : [],
            seo:
              hydratedSeo.title || hydratedSeo.description
                ? hydratedSeo
                : null,
            compareAtPrice:
              firstVariant.compareAtPrice != null
                ? Number(firstVariant.compareAtPrice)
                : doc.compareAtPrice ?? null,
            barcode: firstVariant.barcode || doc.barcode || "",
            price:
              firstVariant.price != null ? Number(firstVariant.price) : doc.price,
            stock:
              firstVariant.quantity != null ? Number(firstVariant.quantity) : doc.stock,
            productOptions,
            variants,
            imagesLive,
          },
        });
      }

      /* ---------- Safe delete with typed-SKU confirmation ---------- */
      if (op === "delete") {
        const id = String(body.id || "");
        const typedSku = String(body.typedSku || "");
        if (!id || !typedSku)
          return res
            .status(400)
            .json({ ok: false, error: "Missing id or typedSku" });

        const ref = adminDb.collection("merchantProducts").doc(id);
        const snap = await ref.get();
        if (!snap.exists)
          return res.status(404).json({ ok: false, error: "Not found" });

        const doc = snap.data() || {};
        if (doc.merchantId && doc.merchantId !== uid) {
          return res.status(403).json({ ok: false, error: "Forbidden" });
        }

        const sku = normSku(String(doc.sku || ""));
        if (!sku || normSku(typedSku) !== sku) {
          return res.status(400).json({ ok: false, error: "SKU mismatch" });
        }

        const shopifyProductId: string | undefined = doc.shopifyProductId;

        // Best effort: delete in Shopify (hard delete), else at least archive later if needed
        if (shopifyProductId) {
          try {
            const r = await shopifyGraphQL(PRODUCT_DELETE, {
              input: { id: shopifyProductId },
            });
            const uerr = r?.data?.productDelete?.userErrors || [];
            if (uerr.length) console.warn("productDelete userErrors:", uerr);
          } catch (e) {
            console.warn("productDelete failed:", e);
          }
        }

        // Release SKU claim so vendor can reuse it later
        const claimRef = adminDb
          .collection("skuClaims")
          .doc(skuClaimId(uid, sku));
        await claimRef.delete().catch(() => {});

        // Remove product ownership mapping (best-effort)
        const productNum =
          String(doc.shopifyProductNumericId || "").trim() ||
          (shopifyProductId
            ? String(shopifyProductId).split("/").pop() || ""
            : "");
        if (productNum) {
          await adminDb
            .collection("shopifyProductOwners")
            .doc(productNum)
            .delete()
            .catch(() => {});
        }

        // Soft delete doc (or use ref.delete() if you prefer hard delete)
        await ref.set(
          { status: "deleted", deletedAt: Date.now() },
          { merge: true },
        );

        return res.status(200).json({ ok: true, deleted: true });
      }

      /* ---------- Default: product update (quick + review) ---------- */
      const { id } = body;
      if (!id) return res.status(400).json({ ok: false, error: "Missing id" });

      const ref = adminDb.collection("merchantProducts").doc(id);
      const snap = await ref.get();
      if (!snap.exists)
        return res.status(404).json({ ok: false, error: "Not found" });

      const doc = snap.data() || {};
      if (doc.merchantId && doc.merchantId !== uid) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }

      const shopifyProductId: string | undefined = doc.shopifyProductId;
      const isShopifyRemoved =
        String(doc.shopifyStatus || "").trim().toUpperCase() === "DELETED" ||
        doc.shopifyDeletedAt != null ||
        doc.status === "deleted";
      const isRemovedRecovery =
        isShopifyRemoved && body.removedRecovery === true;
      if (isShopifyRemoved && !isRemovedRecovery) {
        return res.status(409).json({
          ok: false,
          error:
            "This removed product can only be changed through its one-time edit request.",
        });
      }
      if (isRemovedRecovery && doc.removedEditUsed === true) {
        return res.status(409).json({
          ok: false,
          error: "The one-time edit chance for this product has already been used.",
        });
      }
      const defaultVariantId: string | undefined = Array.isArray(
        doc.shopifyVariantIds,
      )
        ? doc.shopifyVariantIds[0]
        : undefined;

      const updates: any = { updatedAt: Date.now() };
      let adminNeedsReview = false;

      // ----- quick (price / stock) -----
      const quick =
        body.quick && typeof body.quick === "object" ? body.quick : {};

      if (body.price != null && body.price !== "" && quick.price == null)
        quick.price = body.price;
      if (
        body.stockQty != null &&
        body.stockQty !== "" &&
        quick.quantity == null
      )
        quick.quantity = body.stockQty;

      const quickPrice =
        quick.price !== undefined ? Number(quick.price) : undefined;
      const quickQty =
        quick.quantity !== undefined ? Number(quick.quantity) : undefined;
      const quickVariants = Array.isArray(quick.variants)
        ? quick.variants
        : Array.isArray(body.variants)
          ? body.variants
          : [];

      const variantsPayload: any[] = [];
      if (!isRemovedRecovery && shopifyProductId) {
        if (
          defaultVariantId &&
          quickPrice != null &&
          !Number.isNaN(quickPrice)
        ) {
          variantsPayload.push({
            id: defaultVariantId,
            price: String(quickPrice),
          });
        }
        for (const v of quickVariants) {
          if (!v || !v.id) continue;
          if (v.price == null || v.price === "") continue;
          const vp = Number(v.price);
          if (Number.isNaN(vp)) continue;
          variantsPayload.push({ id: v.id, price: String(vp) });
        }
      }

      if (variantsPayload.length && shopifyProductId) {
        const updateRes = await shopifyGraphQL(VARIANTS_BULK_UPDATE, {
          productId: shopifyProductId,
          variants: variantsPayload,
        });
        const errors =
          updateRes?.data?.productVariantsBulkUpdate?.userErrors || [];
        if (errors.length) {
          const msg = errors.map((e: any) => e.message).join("; ");
          return res
            .status(400)
            .json({
              ok: false,
              error: msg || "Failed to update variants on Shopify",
            });
        }
      }

      if (
        !isRemovedRecovery &&
        quickPrice != null &&
        !Number.isNaN(quickPrice)
      ) {
        updates.price = quickPrice;
        updates.shopifyPrice = quickPrice;
        updates.sellerDisplayPrice = quickPrice;
        updates.priceIncludesDelivery = true;
      }

      if (!isRemovedRecovery && quickQty != null && !Number.isNaN(quickQty)) {
        updates.stock = quickQty;

        const locationId = normalizeLocationId(
          process.env.SHOPIFY_LOCATION_ID,
        );
        const inventoryItemId: string | undefined = doc.inventoryItemId;
        if (locationId && inventoryItemId) {
          try {
            const invRes = await shopifyGraphQL(INVENTORY_SET_ON_HAND, {
              input: {
                reason: "correction",
                setQuantities: [
                  { inventoryItemId, locationId, quantity: quickQty },
                ],
              },
            });
            const invErrors =
              invRes?.data?.inventorySetOnHandQuantities?.userErrors || [];
            if (invErrors.length)
              console.warn("inventorySetOnHandQuantities errors:", invErrors);
          } catch (e) {
            console.warn("inventorySetOnHandQuantities failed:", e);
          }
        }
      }

      // ----- review changes -----
      // Supports both payload styles:
      // 1. { changes: { title, measurements, ... } }
      // 2. { title, measurements, ... } directly from the current Products.tsx form.
      const changes =
        body.changes && typeof body.changes === "object" ? body.changes : {};
      const changedForReview: Record<string, any> = {};
      const reviewFields = [
        "title",
        "description",
        "productType",
        "collections",
        "tags",
        "seo",
        "vendor",
        "compareAtPrice",
        "barcode",
        "weightGrams",
        "removeVariantIds",
        "variantMediaUpdates",
      ] as const;

      for (const field of reviewFields) {
        const value =
          changes[field] !== undefined ? changes[field] : body[field];
        if (value !== undefined) changedForReview[field] = value;
      }

      const measurementInput =
        changes.measurements !== undefined
          ? changes.measurements
          : body.measurements;
      if (measurementInput !== undefined) {
        changedForReview.measurements = normalizeMeasurements(measurementInput);
      }

      const variantMeasurementInput =
        changes.variantMeasurements !== undefined
          ? changes.variantMeasurements
          : body.variantMeasurements;
      if (variantMeasurementInput !== undefined) {
        changedForReview.variantMeasurements = normalizeVariantMeasurements(
          variantMeasurementInput,
        );
      }

      const variantDraft =
        body.variantDraft !== undefined
          ? body.variantDraft
          : changes.variantDraft;
      if (variantDraft !== undefined) {
        changedForReview.variantDraft = variantDraft;
        const draftMeasurements = normalizeVariantMeasurements(
          Array.isArray(variantDraft?.variants) ? variantDraft.variants : [],
        );
        if (
          draftMeasurements.length &&
          changedForReview.variantMeasurements === undefined
        ) {
          changedForReview.variantMeasurements = draftMeasurements;
        }
      }

      if (isRemovedRecovery) {
        if (quickPrice != null && !Number.isNaN(quickPrice)) {
          changedForReview.price = quickPrice;
        }
        if (quickQty != null && !Number.isNaN(quickQty)) {
          changedForReview.stock = quickQty;
          changedForReview.inventory = {
            ...(doc.inventory || {}),
            quantity: quickQty,
          };
        }

        const recoveryVariantDraft = mergeRemovedRecoveryVariantDraft({
          currentDraft: doc.variantDraft,
          requestedDraft: changedForReview.variantDraft,
          quickVariants,
          shopifyVariantIds: doc.shopifyVariantIds || [],
          mediaUpdates: changedForReview.variantMediaUpdates || [],
          removeVariantIds: changedForReview.removeVariantIds || [],
        });
        if (recoveryVariantDraft) {
          changedForReview.variantDraft = recoveryVariantDraft;
        } else {
          const recoveryImages = mergeRemovedRecoveryProductImages(
            doc,
            changedForReview.variantMediaUpdates || [],
          );
          changedForReview.resourceUrls = recoveryImages;
          changedForReview.images = recoveryImages;
          changedForReview.imageUrls = recoveryImages;
          changedForReview.image = recoveryImages[0] || null;
        }
        delete changedForReview.removeVariantIds;
        delete changedForReview.variantMediaUpdates;
      }

      if (Object.keys(changedForReview).length) {
        adminNeedsReview = true;
        const mergedPendingUpdates = {
          ...(doc.pendingUpdates || {}),
          ...changedForReview,
        };
        const instantApplied = isRemovedRecovery
          ? []
          : [
              quickPrice != null && !Number.isNaN(quickPrice) ? "price" : null,
              quickQty != null && !Number.isNaN(quickQty) ? "stock" : null,
              quickVariants?.length ? "variant price/stock" : null,
            ].filter(Boolean) as string[];

        updates.pendingUpdates = mergedPendingUpdates;
        updates.changeSummary = buildChangeSummary(
          doc,
          mergedPendingUpdates,
          instantApplied,
        );
        updates.preReviewStatus =
          doc.status === "update_in_review"
            ? doc.preReviewStatus || "approved"
            : doc.status || "approved";
        updates.status = "update_in_review";
        if (isRemovedRecovery) {
          updates.removedRecoveryReview = true;
        }
      }

      if (isRemovedRecovery) {
        if (!adminNeedsReview) {
          return res.status(400).json({
            ok: false,
            error: "Make at least one change before using the one-time edit request.",
          });
        }
        try {
          await adminDb.runTransaction(async (transaction: any) => {
            const freshSnap = await transaction.get(ref);
            if (!freshSnap.exists) {
              const error: any = new Error("Product not found.");
              error.statusCode = 404;
              throw error;
            }
            const fresh = freshSnap.data() || {};
            if (fresh.removedEditUsed === true) {
              const error: any = new Error(
                "The one-time edit chance for this product has already been used.",
              );
              error.statusCode = 409;
              throw error;
            }
            transaction.set(
              ref,
              {
                ...updates,
                removedEditUsed: true,
                removedEditUsedAt: Date.now(),
              },
              { merge: true },
            );
          });
        } catch (error: any) {
          if (error?.statusCode) {
            return res
              .status(error.statusCode)
              .json({ ok: false, error: error.message });
          }
          throw error;
        }
      } else {
        await ref.set(updates, { merge: true });
      }

      const live =
        !isRemovedRecovery &&
        (quickPrice != null ||
          quickQty != null ||
          (quickVariants && quickVariants.length > 0));
      return res.status(200).json({
        ok: true,
        review: adminNeedsReview,
        note: adminNeedsReview
          ? isRemovedRecovery
            ? "One-time recovery request sent to admin review."
            : `Price/stock updated live where possible.${live ? " Other changes queued for admin review." : ""}`
          : live
            ? "Updated live on Shopify."
            : "No changes detected.",
      });
    }

    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (e: any) {
    console.error("update endpoint error:", e?.message || e);
    return res
      .status(500)
      .json({ ok: false, error: e?.message || "Internal error" });
  }
}
