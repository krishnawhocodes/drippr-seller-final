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
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function valuesEqual(left: any, right: any) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
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

/* ---------------- Shopify GQL ---------------- */

// NOTE: removed variant.weight & variant.weightUnit (they caused 500)
const PRODUCT_DETAILS_QUERY = /* GraphQL */ `
  query product($id: ID!) {
    product(id: $id) {
      id
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
): Promise<{ idsByUrl: Record<string, string>; urls: string[] }> {
  const r = await shopifyGraphQL(PRODUCT_IMAGES_QUERY, { id: productId });
  const nodes = r?.data?.product?.images?.nodes || [];
  const urls: string[] = [];
  const idsByUrl: Record<string, string> = {};
  for (const n of nodes) {
    if (n?.url && n?.id) {
      urls.push(String(n.url));
      idsByUrl[String(n.url)] = String(n.id);
    }
  }
  return { idsByUrl, urls };
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

        const { idsByUrl } = await listImageUrls(shopifyProductId);

        for (const u of urlsToDelete) {
          const imgId = idsByUrl[u];
          if (!imgId) continue;
          try {
            const del = await shopifyGraphQL(PRODUCT_IMAGE_DELETE, {
              id: imgId,
            });
            const errs = del?.data?.productImageDelete?.userErrors || [];
            if (errs.length) console.warn("productImageDelete errors:", errs);
          } catch (e) {
            console.warn("productImageDelete failed:", e);
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

        if (doc.shopifyProductId) {
          try {
            const r = await shopifyGraphQL(PRODUCT_DETAILS_QUERY, {
              id: doc.shopifyProductId,
            });
            const p = r?.data?.product;

            if (p) {
              liveProduct = p;
              const mediaUrlsByVariant = new Map<string, string[]>();
              for (const image of p.images?.nodes || []) {
                const imageUrl = String(image?.url || "").trim();
                if (!imageUrl) continue;
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

              imagesLive = (p.images?.nodes || [])
                .map((n: any) => String(n.url))
                .filter(Boolean);
            }
          } catch (err: any) {
            console.error(
              "[details:product]",
              err?.response?.errors || err?.message || err,
            );
            return res.status(500).json({
              ok: false,
              code: "details/exception",
              error: `[details:product] ${JSON.stringify(err?.response || err)}`,
            });
          }
        }

        const fallbackImages = [
          ...(Array.isArray(doc.images) ? doc.images : []),
          ...(Array.isArray(doc.imageUrls) ? doc.imageUrls : []),
          doc.image,
        ]
          .map((url: unknown) => String(url || "").trim())
          .filter(Boolean);
        imagesLive = [...new Set([...imagesLive, ...fallbackImages])];

        const firstVariant = variants[0] || {};

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
            seo: liveProduct?.seo || doc.seo || null,
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
      if (shopifyProductId) {
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

      if (quickPrice != null && !Number.isNaN(quickPrice))
        updates.price = quickPrice;

      if (quickQty != null && !Number.isNaN(quickQty)) {
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

      if (Object.keys(changedForReview).length) {
        adminNeedsReview = true;
        const mergedPendingUpdates = {
          ...(doc.pendingUpdates || {}),
          ...changedForReview,
        };
        const instantApplied = [
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
      }

      await ref.set(updates, { merge: true });

      const live =
        quickPrice != null ||
        quickQty != null ||
        (quickVariants && quickVariants.length > 0);
      return res.status(200).json({
        ok: true,
        review: adminNeedsReview,
        note: adminNeedsReview
          ? `Price/stock updated live where possible.${live ? " Other changes queued for admin review." : ""}`
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
