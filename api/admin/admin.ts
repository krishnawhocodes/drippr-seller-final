// api/admin.ts
import { getAdmin } from "../_lib/firebaseAdmin.js";
import { shopifyGraphQL } from "../_lib/shopify.js";

const MEASUREMENT_METAFIELD_NAMESPACE = "garment_sizing";

function normSku(raw: unknown) {
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

function comparableMeasurements(input: any) {
  const measurements = normalizeMeasurements(input);
  return hasAnyMeasurement(measurements) ? measurements : null;
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

function mergeVariantMeasurementRecords(current: any, incoming: any) {
  const merged = new Map<string, any>();
  const keyFor = (variant: any) =>
    String(variant.variantId || "").trim() ||
    (variant.optionValues || [])
      .map((value: string) => value.toLowerCase())
      .join("|");

  for (const variant of normalizeVariantMeasurements(current)) {
    merged.set(keyFor(variant), variant);
  }
  for (const variant of normalizeVariantMeasurements(incoming)) {
    merged.set(keyFor(variant), {
      ...(merged.get(keyFor(variant)) || {}),
      ...variant,
    });
  }
  return [...merged.values()];
}

function buildMeasurementMetafields(ownerId: string, measurements: any) {
  if (!ownerId || !measurements || typeof measurements !== "object") return [];

  const fields = ["chest", "length", "shoulder", "waist", "hip", "inseam"] as const;
  return fields
    .map((key) => {
      const value = measurements[key];
      return typeof value === "number"
        ? {
            ownerId,
            namespace: MEASUREMENT_METAFIELD_NAMESPACE,
            key,
            type: "number_decimal",
            value: String(value),
          }
        : null;
    })
    .filter(Boolean);
}

const METAFIELDS_SET = /* GraphQL */ `
  mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
        namespace
        key
        value
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const VARIANT_SIZING_VERIFY = /* GraphQL */ `
  query variantSizingVerify($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        metafields(first: 10, namespace: "garment_sizing") {
          nodes {
            key
            value
          }
        }
      }
    }
  }
`;

function chunkItems<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

const SELLER_DELIVERY_PRICE_BUMP = 100;

function sellerVariantPriceForShopify(
  price: unknown,
  fallback: unknown,
  deliveryChargeAmount = SELLER_DELIVERY_PRICE_BUMP,
) {
  const raw = Number(price == null || price === "" ? fallback : price);
  return Number.isFinite(raw) ? raw + deliveryChargeAmount : raw;
}

function sellerDescriptionToHtml(value: unknown) {
  const normalized = String(value || "").replace(/\r\n?/g, "\n");
  const escapeHtml = (text: string) =>
    text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  const preserveSpacing = (line: string) => {
    const expanded = escapeHtml(line.replace(/\t/g, "    "));
    const withLeadingSpacing = expanded.replace(/^ +/, (spaces) =>
      "&nbsp;".repeat(spaces.length),
    );
    return withLeadingSpacing.replace(/ {2,}/g, (spaces) =>
      ` ${"&nbsp;".repeat(spaces.length - 1)}`,
    );
  };
  return normalized.split("\n").map(preserveSpacing).join("<br>");
}

async function setMetafieldsInBatches(metafields: any[]) {
  for (const batch of chunkItems(metafields, 25)) {
    const result = await shopifyGraphQL(METAFIELDS_SET, { metafields: batch });
    const errors = result?.data?.metafieldsSet?.userErrors || [];
    if (errors.length) {
      throw new Error(errors.map((error: any) => error.message).join("; "));
    }
  }
}

const PRODUCT_UPDATE = /* GraphQL */ `
  mutation productUpdate($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product {
        id
        title
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const PRODUCT_UPDATE_LEGACY = /* GraphQL */ `
  mutation productUpdate($input: ProductInput!) {
    productUpdate(input: $input) {
      product {
        id
        title
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const PRODUCT_STATUS_QUERY = /* GraphQL */ `
  query productStatus($id: ID!) {
    product(id: $id) {
      id
      status
    }
  }
`;

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
          alt
          status
          mediaContentType
          ... on MediaImage {
            image {
              url
              altText
            }
          }
        }
      }
    }
  }
`;

const PRODUCT_VARIANT_MEDIA_QUERY = /* GraphQL */ `
  query productVariantMedia($id: ID!) {
    product(id: $id) {
      variants(first: 100) {
        nodes {
          id
          selectedOptions {
            name
            value
          }
          media(first: 100) {
            nodes {
              id
            }
          }
        }
      }
    }
  }
`;

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

const PRODUCT_DELETE_MEDIA = /* GraphQL */ `
  mutation productDeleteMedia($productId: ID!, $mediaIds: [ID!]!) {
    productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
      deletedMediaIds
      deletedProductImageIds
      mediaUserErrors {
        field
        message
        code
      }
      userErrors {
        field
        message
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

const VARIANTS_BULK_DELETE = /* GraphQL */ `
  mutation productVariantsBulkDelete($productId: ID!, $variantsIds: [ID!]!) {
    productVariantsBulkDelete(productId: $productId, variantsIds: $variantsIds) {
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

const PRODUCT_CREATE_MEDIA = /* GraphQL */ `
  mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media {
        id
      }
      mediaUserErrors {
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

const PRODUCT_INVENTORY_QUERY = /* GraphQL */ `
  query productInventory($id: ID!) {
    product(id: $id) {
      variants(first: 1) {
        nodes {
          id
          inventoryItem {
            id
          }
        }
      }
    }
  }
`;

const PRODUCT_BY_SKU_QUERY = /* GraphQL */ `
  query productBySku($query: String!) {
    productVariants(first: 1, query: $query) {
      nodes {
        id
        product {
          id
        }
      }
    }
  }
`;

const COLLECTIONS_QUERY = /* GraphQL */ `
  query collectionsForOrganization {
    collections(first: 250) {
      nodes {
        id
        title
      }
    }
  }
`;

const COLLECTION_CREATE = /* GraphQL */ `
  mutation collectionCreate($input: CollectionInput!) {
    collectionCreate(input: $input) {
      collection {
        id
        title
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const COLLECTION_ADD_PRODUCTS = /* GraphQL */ `
  mutation collectionAddProducts($id: ID!, $productIds: [ID!]!) {
    collectionAddProducts(id: $id, productIds: $productIds) {
      collection {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const COLLECTION_REMOVE_PRODUCTS = /* GraphQL */ `
  mutation collectionRemoveProducts($id: ID!, $productIds: [ID!]!) {
    collectionRemoveProducts(id: $id, productIds: $productIds) {
      job {
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

const PRODUCT_VARIANTS_FOR_REPAIR = /* GraphQL */ `
  query productVariantsForRepair($id: ID!) {
    product(id: $id) {
      id
      variants(first: 100) {
        nodes {
          id
          price
          compareAtPrice
          taxable
          inventoryItem {
            id
            unitCost {
              amount
            }
            tracked
          }
        }
      }
    }
  }
`;

function throwUserErrors(result: any, path: string) {
  const errors = path
    .split(".")
    .reduce((value, key) => value?.[key], result)?.userErrors || [];
  if (errors.length) {
    throw new Error(errors.map((error: any) => error.message).join("; "));
  }
}

function normalizeLocationId(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  return raw.startsWith("gid://shopify/Location/")
    ? raw
    : `gid://shopify/Location/${raw}`;
}

function normalizeShopifyGid(
  value: unknown,
  resource: "Product" | "ProductVariant",
) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (raw.startsWith(`gid://shopify/${resource}/`)) return raw;
  const numericId = raw.split("/").pop() || "";
  return /^\d+$/.test(numericId)
    ? `gid://shopify/${resource}/${numericId}`
    : null;
}

function normalizeShopifyMediaId(value: unknown) {
  const raw = String(value || "").trim();
  return raw.startsWith("gid://shopify/MediaImage/") ? raw : null;
}

function mediaSourceToken(value: unknown) {
  const source = String(value || "").trim();
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `v1-${(hash >>> 0).toString(36)}-${source.length.toString(36)}`;
}

function mediaAltText(color: string, sourceUrl: string) {
  const colorMarker = color ? `DRIPPR_COLOR:${color}|` : "";
  return `${colorMarker}DRIPPR_SOURCE:${mediaSourceToken(sourceUrl)}`;
}

function mediaSourceTokenFromAlt(value: unknown) {
  const match = String(value || "").match(/(?:^|\|)DRIPPR_SOURCE:([^|]+)/i);
  return match?.[1]?.trim().toLowerCase() || "";
}

function normalizeProductMeasurements(input: any) {
  return hasAnyMeasurement(normalizeMeasurements(input))
    ? normalizeMeasurements(input)
    : null;
}

function normalizeVariantDraft(input: any) {
  if (!input || typeof input !== "object") return null;

  const options = Array.isArray(input.options)
    ? input.options
        .map((option: any) => ({
          name: String(option?.name || "").trim(),
          values: Array.isArray(option?.values)
            ? option.values
                .map((value: any) => String(value).trim())
                .filter(Boolean)
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
          const measurements = normalizeProductMeasurements(
            variant?.measurements,
          );
          return {
            ...variant,
            options: optionValues
              .map((value: any) => String(value).trim())
              .filter(Boolean),
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
            quantity:
              variant?.quantity == null || variant.quantity === ""
                ? undefined
                : Number(variant.quantity),
            weightGrams:
              variant?.weightGrams == null || variant.weightGrams === ""
                ? undefined
                : Number(variant.weightGrams),
            sku: String(variant?.sku || "").trim() || undefined,
            barcode: String(variant?.barcode || "").trim() || undefined,
            mediaUrls: Array.isArray(variant?.mediaUrls)
              ? variant.mediaUrls
                  .map((url: unknown) => String(url).trim())
                  .filter(Boolean)
              : [],
            measurements,
          };
        })
        .filter((variant: any) => variant.optionValues.length)
    : [];

  return options.length || variants.length ? { options, variants } : null;
}

function buildProductMeasurementMetafields(measurements: any) {
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

function resolveShopifyProductId(qdoc: any) {
  return (
    normalizeShopifyGid(qdoc.shopifyProductId, "Product") ||
    normalizeShopifyGid(qdoc.shopifyProductNumericId, "Product") ||
    normalizeShopifyGid(qdoc.productId, "Product") ||
    normalizeShopifyGid(qdoc.shopifyId, "Product")
  );
}

async function recoverShopifyProductIdBySku(qdoc: any) {
  const sku = String(qdoc.sku || "").trim();
  if (!sku) return null;
  const escapedSku = sku.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const result = await shopifyGraphQL(PRODUCT_BY_SKU_QUERY, {
    query: `sku:"${escapedSku}"`,
  });
  return normalizeShopifyGid(
    result?.data?.productVariants?.nodes?.[0]?.product?.id,
    "Product",
  );
}

function normalizeCollectionTitles(input: unknown) {
  return Array.isArray(input)
    ? [...new Set(input.map((value) => String(value).trim()).filter(Boolean))]
    : [];
}

async function syncShopifyCollections(args: {
  productId: string;
  previousTitles: string[];
  desiredTitles: string[];
  removeDeselected: boolean;
}) {
  const collectionsResult = await shopifyGraphQL(COLLECTIONS_QUERY, {});
  const collectionNodes = Array.isArray(
    collectionsResult?.data?.collections?.nodes,
  )
    ? collectionsResult.data.collections.nodes
    : [];
  const collectionsByTitle = new Map<string, { id: string; title: string }>();
  for (const collection of collectionNodes) {
    if (collection?.id && collection?.title) {
      collectionsByTitle.set(String(collection.title).trim().toLowerCase(), {
        id: String(collection.id),
        title: String(collection.title).trim(),
      });
    }
  }

  for (const title of args.desiredTitles) {
    const key = title.toLowerCase();
    if (collectionsByTitle.has(key)) continue;
    const createResult = await shopifyGraphQL(COLLECTION_CREATE, {
      input: { title },
    });
    throwUserErrors(createResult, "data.collectionCreate");
    const created = createResult?.data?.collectionCreate?.collection;
    if (!created?.id) {
      throw new Error(`Shopify did not create collection: ${title}`);
    }
    collectionsByTitle.set(key, {
      id: String(created.id),
      title: String(created.title || title),
    });
  }

  for (const title of args.desiredTitles) {
    const collection = collectionsByTitle.get(title.toLowerCase());
    if (!collection) continue;
    const addResult = await shopifyGraphQL(COLLECTION_ADD_PRODUCTS, {
      id: collection.id,
      productIds: [args.productId],
    });
    const addErrors = (
      addResult?.data?.collectionAddProducts?.userErrors || []
    ).filter(
      (error: any) =>
        !/already|included/i.test(String(error?.message || "")),
    );
    if (addErrors.length) {
      throw new Error(
        addErrors.map((error: any) => error.message).join("; "),
      );
    }
  }

  if (args.removeDeselected) {
    const desiredKeys = new Set(
      args.desiredTitles.map((title) => title.toLowerCase()),
    );
    for (const title of args.previousTitles) {
      if (desiredKeys.has(title.toLowerCase())) continue;
      const collection = collectionsByTitle.get(title.toLowerCase());
      if (!collection) continue;
      const removeResult = await shopifyGraphQL(COLLECTION_REMOVE_PRODUCTS, {
        id: collection.id,
        productIds: [args.productId],
      });
      const removeErrors = (
        removeResult?.data?.collectionRemoveProducts?.userErrors || []
      ).filter(
        (error: any) =>
          !/not.*collection|not included/i.test(
            String(error?.message || ""),
          ),
      );
      if (removeErrors.length) {
        throw new Error(
          removeErrors.map((error: any) => error.message).join("; "),
        );
      }
    }
  }
}

async function updateShopifyProduct(productInput: Record<string, any>) {
  try {
    const result = await shopifyGraphQL(PRODUCT_UPDATE, {
      product: productInput,
    });
    throwUserErrors(result, "data.productUpdate");
    return;
  } catch (error: any) {
    const message = String(error?.message || error);
    const needsLegacyMutation =
      message.includes("ProductUpdateInput") ||
      message.includes('Unknown argument "product"') ||
      message.includes('argument "input" of type') ||
      (message.includes("productUpdate") &&
        message.includes("input") &&
        message.includes("product"));
    if (!needsLegacyMutation) {
      throw new Error(`Shopify product publish failed: ${message}`);
    }
  }

  try {
    const legacyResult = await shopifyGraphQL(PRODUCT_UPDATE_LEGACY, {
      input: productInput,
    });
    throwUserErrors(legacyResult, "data.productUpdate");
  } catch (error: any) {
    throw new Error(
      `Shopify product publish failed with both API formats: ${String(error?.message || error)}`,
    );
  }
}

function resolveApprovedShopifyStatus(qdoc: any) {
  if (qdoc.status === "pending") return "DRAFT";
  const currentStatus = String(qdoc.shopifyStatus || "").trim().toUpperCase();
  if (["ACTIVE", "DRAFT", "ARCHIVED"].includes(currentStatus)) {
    return currentStatus;
  }
  if (qdoc.published === false) return "DRAFT";
  return "ACTIVE";
}

async function fetchShopifyProductStatus(productId: string) {
  const result = await shopifyGraphQL(PRODUCT_STATUS_QUERY, { id: productId });
  if (!result?.data?.product) return "MISSING";
  const status = String(result.data.product.status || "").trim().toUpperCase();
  return ["ACTIVE", "DRAFT", "ARCHIVED"].includes(status) ? status : null;
}

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
  } catch {}
  return [...keys].filter(Boolean);
}

async function deleteProductMediaByIds(productId: string, input: unknown) {
  const requestedIds = [
    ...new Set(
      (Array.isArray(input) ? input : [])
        .map((id) => normalizeShopifyMediaId(id))
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (!requestedIds.length) return 0;

  const before = await shopifyGraphQL(PRODUCT_IMAGES_QUERY, { id: productId });
  const beforeProduct = before?.data?.product;
  if (!beforeProduct) return 0;
  const beforeMediaNodes = beforeProduct.media?.nodes || [];
  const beforeImageNodes = beforeProduct.images?.nodes || [];
  const existingIds = new Set<string>(
    beforeMediaNodes
      .map((node: any) => String(node?.id || "").trim())
      .filter(Boolean),
  );
  const idsToDelete = requestedIds.filter((id) => existingIds.has(id));
  if (!idsToDelete.length) return 0;

  const mediaUrlById = new Map<string, string>();
  for (const node of beforeMediaNodes) {
    const mediaId = String(node?.id || "").trim();
    const mediaUrl = String(node?.image?.url || "").trim();
    if (mediaId && mediaUrl) mediaUrlById.set(mediaId, mediaUrl);
  }
  const imageIdsByKey = new Map<string, Set<string>>();
  for (const node of beforeImageNodes) {
    const imageId = String(node?.id || "").trim();
    const imageUrl = String(node?.url || "").trim();
    if (!imageId || !imageUrl) continue;
    for (const key of imageUrlLookupKeys(imageUrl)) {
      const ids = imageIdsByKey.get(key) || new Set<string>();
      ids.add(imageId);
      imageIdsByKey.set(key, ids);
    }
  }
  const deleteErrors: string[] = [];

  for (const mediaId of idsToDelete) {
    const current = await shopifyGraphQL(PRODUCT_IMAGES_QUERY, {
      id: productId,
    });
    const currentIds = new Set<string>(
      (current?.data?.product?.media?.nodes || [])
        .map((node: any) => String(node?.id || "").trim())
        .filter(Boolean),
    );
    if (!currentIds.has(mediaId)) continue;

    try {
      const result = await shopifyGraphQL(PRODUCT_DELETE_MEDIA, {
        productId,
        mediaIds: [mediaId],
      });
      const errors = [
        ...(result?.data?.productDeleteMedia?.mediaUserErrors || []),
        ...(result?.data?.productDeleteMedia?.userErrors || []),
      ];
      const fatalErrors = errors.filter((error: any) => {
        const details = `${String(error?.code || "")} ${String(error?.message || "")}`;
        return !/does not exist|not found|already.*deleted|already.*removed/i.test(
          details,
        );
      });
      if (fatalErrors.length) {
        deleteErrors.push(
          ...fatalErrors.map((error: any) => String(error?.message || error)),
        );
      }
    } catch (error: any) {
      const message = String(error?.message || error);
      if (!/does not exist|not found|already.*deleted|already.*removed/i.test(message)) {
        deleteErrors.push(message);
      }
    }
  }

  let after = await shopifyGraphQL(PRODUCT_IMAGES_QUERY, { id: productId });
  let remainingIds = new Set<string>(
    (after?.data?.product?.media?.nodes || [])
      .map((node: any) => String(node?.id || "").trim())
      .filter(Boolean),
  );
  const undeletedIds = idsToDelete.filter((id) => remainingIds.has(id));

  if (undeletedIds.length) {
    const fallbackImageIds = new Set<string>();
    for (const mediaId of undeletedIds) {
      const mediaUrl = mediaUrlById.get(mediaId);
      if (!mediaUrl) continue;
      for (const key of imageUrlLookupKeys(mediaUrl)) {
        for (const imageId of imageIdsByKey.get(key) || []) {
          fallbackImageIds.add(imageId);
        }
      }
    }
    for (const imageId of fallbackImageIds) {
      try {
        const result = await shopifyGraphQL(PRODUCT_IMAGE_DELETE, {
          id: imageId,
        });
        const errors = result?.data?.productImageDelete?.userErrors || [];
        const fatalErrors = errors.filter(
          (error: any) =>
            !/does not exist|not found|already.*deleted|already.*removed/i.test(
              String(error?.message || ""),
            ),
        );
        if (fatalErrors.length) {
          deleteErrors.push(
            ...fatalErrors.map((error: any) => String(error?.message || error)),
          );
        }
      } catch (error: any) {
        const message = String(error?.message || error);
        if (!/does not exist|not found|already.*deleted|already.*removed/i.test(message)) {
          deleteErrors.push(message);
        }
      }
    }
  }

  for (let attempt = 0; attempt < 6; attempt += 1) {
    after = await shopifyGraphQL(PRODUCT_IMAGES_QUERY, { id: productId });
    remainingIds = new Set<string>(
      (after?.data?.product?.media?.nodes || [])
        .map((node: any) => String(node?.id || "").trim())
        .filter(Boolean),
    );
    const stillPresent = idsToDelete.filter((id) => remainingIds.has(id));
    if (!stillPresent.length) return idsToDelete.length;
    if (attempt < 5) await sleep(500 * (attempt + 1));
  }

  const detail = deleteErrors.find(Boolean);
  throw new Error(
    detail
      ? `Shopify did not remove every selected product photo: ${detail}`
      : "Shopify did not remove every selected product photo.",
  );
}

async function deleteProductImagesByUrl(productId: string, urls: string[]) {
  const uniqueUrls = [...new Set(urls.map((url) => String(url).trim()).filter(Boolean))];
  if (!uniqueUrls.length) return 0;
  const response = await shopifyGraphQL(PRODUCT_IMAGES_QUERY, { id: productId });
  const product = response?.data?.product;
  if (!product) return 0;
  const mediaNodes = product.media?.nodes || [];
  const imageNodes = product.images?.nodes || [];
  const mediaIdsByKey = new Map<string, Set<string>>();
  const mediaIdsBySourceToken = new Map<string, Set<string>>();
  const imageIdsByKey = new Map<string, Set<string>>();
  for (const node of mediaNodes) {
    const url = String(node?.image?.url || "").trim();
    const id = String(node?.id || "").trim();
    if (!url || !id) continue;
    for (const key of imageUrlLookupKeys(url)) {
      const ids = mediaIdsByKey.get(key) || new Set<string>();
      ids.add(id);
      mediaIdsByKey.set(key, ids);
    }
    const sourceToken = mediaSourceTokenFromAlt(
      node?.alt || node?.image?.altText,
    );
    if (sourceToken) {
      const ids = mediaIdsBySourceToken.get(sourceToken) || new Set<string>();
      ids.add(id);
      mediaIdsBySourceToken.set(sourceToken, ids);
    }
  }
  for (const node of imageNodes) {
    const url = String(node?.url || "").trim();
    const id = String(node?.id || "").trim();
    if (!url || !id) continue;
    for (const key of imageUrlLookupKeys(url)) {
      const ids = imageIdsByKey.get(key) || new Set<string>();
      ids.add(id);
      imageIdsByKey.set(key, ids);
    }
  }

  const mediaIds = new Set<string>();
  const imageIds = new Set<string>();
  for (const url of uniqueUrls) {
    for (const key of imageUrlLookupKeys(url)) {
      for (const mediaId of mediaIdsByKey.get(key) || []) {
        mediaIds.add(mediaId);
      }
      for (const imageId of imageIdsByKey.get(key) || []) {
        imageIds.add(imageId);
      }
    }
    for (
      const mediaId of
        mediaIdsBySourceToken.get(mediaSourceToken(url).toLowerCase()) || []
    ) {
      mediaIds.add(mediaId);
    }
  }
  const deletedByMediaId = await deleteProductMediaByIds(productId, [
    ...mediaIds,
  ]);

  let verification = await shopifyGraphQL(PRODUCT_IMAGES_QUERY, {
    id: productId,
  });
  const requestedKeys = new Set(uniqueUrls.flatMap(imageUrlLookupKeys));
  const remainingImageIds = new Set<string>();
  for (const node of verification?.data?.product?.images?.nodes || []) {
    const imageUrl = String(node?.url || "").trim();
    if (
      imageUrl &&
      imageUrlLookupKeys(imageUrl).some((key) => requestedKeys.has(key))
    ) {
      const imageId = String(node?.id || "").trim();
      if (imageId) remainingImageIds.add(imageId);
    }
  }
  for (const imageId of remainingImageIds.size ? remainingImageIds : imageIds) {
    try {
      const result = await shopifyGraphQL(PRODUCT_IMAGE_DELETE, {
        id: imageId,
      });
      const errors = result?.data?.productImageDelete?.userErrors || [];
      const fatalErrors = errors.filter(
        (error: any) =>
          !/does not exist|not found|already.*deleted|already.*removed/i.test(
            String(error?.message || ""),
          ),
      );
      if (fatalErrors.length) {
        throw new Error(
          fatalErrors.map((error: any) => error.message).join("; "),
        );
      }
    } catch (error: any) {
      const message = String(error?.message || error);
      if (!/does not exist|not found|already.*deleted|already.*removed/i.test(message)) {
        throw error;
      }
    }
  }

  for (let attempt = 0; attempt < 6; attempt += 1) {
    verification = await shopifyGraphQL(PRODUCT_IMAGES_QUERY, {
      id: productId,
    });
    const remainingUrls = [
      ...(verification?.data?.product?.images?.nodes || []).map(
        (node: any) => node?.url,
      ),
      ...(verification?.data?.product?.media?.nodes || []).map(
        (node: any) => node?.image?.url,
      ),
    ]
      .map((url: unknown) => String(url || "").trim())
      .filter(Boolean)
      .filter((url: string) =>
        imageUrlLookupKeys(url).some((key) => requestedKeys.has(key)),
      );
    if (!remainingUrls.length) {
      return Math.max(deletedByMediaId, mediaIds.size, imageIds.size);
    }
    if (attempt < 5) await sleep(500 * (attempt + 1));
  }

  throw new Error("Shopify did not remove every selected product photo.");
}

async function waitForMediaReady(productId: string, mediaIds: string[]) {
  const expectedIds = new Set(mediaIds);
  if (!expectedIds.size) return;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const result = await shopifyGraphQL(PRODUCT_IMAGES_QUERY, {
      id: productId,
    });
    const nodes = result?.data?.product?.media?.nodes || [];
    const statusById = new Map<string, string>(
      nodes.map((node: any) => [
        String(node?.id || "").trim(),
        String(node?.status || "").trim().toUpperCase(),
      ]),
    );
    const failedId = [...expectedIds].find(
      (id) => statusById.get(id) === "FAILED",
    );
    if (failedId) throw new Error("Shopify failed to process a new product photo.");
    if (
      [...expectedIds].every((id) => statusById.get(id) === "READY")
    ) {
      return;
    }
    if (attempt < 7) await sleep(500 * (attempt + 1));
  }
  throw new Error("Shopify did not finish processing every new product photo.");
}

async function verifyVariantMediaAssociations(
  productId: string,
  pairs: Array<{ variantId: string; mediaId: string }>,
) {
  if (!pairs.length) return;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await shopifyGraphQL(PRODUCT_VARIANT_MEDIA_QUERY, {
      id: productId,
    });
    const mediaByVariant = new Map<string, Set<string>>(
      (result?.data?.product?.variants?.nodes || []).map((variant: any) => [
        String(variant?.id || "").trim(),
        new Set<string>(
          (variant?.media?.nodes || [])
            .map((node: any) => String(node?.id || "").trim())
            .filter(Boolean),
        ),
      ]),
    );
    const missing = pairs.filter(
      (pair) => !mediaByVariant.get(pair.variantId)?.has(pair.mediaId),
    );
    if (!missing.length) return;
    if (attempt < 4) await sleep(400 * (attempt + 1));
  }
  throw new Error("Shopify did not attach every new photo to its colour variants.");
}

async function fetchCdnUrlsWithRetry(productId: string): Promise<string[]> {
  const tries = 6;
  const baseDelay = 700;

  for (let index = 0; index < tries; index += 1) {
    const urls = await listCdnImageUrls(productId);
    if (urls.length) return urls;
    await sleep(baseDelay * (index + 1));
  }

  return [];
}

async function createShopifyVariantsForApproval(args: {
  productId: string;
  variantDraft: any;
  basePrice: number;
  baseCompareAtPrice?: number;
  baseSku: string;
  tracked: boolean;
  cost?: number;
  locationId: string | null;
  deliveryChargeAmount: number;
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
  throwUserErrors(optionsResult, "data.productOptionsCreate");

  const variantsInput = variantDraft.variants.map(
    (variant: any, index: number) => ({
      optionValues: variantDraft.options.map((option: any, optionIndex: number) => ({
        optionName: option.name,
        name:
          variant.optionValues?.[optionIndex] ||
          variant.options?.[optionIndex] ||
          option.values?.[0],
      })),
      price: String(
        sellerVariantPriceForShopify(
          variant.price,
          args.basePrice,
          args.deliveryChargeAmount,
        ),
      ),
      ...((variant.compareAtPrice ?? args.baseCompareAtPrice) != null
        ? {
            compareAtPrice: String(
              variant.compareAtPrice ?? args.baseCompareAtPrice,
            ),
          }
        : {}),
      ...(variant.barcode ? { barcode: variant.barcode } : {}),
      taxable: true,
      inventoryItem: {
        sku: variant.sku || `${args.baseSku}-${index + 1}`,
        tracked: args.tracked,
        ...(args.cost != null ? { cost: String(args.cost) } : {}),
      },
      metafields: buildProductMeasurementMetafields(variant.measurements),
    }),
  );

  const variantsResult = await shopifyGraphQL(VARIANTS_BULK_CREATE, {
    productId: args.productId,
    variants: variantsInput,
  });
  throwUserErrors(variantsResult, "data.productVariantsBulkCreate");

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
          item.inventoryItemId &&
          Number.isFinite(item.quantity) &&
          item.quantity >= 0,
      );
    if (setQuantities.length) {
      const inventoryResult = await shopifyGraphQL(INVENTORY_SET_ON_HAND, {
        input: { reason: "correction", setQuantities },
      });
      throwUserErrors(inventoryResult, "data.inventorySetOnHandQuantities");
    }
  }

  return createdVariants;
}

async function associateApprovedVariantMedia(args: {
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

  for (const mediaInput of variantMedia) {
    const result = await shopifyGraphQL(PRODUCT_VARIANT_APPEND_MEDIA, {
      productId: args.productId,
      variantMedia: [mediaInput],
    });
    throwUserErrors(result, "data.productVariantAppendMedia");
  }

  return {
    variants: new Set(variantMedia.map((item) => item.variantId)).size,
    media: new Set(variantMedia.flatMap((item) => item.mediaIds)).size,
  };
}

async function applyVariantDraftMediaToShopify(args: {
  productId: string;
  variantDraft: any;
  createdVariants: any[];
}) {
  const colorOptionIndex = Array.isArray(args.variantDraft?.options)
    ? args.variantDraft.options.findIndex(
        (option: any) =>
          ["color", "colour"].includes(
            String(option?.name || "").trim().toLowerCase(),
          ),
      )
    : -1;
  const keyForValues = (values: unknown[]) =>
    colorOptionIndex >= 0
      ? String(values[colorOptionIndex] || "").trim().toLowerCase()
      : values.map((value) => String(value || "").trim().toLowerCase()).join("|");

  const mediaUrlsByKey = new Map<string, string[]>();
  const mediaColorByUrl = new Map<string, string>();
  for (const draftVariant of args.variantDraft?.variants || []) {
    const values = draftVariant.optionValues || draftVariant.options || [];
    const key = keyForValues(values);
    const displayColor =
      colorOptionIndex >= 0
        ? String(values[colorOptionIndex] || "").trim()
        : String(draftVariant.title || key).trim();
    const urls = Array.isArray(draftVariant.mediaUrls)
      ? draftVariant.mediaUrls
          .map((url: unknown) => String(url).trim())
          .filter(Boolean)
      : [];
    if (!key || !urls.length) continue;
    mediaUrlsByKey.set(key, [
      ...new Set([...(mediaUrlsByKey.get(key) || []), ...urls]),
    ]);
    urls.forEach((url) => {
      if (displayColor) mediaColorByUrl.set(url, displayColor);
    });
  }
  const resourceUrls = [...new Set([...mediaUrlsByKey.values()].flat())];
  if (!resourceUrls.length) return { colors: 0, variants: 0, media: 0 };

  const createResult = await shopifyGraphQL(PRODUCT_CREATE_MEDIA, {
    productId: args.productId,
    media: resourceUrls.map((url) => ({
      originalSource: url,
      mediaContentType: "IMAGE",
      alt: mediaAltText(mediaColorByUrl.get(url) || "", url),
    })),
  });
  const mediaErrors =
    createResult?.data?.productCreateMedia?.mediaUserErrors || [];
  if (mediaErrors.length) {
    throw new Error(mediaErrors.map((error: any) => error.message).join("; "));
  }
  const createdMedia = createResult?.data?.productCreateMedia?.media || [];
  const mediaIdByUrl = new Map<string, string>();
  resourceUrls.forEach((url, index) => {
    const mediaId = String(createdMedia[index]?.id || "").trim();
    if (mediaId) mediaIdByUrl.set(url, mediaId);
  });

  const variantMediaGroups = args.createdVariants
    .map((variant: any) => {
      const values = Array.isArray(variant?.selectedOptions)
        ? variant.selectedOptions.map((option: any) =>
            String(option?.value || "").trim(),
          )
        : [];
      const key = keyForValues(values);
      const mediaIds = (mediaUrlsByKey.get(key) || [])
        .map((url) => mediaIdByUrl.get(url))
        .filter(Boolean);
      return variant?.id && mediaIds.length
        ? { variantId: variant.id, mediaIds }
        : null;
    })
    .filter(Boolean) as Array<{ variantId: string; mediaIds: string[] }>;

  const variantFeaturedMediaUpdates = variantMediaGroups
    .map((group) => ({
      id: group.variantId,
      mediaId: group.mediaIds[0],
    }))
    .filter((input) => input.mediaId);
  if (variantFeaturedMediaUpdates.length) {
    const updateResult = await shopifyGraphQL(VARIANTS_BULK_UPDATE, {
      productId: args.productId,
      variants: variantFeaturedMediaUpdates,
    });
    throwUserErrors(updateResult, "data.productVariantsBulkUpdate");
  }

  const variantMedia = variantMediaGroups.flatMap((group) =>
    group.mediaIds.map((mediaId) => ({
      variantId: group.variantId,
      mediaIds: [mediaId],
    })),
  );

  for (const mediaInput of variantMedia) {
    const appendResult = await shopifyGraphQL(PRODUCT_VARIANT_APPEND_MEDIA, {
      productId: args.productId,
      variantMedia: [mediaInput],
    });
    throwUserErrors(appendResult, "data.productVariantAppendMedia");
  }

  return {
    colors: mediaUrlsByKey.size,
    variants: new Set(variantMedia.map((item) => item.variantId)).size,
    media: resourceUrls.length,
  };
}

async function createApprovedProductOnShopify(qdoc: any, pendingUpdates: any) {
  const approved = { ...qdoc, ...pendingUpdates };
  const variantDraft = normalizeVariantDraft(approved.variantDraft);
  const measurements = normalizeProductMeasurements(approved.measurements);
  const merchantTag = `merchant:${qdoc.merchantId || approved.merchantId}`;
  const requestedTags = Array.isArray(approved.tags) ? approved.tags : [];
  const tags = [...new Set([merchantTag, ...requestedTags])].filter(
    (tag) => tag && tag !== "merchant:",
  );

  const baseMediaUrls = [
    ...(Array.isArray(approved.resourceUrls) ? approved.resourceUrls : []),
    ...(Array.isArray(approved.images) ? approved.images : []),
    ...(Array.isArray(approved.imageUrls) ? approved.imageUrls : []),
    ...(approved.image ? [approved.image] : []),
  ]
    .map((url: unknown) => String(url).trim())
    .filter(Boolean);
  const variantMediaUrls = (variantDraft?.variants || []).flatMap(
    (variant: any) =>
      Array.isArray(variant.mediaUrls)
        ? variant.mediaUrls.map((url: unknown) => String(url).trim())
        : [],
  );
  const allMediaSources = [...new Set([...baseMediaUrls, ...variantMediaUrls])]
    .filter(Boolean)
    .slice(0, 100);
  const mediaSourceEntries = allMediaSources.map((url, index) => ({
    url,
    alt: `drippr-review-media-${index + 1}`,
  }));
  const isMultipleVariantProduct = Boolean(variantDraft?.variants?.length);
  const mediaInput = mediaSourceEntries.length && !isMultipleVariantProduct
    ? mediaSourceEntries.map((entry) => ({
        originalSource: entry.url,
        mediaContentType: "IMAGE" as const,
        alt: entry.alt,
      }))
    : undefined;

  const productInput = {
    title: approved.title,
    descriptionHtml: sellerDescriptionToHtml(approved.description),
    vendor: approved.vendor || "DRIPPR Marketplace",
    productType: approved.productType || undefined,
    status: "DRAFT",
    seo: approved.seo || undefined,
    tags,
    metafields: buildProductMeasurementMetafields(measurements),
  };

  const createResult = await shopifyGraphQL(PRODUCT_CREATE, {
    product: productInput,
    media: mediaInput,
  });
  throwUserErrors(createResult, "data.productCreate");

  const product = createResult?.data?.productCreate?.product;
  const firstVariant = product?.variants?.nodes?.[0];
  if (!product?.id || !firstVariant?.id) {
    throw new Error("Product approved but Shopify did not return a product.");
  }

  const createdMediaEdges = Array.isArray(product?.media?.edges)
    ? product.media.edges
    : [];
  const sourceByAlt = new Map(
    mediaSourceEntries.map((entry) => [entry.alt, entry.url]),
  );
  const mediaIdBySource = new Map<string, string>();
  createdMediaEdges.forEach((edge: any, index: number) => {
    const mediaId = String(edge?.node?.id || "").trim();
    const altText = String(edge?.node?.image?.altText || "").trim();
    const sourceUrl =
      sourceByAlt.get(altText) || mediaSourceEntries[index]?.url || null;
    if (mediaId && sourceUrl) mediaIdBySource.set(sourceUrl, mediaId);
  });

  const locationId = normalizeLocationId(process.env.SHOPIFY_LOCATION_ID);
  let finalVariantNodes: any[] = [firstVariant];
  let variantMediaSync = { colors: 0, variants: 0, media: 0 };
  const warnings: string[] = [];
  const hasExplicitDeliveryCharge =
    approved.deliveryChargeAmount !== undefined &&
    approved.deliveryChargeAmount !== null;
  const deliveryChargeAmount = hasExplicitDeliveryCharge
    ? Number(approved.deliveryChargeAmount) === 0
      ? 0
      : SELLER_DELIVERY_PRICE_BUMP
    : isMultipleVariantProduct
      ? SELLER_DELIVERY_PRICE_BUMP
      : 0;

  if (variantDraft?.variants?.length) {
    finalVariantNodes =
      (await createShopifyVariantsForApproval({
        productId: product.id,
        variantDraft,
        basePrice: Number(approved.price),
        baseCompareAtPrice:
          approved.compareAtPrice == null
            ? undefined
            : Number(approved.compareAtPrice),
        baseSku: String(approved.sku || "").trim(),
        tracked: approved.inventory?.tracked !== false,
        cost:
          approved.inventory?.cost == null || approved.inventory.cost === ""
            ? undefined
            : Number(approved.inventory.cost),
        locationId,
        deliveryChargeAmount,
      })) || [firstVariant];

    try {
      variantMediaSync = await applyVariantDraftMediaToShopify({
        productId: product.id,
        variantDraft,
        createdVariants: finalVariantNodes,
      });
    } catch (error: any) {
      warnings.push(
        `Product was created as Shopify draft, but variant photo association failed: ${String(error?.message || error)}`,
      );
    }
  } else {
    const variantResult = await shopifyGraphQL(VARIANTS_BULK_UPDATE, {
      productId: product.id,
      variants: [
        {
          id: firstVariant.id,
          price: String(
            sellerVariantPriceForShopify(
              approved.price,
              approved.price,
              deliveryChargeAmount,
            ),
          ),
          ...(approved.compareAtPrice != null
            ? { compareAtPrice: String(approved.compareAtPrice) }
            : {}),
          ...(approved.barcode ? { barcode: approved.barcode } : {}),
          taxable: true,
          inventoryItem: {
            sku: String(approved.sku || "").trim(),
            tracked: approved.inventory?.tracked !== false,
            ...(approved.inventory?.cost != null &&
            approved.inventory.cost !== ""
              ? { cost: String(approved.inventory.cost) }
              : {}),
          },
        },
      ],
    });
    throwUserErrors(variantResult, "data.productVariantsBulkUpdate");

    const inventoryItemId = firstVariant?.inventoryItem?.id;
    const quantity = Number(approved.inventory?.quantity ?? approved.stock);
    if (
      locationId &&
      inventoryItemId &&
      Number.isFinite(quantity) &&
      quantity >= 0
    ) {
      const inventoryResult = await shopifyGraphQL(INVENTORY_SET_ON_HAND, {
        input: {
          reason: "correction",
          setQuantities: [{ inventoryItemId, locationId, quantity }],
        },
      });
      throwUserErrors(inventoryResult, "data.inventorySetOnHandQuantities");
    }
  }

  const cdnUrls = await fetchCdnUrlsWithRetry(product.id);
  const imageUrls = cdnUrls.length ? cdnUrls : allMediaSources;
  const variantMeasurements = variantDraft?.variants?.length
    ? variantDraft.variants.map((variant: any, index: number) => ({
        variantId: finalVariantNodes[index]?.id || null,
        title: finalVariantNodes[index]?.title || variant.title,
        optionValues: variant.optionValues || variant.options || [],
        measurements: variant.measurements,
      }))
    : normalizeVariantMeasurements(approved.variantMeasurements);
  const desiredCollections = normalizeCollectionTitles(approved.collections);
  if (desiredCollections.length) {
    try {
      await syncShopifyCollections({
        productId: product.id,
        previousTitles: normalizeCollectionTitles(qdoc.collections),
        desiredTitles: desiredCollections,
        removeDeselected: false,
      });
    } catch (error: any) {
      warnings.push(
        `Product was created as Shopify draft, but collection sync failed: ${String(error?.message || error)}`,
      );
    }
  }

  const shopifyVariantIds = finalVariantNodes
    .map((variant: any) => String(variant?.id || ""))
    .filter(Boolean);

  return {
    productId: product.id,
    inventoryItemId: finalVariantNodes[0]?.inventoryItem?.id || null,
    warnings,
    collections: desiredCollections,
    shopifyStatus: "DRAFT",
    variantMediaSync,
    imageUrls,
    variantDraft,
    variantMeasurements,
    shopifyVariantIds,
    shopifyVariantNumericIds: shopifyVariantIds.map(
      (variantId: string) => variantId.split("/").pop() || "",
    ),
  };
}

async function applyVariantMediaUpdates(
  productId: string,
  input: unknown,
) {
  const groups = meaningfulVariantMediaUpdates(input);
  if (!groups.length) return { colors: 0, variants: 0, media: 0, deleted: 0 };

  const currentVariantResult = await shopifyGraphQL(
    PRODUCT_VARIANT_MEDIA_QUERY,
    { id: productId },
  );
  const currentVariants =
    currentVariantResult?.data?.product?.variants?.nodes || [];
  const currentVariantIds = new Set<string>(
    currentVariants
      .map((variant: any) => String(variant?.id || "").trim())
      .filter(Boolean),
  );
  const targetVariantIdsForGroup = (group: (typeof groups)[number]) => {
    const normalizedColor = group.color.trim().toLowerCase();
    const colorVariantIds = currentVariants
      .filter((variant: any) =>
        (variant?.selectedOptions || []).some(
          (option: any) =>
            ["color", "colour"].includes(
              String(option?.name || "").trim().toLowerCase(),
            ) &&
            String(option?.value || "").trim().toLowerCase() ===
              normalizedColor,
        ),
      )
      .map((variant: any) => String(variant?.id || "").trim())
      .filter(Boolean);
    const requestedLiveVariantIds = group.variantIds.filter((variantId) =>
      currentVariantIds.has(variantId),
    );
    return [
      ...new Set(
        colorVariantIds.length ? colorVariantIds : requestedLiveVariantIds,
      ),
    ];
  };

  const currentMediaResult = await shopifyGraphQL(PRODUCT_IMAGES_QUERY, {
    id: productId,
  });
  const currentMediaNodes =
    currentMediaResult?.data?.product?.media?.nodes || [];
  const currentMediaIds = new Set<string>();
  const mediaIdsByLookupKey = new Map<string, Set<string>>();
  const mediaIdsBySourceToken = new Map<string, Set<string>>();
  for (const node of currentMediaNodes) {
    const mediaId = String(node?.id || "").trim();
    const mediaUrl = String(node?.image?.url || "").trim();
    if (!mediaId) continue;
    currentMediaIds.add(mediaId);
    if (mediaUrl) {
      for (const key of imageUrlLookupKeys(mediaUrl)) {
        const ids = mediaIdsByLookupKey.get(key) || new Set<string>();
        ids.add(mediaId);
        mediaIdsByLookupKey.set(key, ids);
      }
    }
    const sourceToken = mediaSourceTokenFromAlt(
      node?.alt || node?.image?.altText,
    );
    if (sourceToken) {
      const ids = mediaIdsBySourceToken.get(sourceToken) || new Set<string>();
      ids.add(mediaId);
      mediaIdsBySourceToken.set(sourceToken, ids);
    }
  }
  const mediaIdsForUrls = (urls: string[]) => {
    const ids = new Set<string>();
    for (const url of urls) {
      for (const key of imageUrlLookupKeys(url)) {
        for (const mediaId of mediaIdsByLookupKey.get(key) || []) {
          ids.add(mediaId);
        }
      }
      for (
        const mediaId of
          mediaIdsBySourceToken.get(mediaSourceToken(url).toLowerCase()) || []
      ) {
        ids.add(mediaId);
      }
    }
    return ids;
  };

  const inferredRemoveMediaIds = new Set<string>();
  for (const group of groups) {
    if (!group.retainedResourceUrlsProvided) continue;
    const retainedMediaIds = mediaIdsForUrls(group.retainedResourceUrls);
    const targetVariantIds = new Set(targetVariantIdsForGroup(group));
    for (const variant of currentVariants) {
      const variantId = String(variant?.id || "").trim();
      if (!targetVariantIds.has(variantId)) continue;
      for (const node of variant?.media?.nodes || []) {
        const mediaId = String(node?.id || "").trim();
        if (
          mediaId &&
          currentMediaIds.has(mediaId) &&
          !retainedMediaIds.has(mediaId)
        ) {
          inferredRemoveMediaIds.add(mediaId);
        }
      }
    }
  }

  const removeMediaIds = [
    ...new Set(
      [
        ...groups.flatMap((group) => [
          ...group.removeMediaIds,
          ...Object.values(group.removeMediaIdsByUrl).flat(),
        ]),
        ...groups.flatMap((group) => [
          ...mediaIdsForUrls(group.removeResourceUrls),
        ]),
        ...inferredRemoveMediaIds,
      ].filter(Boolean),
    ),
  ];
  let deletedById = 0;
  try {
    deletedById = await deleteProductMediaByIds(productId, removeMediaIds);
  } catch (error: any) {
    throw new Error(
      `Shopify photo removal failed: ${String(error?.message || error)}`,
    );
  }
  const fallbackDeleteUrls = groups.flatMap(
    (group) => group.removeResourceUrls,
  );
  let deletedByUrl = 0;
  try {
    deletedByUrl = await deleteProductImagesByUrl(
      productId,
      fallbackDeleteUrls,
    );
  } catch (error: any) {
    throw new Error(
      `Shopify photo removal failed: ${String(error?.message || error)}`,
    );
  }
  const deletedMedia = deletedById + deletedByUrl;
  const resourceUrls = [
    ...new Set(groups.flatMap((group) => group.resourceUrls)),
  ];
  if (!resourceUrls.length) {
    return {
      colors: groups.length,
      variants: new Set(groups.flatMap((group) => group.variantIds)).size,
      media: 0,
      deleted: deletedMedia,
    };
  }
  const mediaIdByUrl = new Map<string, string>();
  const existingMediaResult = await shopifyGraphQL(PRODUCT_IMAGES_QUERY, {
    id: productId,
  });
  const existingMediaNodes =
    existingMediaResult?.data?.product?.media?.nodes || [];
  const existingMediaIdBySourceToken = new Map<string, string>();
  for (const node of existingMediaNodes) {
    const id = String(node?.id || "").trim();
    const sourceToken = mediaSourceTokenFromAlt(
      node?.alt || node?.image?.altText,
    );
    if (sourceToken && id) existingMediaIdBySourceToken.set(sourceToken, id);
  }
  for (const resourceUrl of resourceUrls) {
    const existingMediaId = existingMediaIdBySourceToken.get(
      mediaSourceToken(resourceUrl).toLowerCase(),
    );
    if (existingMediaId) mediaIdByUrl.set(resourceUrl, existingMediaId);
  }

  const missingResourceUrls = resourceUrls.filter(
    (url) => !mediaIdByUrl.has(url),
  );
  if (missingResourceUrls.length) {
    for (const url of missingResourceUrls) {
      const color = groups.find((group) =>
        group.resourceUrls.includes(url),
      )?.color;
      const createResult = await shopifyGraphQL(PRODUCT_CREATE_MEDIA, {
        productId,
        media: [
          {
            originalSource: url,
            mediaContentType: "IMAGE",
            alt: mediaAltText(color || "", url),
          },
        ],
      });
      const mediaErrors =
        createResult?.data?.productCreateMedia?.mediaUserErrors || [];
      if (mediaErrors.length) {
        throw new Error(
          mediaErrors.map((error: any) => error.message).join("; "),
        );
      }
      const mediaId = String(
        createResult?.data?.productCreateMedia?.media?.[0]?.id || "",
      ).trim();
      if (!mediaId) {
        throw new Error("Shopify did not return the uploaded product photo ID.");
      }
      mediaIdByUrl.set(url, mediaId);
      await waitForMediaReady(productId, [mediaId]);
    }
  }
  if (mediaIdByUrl.size !== resourceUrls.length) {
    throw new Error("Shopify did not return every uploaded variant photo ID.");
  }

  const liveVariantResult = await shopifyGraphQL(
    PRODUCT_VARIANT_MEDIA_QUERY,
    { id: productId },
  );
  const liveVariants =
    liveVariantResult?.data?.product?.variants?.nodes || [];
  const liveVariantIds = new Set<string>(
    liveVariants
      .map((variant: any) => String(variant?.id || "").trim())
      .filter(Boolean),
  );
  const variantMedia = groups.flatMap((group) => {
    const mediaIds = group.resourceUrls
      .map((url) => mediaIdByUrl.get(url))
      .filter(Boolean);
    if (!mediaIds.length) return [];
    const normalizedColor = group.color.trim().toLowerCase();
    const colorVariantIds = liveVariants
      .filter((variant: any) =>
        (variant?.selectedOptions || []).some(
          (option: any) =>
            ["color", "colour"].includes(
              String(option?.name || "").trim().toLowerCase(),
            ) &&
            String(option?.value || "").trim().toLowerCase() ===
              normalizedColor,
        ),
      )
      .map((variant: any) => String(variant?.id || "").trim())
      .filter(Boolean);
    const requestedLiveVariantIds = group.variantIds.filter((variantId) =>
      liveVariantIds.has(variantId),
    );
    const targetVariantIds = [
      ...new Set(
        colorVariantIds.length ? colorVariantIds : requestedLiveVariantIds,
      ),
    ];
    if (!targetVariantIds.length) {
      throw new Error(
        `Shopify could not find the live ${group.color || "colour"} variants for the new photos.`,
      );
    }
    return targetVariantIds.flatMap((variantId) =>
      mediaIds.map((mediaId) => ({ variantId, mediaIds: [mediaId] })),
    );
  });
  for (const mediaInput of variantMedia) {
    const appendResult = await shopifyGraphQL(PRODUCT_VARIANT_APPEND_MEDIA, {
      productId,
      variantMedia: [mediaInput],
    });
    const appendErrors = (
      appendResult?.data?.productVariantAppendMedia?.userErrors || []
    ).filter(
      (error: any) =>
        !/already|attached|associated/i.test(String(error?.message || "")),
    );
    if (appendErrors.length) {
      throw new Error(
        appendErrors.map((error: any) => error.message).join("; "),
      );
    }
  }
  await verifyVariantMediaAssociations(
    productId,
    variantMedia.map((item) => ({
      variantId: item.variantId,
      mediaId: String(item.mediaIds[0]),
    })),
  );

  return {
    colors: groups.length,
    variants: new Set(variantMedia.map((item) => item.variantId)).size,
    media: resourceUrls.length,
    deleted: deletedMedia,
  };
}

function meaningfulVariantMediaUpdates(input: unknown) {
  return Array.isArray(input)
    ? input
        .map((group: any) => ({
          color: String(group?.color || "").trim(),
          variantIds: Array.isArray(group?.variantIds)
            ? group.variantIds
                .map((id: unknown) => normalizeShopifyGid(id, "ProductVariant"))
                .filter(Boolean)
            : [],
          resourceUrls: Array.isArray(group?.resourceUrls)
            ? group.resourceUrls.map((url: unknown) => String(url).trim()).filter(Boolean)
            : [],
          removeResourceUrls: Array.isArray(group?.removeResourceUrls)
            ? group.removeResourceUrls
                .map((url: unknown) => String(url).trim())
                .filter(Boolean)
            : [],
          retainedResourceUrls: Array.isArray(group?.retainedResourceUrls)
            ? group.retainedResourceUrls
                .map((url: unknown) => String(url).trim())
                .filter(Boolean)
            : [],
          retainedResourceUrlsProvided: Array.isArray(
            group?.retainedResourceUrls,
          ),
          removeMediaIds: Array.isArray(group?.removeMediaIds)
            ? group.removeMediaIds
                .map((id: unknown) => normalizeShopifyMediaId(id))
                .filter(Boolean)
            : [],
          removeMediaIdsByUrl:
            group?.removeMediaIdsByUrl &&
            typeof group.removeMediaIdsByUrl === "object" &&
            !Array.isArray(group.removeMediaIdsByUrl)
              ? Object.fromEntries(
                  Object.entries(group.removeMediaIdsByUrl)
                    .map(([url, ids]) => [
                      String(url || "").trim(),
                      [
                        ...new Set(
                          (Array.isArray(ids) ? ids : [ids])
                            .map((id: unknown) => normalizeShopifyMediaId(id))
                            .filter(Boolean),
                        ),
                      ],
                    ])
                    .filter(([url, ids]) => Boolean(url) && (ids as unknown[]).length),
                )
              : {},
        }))
        .filter(
          (group) =>
            group.resourceUrls.length ||
            group.removeResourceUrls.length ||
            group.removeMediaIds.length ||
            Object.keys(group.removeMediaIdsByUrl).length,
        )
    : [];
}

async function applyApprovedChangesToShopify(qdoc: any, pendingUpdates: any) {
  const savedProductId = resolveShopifyProductId(qdoc);
  const productId = savedProductId || (await recoverShopifyProductIdBySku(qdoc));
  if (!productId) {
    return createApprovedProductOnShopify(qdoc, pendingUpdates);
  }

  let liveShopifyStatus: string | null = null;
  try {
    liveShopifyStatus = await fetchShopifyProductStatus(productId);
  } catch (error) {
    console.warn("Unable to verify Shopify product status before approval", error);
  }
  if (
    liveShopifyStatus === "MISSING" ||
    String(qdoc.shopifyStatus || "").trim().toUpperCase() === "DELETED"
  ) {
    return createApprovedProductOnShopify(
      {
        ...qdoc,
        shopifyProductId: null,
        shopifyProductNumericId: null,
        shopifyVariantIds: [],
        shopifyVariantNumericIds: [],
      },
      pendingUpdates,
    );
  }

  const existingMerchantTags = Array.isArray(qdoc.tags)
    ? qdoc.tags.filter((tag: any) => String(tag).startsWith("merchant:"))
    : [];
  const requestedTags = Array.isArray(pendingUpdates.tags)
    ? pendingUpdates.tags
    : Array.isArray(qdoc.tags)
      ? qdoc.tags
      : [];

  const preservedShopifyStatus =
    qdoc.status === "pending"
      ? "DRAFT"
      : liveShopifyStatus || resolveApprovedShopifyStatus(qdoc);

  const productInput: Record<string, any> = {
    id: productId,
    status: preservedShopifyStatus,
  };
  const warnings: string[] = [];
  if (pendingUpdates.title !== undefined) productInput.title = pendingUpdates.title;
  if (pendingUpdates.description !== undefined)
    productInput.descriptionHtml = sellerDescriptionToHtml(
      pendingUpdates.description,
    );
  if (pendingUpdates.vendor !== undefined) productInput.vendor = pendingUpdates.vendor;
  if (pendingUpdates.productType !== undefined)
    productInput.productType = pendingUpdates.productType || "";
  if (pendingUpdates.tags !== undefined)
    productInput.tags = [...new Set([...existingMerchantTags, ...requestedTags])];
  if (pendingUpdates.seo !== undefined) {
    productInput.seo = {
      title: String(pendingUpdates.seo?.title || ""),
      description: String(pendingUpdates.seo?.description || ""),
    };
  }

  const currentShopifyStatus = String(qdoc.shopifyStatus || "")
    .trim()
    .toUpperCase();
  const hasProductFieldChanges = Object.keys(productInput).some(
    (field) => field !== "id" && field !== "status",
  );
  if (
    hasProductFieldChanges ||
    currentShopifyStatus !== preservedShopifyStatus
  ) {
    await updateShopifyProduct(productInput);
  }

  const desiredCollections = normalizeCollectionTitles(
    pendingUpdates.collections !== undefined
      ? pendingUpdates.collections
      : qdoc.collections,
  );
  const previousCollections = normalizeCollectionTitles(qdoc.collections);
  const collectionsChanged =
    JSON.stringify(previousCollections.map((title) => title.toLowerCase()).sort()) !==
    JSON.stringify(desiredCollections.map((title) => title.toLowerCase()).sort());
  if (desiredCollections.length && collectionsChanged) {
    try {
      await syncShopifyCollections({
        productId,
        previousTitles: previousCollections,
        desiredTitles: desiredCollections,
        removeDeselected: qdoc.collectionsSynced === true,
      });
    } catch (error: any) {
      warnings.push(
        `Product approved, but collection sync failed: ${String(error?.message || error)}`,
      );
    }
  }

  const defaultVariantId = normalizeShopifyGid(
    Array.isArray(qdoc.shopifyVariantIds)
      ? qdoc.shopifyVariantIds[0]
      : qdoc.shopifyVariantId || qdoc.variantId,
    "ProductVariant",
  );
  const variantInputsById = new Map<string, Record<string, any>>();
  const variantInputFor = (variantId: string) => {
    const current = variantInputsById.get(variantId) || { id: variantId };
    variantInputsById.set(variantId, current);
    return current;
  };
  if (defaultVariantId) {
    const variantInput = variantInputFor(defaultVariantId);
    if (pendingUpdates.compareAtPrice !== undefined)
      variantInput.compareAtPrice = String(pendingUpdates.compareAtPrice);
    if (pendingUpdates.barcode !== undefined)
      variantInput.barcode = pendingUpdates.barcode || null;
  }

  if (pendingUpdates.sku !== undefined) {
    const baseSku = normSku(pendingUpdates.sku);
    if (!baseSku) throw new Error("Approved SKU ID cannot be empty.");
    const variantIds = [
      ...new Set(
        (Array.isArray(qdoc.shopifyVariantIds)
          ? qdoc.shopifyVariantIds
          : [defaultVariantId]
        )
          .map((variantId: unknown) =>
            normalizeShopifyGid(variantId, "ProductVariant"),
          )
          .filter(Boolean),
      ),
    ] as string[];
    const savedVariants = Array.isArray(qdoc.variantDraft?.variants)
      ? qdoc.variantDraft.variants
      : [];
    variantIds.forEach((variantId, index) => {
      const explicitVariantSku = String(savedVariants[index]?.sku || "").trim();
      variantInputFor(variantId).inventoryItem = {
        sku:
          explicitVariantSku ||
          (variantIds.length > 1 ? `${baseSku}-${index + 1}` : baseSku),
      };
    });
  }

  const variantInputs = [...variantInputsById.values()].filter(
    (variantInput) => Object.keys(variantInput).length > 1,
  );
  if (variantInputs.length) {
    const variantResult = await shopifyGraphQL(VARIANTS_BULK_UPDATE, {
      productId,
      variants: variantInputs,
    });
    throwUserErrors(variantResult, "data.productVariantsBulkUpdate");
  }

  const removeVariantIds = Array.isArray(pendingUpdates.removeVariantIds)
    ? pendingUpdates.removeVariantIds
        .map((variantId: unknown) =>
          normalizeShopifyGid(variantId, "ProductVariant"),
        )
        .filter(Boolean)
    : [];
  if (removeVariantIds.length) {
    const deleteResult = await shopifyGraphQL(VARIANTS_BULK_DELETE, {
      productId,
      variantsIds: removeVariantIds,
    });
    throwUserErrors(deleteResult, "data.productVariantsBulkDelete");
  }

  let inventoryItemId = qdoc.inventoryItemId || null;
  const approvedStock = Number(
    pendingUpdates.stock !== undefined ? pendingUpdates.stock : qdoc.stock,
  );
  const approvedVariantDraft =
    pendingUpdates.variantDraft || qdoc.variantDraft || null;
  const isMultipleVariantProduct =
    pendingUpdates.variantMode === "multiple" ||
    qdoc.variantMode === "multiple" ||
    (Array.isArray(approvedVariantDraft?.variants) &&
      approvedVariantDraft.variants.length > 1);
  const locationId = normalizeLocationId(process.env.SHOPIFY_LOCATION_ID);
  const variantMediaSync = await applyVariantMediaUpdates(
    productId,
    pendingUpdates.variantMediaUpdates,
  );
  let refreshedImageUrls: string[] | null = null;
  if (variantMediaSync.media || variantMediaSync.deleted) {
    try {
      refreshedImageUrls = await fetchCdnUrlsWithRetry(productId);
    } catch (error: any) {
      warnings.push(
        `Variant photos were updated, but refreshed Shopify image URLs could not be loaded yet: ${String(error?.message || error)}`,
      );
    }
  }
  if (
    !isMultipleVariantProduct &&
    locationId &&
    Number.isFinite(approvedStock) &&
    approvedStock >= 0
  ) {
    if (!inventoryItemId) {
      const inventoryQuery = await shopifyGraphQL(PRODUCT_INVENTORY_QUERY, {
        id: productId,
      });
      inventoryItemId =
        inventoryQuery?.data?.product?.variants?.nodes?.[0]?.inventoryItem?.id ||
        null;
    }
    if (inventoryItemId) {
      try {
        const inventoryResult = await shopifyGraphQL(INVENTORY_SET_ON_HAND, {
          input: {
            reason: "correction",
            setQuantities: [
              { inventoryItemId, locationId, quantity: approvedStock },
            ],
          },
        });
        throwUserErrors(inventoryResult, "data.inventorySetOnHandQuantities");
      } catch (error: any) {
        warnings.push(
          `Product approved, but Shopify inventory sync failed: ${String(error?.message || error)}`,
        );
      }
    }
  }

  return {
    productId,
    inventoryItemId,
    warnings,
    collections: desiredCollections,
    shopifyStatus: productInput.status,
    variantMediaSync,
    ...(refreshedImageUrls ? { imageUrls: refreshedImageUrls } : {}),
  };
}

function changeSummaryForQueueItem(item: any) {
  if (item.changeSummary || item.status !== "update_in_review") {
    return item.changeSummary || null;
  }
  const pending =
    item.pendingUpdates && typeof item.pendingUpdates === "object"
      ? item.pendingUpdates
      : {};
  const base: Record<string, { old: any; new: any }> = {};
  for (const [field, nextValue] of Object.entries(pending)) {
    if (JSON.stringify(item[field] ?? null) !== JSON.stringify(nextValue ?? null)) {
      base[field] = { old: item[field] ?? null, new: nextValue ?? null };
    }
  }
  return {
    instantApplied: [],
    base,
    note: "Highlighted values are pending admin approval before Shopify is updated.",
  };
}

function startOfMonth(d = new Date()) {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startNDaysAgo(n: number) {
  const x = new Date();
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - (n - 1));
  return x;
}

function keyOfDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function labelOfDate(d: Date) {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

async function syncMeasurementsToShopify(
  shopifyProductId: string | undefined,
  measurements: any,
) {
  if (!shopifyProductId) return;

  const metafields = buildMeasurementMetafields(
    shopifyProductId,
    normalizeMeasurements(measurements),
  );
  if (!metafields.length) return;

  await setMetafieldsInBatches(metafields);
}

async function syncVariantMeasurementsToShopify(variantMeasurements: any[]) {
  const normalized = normalizeVariantMeasurements(variantMeasurements);
  const variantsWithSizing = normalized.filter((variant) =>
    hasAnyMeasurement(variant.measurements),
  );
  const variantsWithoutIds = variantsWithSizing.filter(
    (variant) => !normalizeShopifyGid(variant.variantId, "ProductVariant"),
  );
  if (variantsWithoutIds.length) {
    throw new Error(
      `Missing Shopify variant IDs for: ${variantsWithoutIds
        .map((variant) => variant.title || variant.optionValues.join(" / "))
        .join(", ")}`,
    );
  }

  const metafields = variantsWithSizing.flatMap((variant) => {
    const variantId = normalizeShopifyGid(
      variant.variantId,
      "ProductVariant",
    );
    return variantId
      ? buildMeasurementMetafields(variantId, variant.measurements)
      : [];
  });

  if (!metafields.length) return { variants: 0, metafields: 0 };

  await setMetafieldsInBatches(metafields);

  const expectedByVariant = new Map<string, Map<string, number>>();
  for (const metafield of metafields) {
    const expected = expectedByVariant.get(metafield.ownerId) || new Map();
    expected.set(metafield.key, Number(metafield.value));
    expectedByVariant.set(metafield.ownerId, expected);
  }

  const actualByVariant = new Map<string, Map<string, number>>();
  const variantIds = [...expectedByVariant.keys()];
  for (const idBatch of chunkItems(variantIds, 100)) {
    const verifyResult = await shopifyGraphQL(VARIANT_SIZING_VERIFY, {
      ids: idBatch,
    });
    for (const node of verifyResult?.data?.nodes || []) {
      if (!node?.id) continue;
      actualByVariant.set(
        String(node.id),
        new Map(
          (node.metafields?.nodes || []).map((metafield: any) => [
            String(metafield.key),
            Number(metafield.value),
          ]),
        ),
      );
    }
  }

  const missing: string[] = [];
  for (const [variantId, expected] of expectedByVariant) {
    const actual = actualByVariant.get(variantId);
    for (const [key, value] of expected) {
      if (!actual || actual.get(key) !== value) {
        missing.push(`${variantId.split("/").pop()}:${key}`);
      }
    }
  }
  if (missing.length) {
    throw new Error(
      `Shopify did not persist these garment sizing metafields: ${missing.join(", ")}`,
    );
  }

  return {
    variants: expectedByVariant.size,
    metafields: metafields.length,
  };
}

// Helpers
function requireMethod(req: any, res: any, methods: string[]) {
  if (!methods.includes(req.method)) {
    res.setHeader("Allow", methods.join(", "));
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return false;
  }
  return true;
}

async function requireAdmin(req: any, res: any) {
  const { adminAuth } = getAdmin();
  const authHeader = String(req.headers.authorization || "");
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) {
    res.status(401).json({ ok: false, error: "Missing Authorization" });
    return null;
  }
  const decoded = await adminAuth.verifyIdToken(token);
  const adminUids = (process.env.ADMIN_UIDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!adminUids.includes(decoded.uid)) {
    res.status(403).json({ ok: false, error: "Admins only" });
    return null;
  }
  return decoded;
}

export default async function handler(req: any, res: any) {
  try {

    // --- ADD THIS BLOCK ---
    if (req.method === "OPTIONS") {
      res.setHeader("Allow", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      return res.status(200).end();
    }
    // --- END OF BLOCK ---

    if (!requireMethod(req, res, ["GET", "POST"])) return;

    // Parse input
    const body = req.method === "POST" ? (req.body ?? {}) : {};
    const action = (req.query.action as string) || body.action || "";
    if (!action) return res.status(400).json({ ok: false, error: "Missing action" });

    const me = await requireAdmin(req, res);
    if (!me) return;

    const { adminDb } = getAdmin();

    // ---------- ACTIONS ----------
    switch (action) {
      case "admin.me": {
        return res.status(200).json({
          ok: true,
          uid: me.uid,
          email: me.email || null,
          admin: true,
        });
      }

      case "settings.publication.get": {
        const snap = await adminDb.collection("adminSettings").doc("shopify").get();
        return res.status(200).json({
          ok: true,
          publicationId: snap.exists ? snap.data()?.publicationId || null : null,
        });
      }

      case "settings.publication.set": {
        const publicationId = String(body.publicationId || "").trim() || null;
        await adminDb.collection("adminSettings").doc("shopify").set(
          {
            publicationId,
            updatedAt: Date.now(),
            updatedBy: me.uid,
          },
          { merge: true },
        );
        return res.status(200).json({ ok: true, publicationId });
      }

      case "dashboard.overview": {
        const [productsSnap, merchantsSnap, supportSnap, ordersSnap] =
          await Promise.all([
            adminDb.collection("merchantProducts").limit(1000).get(),
            adminDb.collection("merchants").limit(1000).get(),
            adminDb.collection("supportRequests").limit(1000).get(),
            adminDb.collection("orders").limit(1000).get(),
          ]);

        const reviewStatuses = new Set([
          "pending",
          "in_review",
          "update_in_review",
        ]);
        const productsInReview = productsSnap.docs.filter((doc) =>
          reviewStatuses.has(String(doc.data()?.status || "")),
        ).length;
        const activeSellers = merchantsSnap.docs.filter(
          (doc) => doc.data()?.enabled !== false,
        ).length;
        const openTickets = supportSnap.docs.filter((doc) =>
          ["pending", "processing", "under_processing"].includes(
            String(doc.data()?.status || ""),
          ),
        ).length;

        const start30 = startNDaysAgo(30);
        const startMonth = startOfMonth();
        const monthStartMs = startMonth.getTime();
        const dayKeys: string[] = [];
        const dayLabels: Record<string, string> = {};
        const ordersCount: Record<string, number> = {};
        const revenueSum: Record<string, number> = {};

        for (let i = 0; i < 30; i++) {
          const d = new Date(start30.getTime());
          d.setDate(start30.getDate() + i);
          const key = keyOfDate(d);
          dayKeys.push(key);
          dayLabels[key] = labelOfDate(d);
          ordersCount[key] = 0;
          revenueSum[key] = 0;
        }

        let mtdRevenue = 0;
        let mtdOrders = 0;
        ordersSnap.docs.forEach((doc) => {
          const data = doc.data() as any;
          const createdAtMs = Number(data.createdAt || 0);
          const subtotal = Number(data.subtotal || 0);
          if (!createdAtMs) return;

          const key = keyOfDate(new Date(createdAtMs));
          if (key in ordersCount) {
            ordersCount[key] += 1;
            revenueSum[key] += subtotal;
          }
          if (createdAtMs >= monthStartMs) {
            mtdOrders += 1;
            mtdRevenue += subtotal;
          }
        });

        return res.status(200).json({
          ok: true,
          overview: {
            productsInReview,
            activeSellers,
            openTickets,
            mtdOrders,
            mtdRevenue,
            ordersSeries: dayKeys.map((key) => ({
              day: dayLabels[key],
              orders: ordersCount[key] || 0,
            })),
            revenueSeries: dayKeys.map((key) => ({
              day: dayLabels[key],
              revenue: Number((revenueSum[key] || 0).toFixed(2)),
            })),
          },
        });
      }

      // -------------------- MERCHANTS --------------------
      case "merchants.list": {
        // optional search "q"
        const q = String((req.query.q ?? body.q ?? "") as string).toLowerCase().trim();
        // fetch up to 500 and filter in-memory to avoid composite index churn
        const snap = await adminDb.collection("merchants").limit(500).get();
        const items = snap.docs.map((d) => ({ uid: d.id, ...(d.data() as any) }));
        const filtered = q
          ? items.filter((m) =>
              `${m.name ?? ""} ${m.email ?? ""} ${m.storeName ?? ""}`.toLowerCase().includes(q)
            )
          : items;
        // normalize boolean enabled (default true)
        filtered.forEach((m) => {
          if (typeof m.enabled !== "boolean") m.enabled = true;
        });
        return res.status(200).json({ ok: true, items: filtered });
      }

      case "merchants.update": {
        const { uid, patch } = body as { uid: string; patch: Record<string, any> };
        if (!uid || !patch) return res.status(400).json({ ok: false, error: "uid & patch required" });
        await adminDb.collection("merchants").doc(uid).set(
          {
            ...patch,
            updatedAt: Date.now(),
          },
          { merge: true },
        );
        return res.status(200).json({ ok: true });
      }

      case "orders.list": {
        const limit = Math.min(Number(req.query.limit ?? body.limit ?? 500), 1000);
        const snap = await adminDb
          .collection("orders")
          .orderBy("createdAt", "desc")
          .limit(limit)
          .get();
        const items = snap.docs.map((doc) => ({
          id: doc.id,
          ...(doc.data() as any),
        }));
        return res.status(200).json({ ok: true, items });
      }

      // -------------------- PRODUCT QUEUE --------------------
      // We assume sellers write docs in `merchantProducts` at create-time (see patch for create.ts below).
      case "queue.list": {
        const status = String((req.query.status ?? body.status ?? "pending") as string);
        const limit = Number(req.query.limit ?? body.limit ?? 200);
        let ref = adminDb.collection("merchantProducts") as FirebaseFirestore.Query;

        if (status && status !== "all") ref = ref.where("status", "==", status);
        // order by createdAt desc when available
        ref = ref.limit(limit);

        const snap = await ref.get();
        let items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

        // best-effort local sort if missing index
        items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

        // enrich with merchant profile (name/email)
        const merchantIds = Array.from(new Set(items.map((i) => i.merchantId).filter(Boolean)));
        const merchantMap = new Map<string, any>();
        await Promise.all(
          merchantIds.map(async (mid) => {
            const m = await adminDb.collection("merchants").doc(mid).get();
            if (m.exists) merchantMap.set(mid, m.data());
          })
        );
        const enriched = items.map((i) => ({
          ...i,
          changeSummary: changeSummaryForQueueItem(i),
          merchant: merchantMap.get(i.merchantId) || null,
        }));

        return res.status(200).json({ ok: true, items: enriched });
      }

      case "queue.approve": {
        const { id, note, collections } = body as {
          id: string;
          note?: string;
          collections?: string[];
        };
        if (!id) return res.status(400).json({ ok: false, error: "id required" });
        const approvalCollections = Array.isArray(collections)
          ? collections
              .map((collection) => String(collection || "").trim())
              .filter(Boolean)
          : [];
        if (!approvalCollections.length) {
          return res.status(400).json({
            ok: false,
            error: "Select at least one store collection before approving.",
          });
        }

        const ref = adminDb.collection("merchantProducts").doc(id);
        let alreadyApproved = false;
        let queueItemMissing = false;
        let qdoc: any = null;
        await adminDb.runTransaction(async (tx: any) => {
          const snap = await tx.get(ref);
          if (!snap.exists) {
            queueItemMissing = true;
            return;
          }
          const fresh = snap.data() as any;
          if (fresh.status === "approved" && fresh.shopifyProductId) {
            alreadyApproved = true;
            qdoc = fresh;
            return;
          }
          const approvalStartedAt = Number(fresh.approvalStartedAt || 0);
          const approvalIsFresh =
            fresh.approvalState === "processing" &&
            Date.now() - approvalStartedAt < 2 * 60 * 1000;
          if (approvalIsFresh) {
            throw new Error("Approval is already processing. Please refresh in a moment.");
          }
          tx.set(
            ref,
            {
              approvalState: "processing",
              approvalStartedAt: Date.now(),
              reviewerUid: me.uid,
              updatedAt: Date.now(),
            },
            { merge: true },
          );
          qdoc = fresh;
        });
        if (alreadyApproved) {
          return res.status(200).json({
            ok: true,
            alreadyApproved: true,
            warnings: [],
          });
        }
        if (queueItemMissing || !qdoc) {
          return res.status(404).json({ ok: false, error: "queue item not found" });
        }
        const rawPendingUpdates =
          qdoc.pendingUpdates && typeof qdoc.pendingUpdates === "object"
            ? qdoc.pendingUpdates
            : {};
        const pendingUpdates: Record<string, any> = { ...rawPendingUpdates };
        const meaningfulMediaUpdates = meaningfulVariantMediaUpdates(
          pendingUpdates.variantMediaUpdates,
        );
        if (meaningfulMediaUpdates.length) {
          pendingUpdates.variantMediaUpdates = meaningfulMediaUpdates;
        } else {
          delete pendingUpdates.variantMediaUpdates;
        }
        if (
          pendingUpdates.measurements !== undefined &&
          JSON.stringify(comparableMeasurements(pendingUpdates.measurements)) ===
            JSON.stringify(comparableMeasurements(qdoc.measurements))
        ) {
          delete pendingUpdates.measurements;
        }
        const approvalUpdates: Record<string, any> = {
          ...pendingUpdates,
          collections: approvalCollections,
        };
        const approvedMeasurements =
          approvalUpdates.measurements !== undefined
            ? approvalUpdates.measurements
            : qdoc.measurements;
        const approvedVariantMeasurements = mergeVariantMeasurementRecords(
          qdoc.variantMeasurements || qdoc.variantDraft?.variants || [],
          approvalUpdates.variantMeasurements ||
            approvalUpdates.variantDraft?.variants ||
            [],
        );

        let shopifyResult: any;
        try {
          shopifyResult = await applyApprovedChangesToShopify(
            qdoc,
            approvalUpdates,
          );
        } catch (error: any) {
          const approvalError = String(
            error?.message || error || "Unable to approve this product update.",
          );
          await ref.set(
            {
              approvalState: null,
              approvalStartedAt: null,
              approvalError,
              updatedAt: Date.now(),
            },
            { merge: true },
          );
          return res.status(400).json({ ok: false, error: approvalError });
        }
        const warnings = [...(shopifyResult.warnings || [])];
        const effectiveVariantMeasurements =
          shopifyResult.variantMeasurements || approvedVariantMeasurements;
        try {
          await syncMeasurementsToShopify(
            shopifyResult.productId,
            approvedMeasurements,
          );
        } catch (error: any) {
          warnings.push(
            `Product approved, but product measurement sync failed: ${String(error?.message || error)}`,
          );
        }
        let variantSizingSync = { variants: 0, metafields: 0 };
        try {
          variantSizingSync = await syncVariantMeasurementsToShopify(
            effectiveVariantMeasurements || [],
          );
        } catch (error: any) {
          warnings.push(
            `Product approved, but Shopify variant sizing sync failed: ${String(error?.message || error)}`,
          );
        }

        await ref.set(
          {
            ...approvalUpdates,
            status: "approved",
            published: shopifyResult.shopifyStatus !== "DRAFT",
            shopifyStatus: shopifyResult.shopifyStatus || "DRAFT",
            shopifyDeletedAt: null,
            shopifyProductId: shopifyResult.productId,
            shopifyProductNumericId:
              shopifyResult.productId.split("/").pop() ||
              qdoc.shopifyProductNumericId ||
              null,
            collections: shopifyResult.collections,
            collectionsSynced: shopifyResult.collections.length > 0,
            ...(Array.isArray(shopifyResult.imageUrls)
              ? {
                  image: shopifyResult.imageUrls[0] || null,
                  images: shopifyResult.imageUrls,
                  imageUrls: shopifyResult.imageUrls,
                }
              : {}),
            ...(shopifyResult.variantDraft
              ? { variantDraft: shopifyResult.variantDraft }
              : {}),
            ...(Array.isArray(shopifyResult.shopifyVariantIds)
              ? { shopifyVariantIds: shopifyResult.shopifyVariantIds }
              : {}),
            ...(Array.isArray(shopifyResult.shopifyVariantNumericIds)
              ? {
                  shopifyVariantNumericIds:
                    shopifyResult.shopifyVariantNumericIds,
                }
              : {}),
            variantSizingSync: {
              ...variantSizingSync,
              verifiedAt: Date.now(),
            },
            variantMediaSync: {
              ...shopifyResult.variantMediaSync,
              verifiedAt: Date.now(),
            },
            variantMediaUpdates: null,
            variantMeasurements: effectiveVariantMeasurements,
            inventoryItemId:
              shopifyResult.inventoryItemId || qdoc.inventoryItemId || null,
            pendingUpdates: null,
            changeSummary: null,
            preReviewStatus: null,
            removedRecoveryReview: null,
            approvalState: null,
            approvalStartedAt: null,
            approvalError: null,
            reviewerUid: me.uid,
            reviewNote: note || null,
            reviewedAt: Date.now(),
            updatedAt: Date.now(),
          },
          { merge: true }
        );

        const merchantId = String(qdoc.merchantId || "").trim();
        const approvedSku = normSku(approvalUpdates.sku);
        const previousSku = normSku(qdoc.sku);
        if (merchantId && approvedSku && approvedSku !== previousSku) {
          try {
            await adminDb
              .collection("skuClaims")
              .doc(skuClaimId(merchantId, approvedSku))
              .set(
                {
                  merchantId,
                  productDocId: id,
                  updatedAt: Date.now(),
                },
                { merge: true },
              );
            if (previousSku) {
              await adminDb
                .collection("skuClaims")
                .doc(skuClaimId(merchantId, previousSku))
                .delete()
                .catch(() => {});
            }
          } catch (error: any) {
            warnings.push(
              `Product approved, but SKU claim refresh failed: ${String(error?.message || error)}`,
            );
          }
        }

        const shopifyProductNumericId =
          shopifyResult.productId.split("/").pop() || null;
        if (shopifyProductNumericId) {
          await adminDb
            .collection("shopifyProductOwners")
            .doc(shopifyProductNumericId)
            .set(
              {
                shopifyProductNumericId,
                shopifyProductId: shopifyResult.productId,
                merchantId: qdoc.merchantId || null,
                merchantProductDocId: id,
                createdAt: qdoc.createdAt || Date.now(),
                updatedAt: Date.now(),
              },
              { merge: true },
            );
        }

        if (qdoc.merchantProductDocId) {
          await adminDb.collection("merchantProducts").doc(qdoc.merchantProductDocId).set(
            {
              status: "approved",
              published: shopifyResult.shopifyStatus !== "DRAFT",
              shopifyStatus: shopifyResult.shopifyStatus || "DRAFT",
              updatedAt: Date.now(),
            },
            { merge: true }
          );
        }

        return res.status(200).json({
          ok: true,
          warnings,
          variantMediaSync: shopifyResult.variantMediaSync || null,
        });
      }

      case "queue.reject": {
        const { id, reason } = body as { id: string; reason?: string };
        if (!id) return res.status(400).json({ ok: false, error: "id required" });

        const ref = adminDb.collection("merchantProducts").doc(id);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ ok: false, error: "queue item not found" });

        const qdoc = snap.data() as any;
        const isUpdateReview = qdoc.status === "update_in_review";
        const isRemovedRecoveryReview =
          isUpdateReview && qdoc.removedRecoveryReview === true;
        await ref.set(
          {
            status: isRemovedRecoveryReview
              ? "rejected"
              : isUpdateReview
                ? qdoc.preReviewStatus || "approved"
                : "rejected",
            ...(isUpdateReview
              ? {
                  pendingUpdates: null,
                  changeSummary: null,
                  preReviewStatus: null,
                  removedRecoveryReview: null,
                }
              : {}),
            reviewerUid: me.uid,
            reviewNote: reason || null,
            reviewedAt: Date.now(),
            updatedAt: Date.now(),
          },
          { merge: true }
        );

        return res.status(200).json({ ok: true });
      }

      // -------------------- SUPPORT CENTER (optional, nice to have here too) --------------------
      case "support.list": {
        const status = String((req.query.status ?? body.status ?? "all") as string);
        let ref = adminDb.collection("supportRequests") as FirebaseFirestore.Query;
        if (status !== "all") ref = ref.where("status", "==", status);
        const snap = await ref.orderBy("createdAt", "desc").limit(200).get();
        const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        return res.status(200).json({ ok: true, items });
      }

      case "support.reply": {
        const { id, message, nextStatus } = body as { id: string; message: string; nextStatus?: string };
        if (!id || !message) return res.status(400).json({ ok: false, error: "id & message required" });

        await adminDb.collection("supportRequests").doc(id).set(
          {
            adminReply: message,
            status: nextStatus || "under_processing",
            repliedAt: Date.now(),
            repliedBy: me.uid,
            updatedAt: Date.now(),
          },
          { merge: true }
        );
        return res.status(200).json({ ok: true });
      }
      
      
      // inside switch(action) { ... }

case "orders.assignPickup": {
  // body: { orderId, pickupWindow, pickupAddress, notes, deliveryPartner }
  const body = req.body || {};
  const orderId = String(body.orderId || "").trim();
  if (!orderId) return res.status(400).json({ ok: false, error: "orderId is required" });

  const pickupWindow = body.pickupWindow ?? null;
  const pickupAddress = body.pickupAddress ?? null;
  const notes = body.notes ?? null;

  const dp = body.deliveryPartner || {};
  const deliveryPartner = {
    name: dp.name ?? null,
    phone: dp.phone ?? null,
    etaText: dp.etaText ?? null,
    trackingUrl: dp.trackingUrl ?? null,
  };

  const orderRef = adminDb.collection("orders").doc(orderId);
  const now = Date.now();

  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) {
      const err: any = new Error("Order not found");
      err.statusCode = 404;
      throw err;
    }

    const order = snap.data() as any;
    const st = order?.workflowStatus || "vendor_pending";

    // planning only after vendor accepted (or admin overdue)
    if (!(st === "vendor_accepted" || st === "admin_overdue")) {
      const err: any = new Error("Order is not ready for pickup assignment");
      err.statusCode = 400;
      err.currentStatus = st;
      throw err;
    }

    // idempotent
    if (st === "pickup_assigned" || st === "dispatched") return;

    tx.set(
      orderRef,
      {
        workflowStatus: "pickup_assigned",
        adminPlannedAt: now,
        pickupPlan: { pickupWindow, pickupAddress, notes },
        deliveryPartner,
        updatedAt: now,
      },
      { merge: true }
    );
  });

  return res.status(200).json({ ok: true, assignedAt: now });
}

      case "products.repairPricing": {
        const snap = await adminDb.collection("merchantProducts").limit(1000).get();
        const products = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) }))
          .filter((p) => {
            const raw = String(p.shopifyProductId || p.shopifyProductNumericId || "").trim();
            return Boolean(raw);
          });

        let repaired = 0;
        let skipped = 0;
        const repairErrors: string[] = [];

        for (const product of products) {
          const rawId = String(product.shopifyProductId || product.shopifyProductNumericId || "").trim();
          const shopifyProductId = rawId.startsWith("gid://shopify/Product/")
            ? rawId
            : `gid://shopify/Product/${rawId}`;
          try {
            const result = await shopifyGraphQL(PRODUCT_VARIANTS_FOR_REPAIR, { id: shopifyProductId });
            const variants = result?.data?.product?.variants?.nodes || [];
            if (!variants.length) { skipped++; continue; }

            const variantInputs = variants.map((v: any) => ({
              id: v.id,
              taxable: true,
              price: v.price,
              ...(v.compareAtPrice != null ? { compareAtPrice: v.compareAtPrice } : {}),
              inventoryItem: {
                tracked: v.inventoryItem?.tracked ?? true,
                ...(v.inventoryItem?.unitCost?.amount != null ? { cost: String(v.inventoryItem.unitCost.amount) } : {}),
              },
            }));

            const updateResult = await shopifyGraphQL(VARIANTS_BULK_UPDATE, {
              productId: shopifyProductId,
              variants: variantInputs,
            });
            const updateErrors = updateResult?.data?.productVariantsBulkUpdate?.userErrors || [];
            if (updateErrors.length) {
              repairErrors.push(`${product.title || product.id}: ${updateErrors.map((e: any) => e.message).join("; ")}`);
            } else {
              repaired++;
            }
          } catch (err: any) {
            repairErrors.push(`${product.title || product.id}: ${err?.message || err}`);
          }
        }

        return res.status(200).json({
          ok: true,
          total: products.length,
          repaired,
          skipped,
          errors: repairErrors.length ? repairErrors : undefined,
        });
      }

      default:
        return res.status(400).json({ ok: false, error: `Unknown action: ${action}` });
    }
  } catch (e: any) {
    console.error("admin gateway error:", e?.message || e);
    return res.status(500).json({ ok: false, error: e?.message || "server error" });
  }
}
