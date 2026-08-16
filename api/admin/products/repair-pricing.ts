// api/admin/products/repair-pricing.ts
// Repairs existing products created via seller panel that are missing
// the Price section (Compare-at, Unit price, Charge tax, Cost per item)
// in Shopify admin. Sets taxable: true on every variant and re-saves
// pricing fields to force Shopify to surface the pricing UI.

import { getAdmin } from "../../_lib/firebaseAdmin.js";
import { shopifyGraphQL } from "../../_lib/shopify.js";

const PRODUCT_VARIANTS_QUERY = /* GraphQL */ `
  query productVariantsForRepair($id: ID!) {
    product(id: $id) {
      id
      status
      variants(first: 100) {
        nodes {
          id
          price
          compareAtPrice
          taxable
          inventoryItem {
            id
            cost
            tracked
          }
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

function normalizeShopifyGid(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (raw.startsWith("gid://shopify/Product/")) return raw;
  return /^\d+$/.test(raw) ? `gid://shopify/Product/${raw}` : null;
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { adminAuth, adminDb } = getAdmin();

    const authHeader = String(req.headers.authorization || "");
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) {
      return res
        .status(401)
        .json({ ok: false, error: "Missing Authorization" });
    }

    const decoded = await adminAuth.verifyIdToken(token);
    const adminUids = (process.env.ADMIN_UIDS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (!adminUids.includes(decoded.uid)) {
      return res.status(403).json({ ok: false, error: "Admins only" });
    }

    // Fetch all products that have a Shopify product ID
    const snap = await adminDb
      .collection("merchantProducts")
      .limit(1000)
      .get();

    const products = snap.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() as any) }))
      .filter((p) => {
        const gid = normalizeShopifyGid(
          p.shopifyProductId || p.shopifyProductNumericId,
        );
        return Boolean(gid);
      });

    let repaired = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const product of products) {
      const shopifyProductId = normalizeShopifyGid(
        product.shopifyProductId || product.shopifyProductNumericId,
      );
      if (!shopifyProductId) {
        skipped++;
        continue;
      }

      try {
        const result = await shopifyGraphQL(PRODUCT_VARIANTS_QUERY, {
          id: shopifyProductId,
        });

        const shopifyProduct = result?.data?.product;
        if (!shopifyProduct) {
          skipped++;
          continue;
        }

        const variants = shopifyProduct.variants?.nodes || [];
        if (!variants.length) {
          skipped++;
          continue;
        }

        // Re-save each variant with taxable: true and re-assert its price.
        // Re-setting the price (even to the same value) forces Shopify
        // to regenerate the pricing section in admin.
        const variantInputs = variants.map((v: any) => ({
          id: v.id,
          taxable: true,
          price: v.price,
          ...(v.compareAtPrice != null
            ? { compareAtPrice: v.compareAtPrice }
            : {}),
          inventoryItem: {
            tracked: v.inventoryItem?.tracked ?? true,
            ...(v.inventoryItem?.cost != null
              ? { cost: String(v.inventoryItem.cost) }
              : {}),
          },
        }));

        const updateResult = await shopifyGraphQL(VARIANTS_BULK_UPDATE, {
          productId: shopifyProductId,
          variants: variantInputs,
        });

        const updateErrors =
          updateResult?.data?.productVariantsBulkUpdate?.userErrors || [];
        if (updateErrors.length) {
          errors.push(
            `${product.title || product.id}: ${updateErrors.map((e: any) => e.message).join("; ")}`,
          );
        } else {
          repaired++;
        }
      } catch (err: any) {
        errors.push(
          `${product.title || product.id}: ${err?.message || err}`,
        );
      }
    }

    return res.status(200).json({
      ok: true,
      total: products.length,
      repaired,
      skipped,
      errors: errors.length ? errors : undefined,
    });
  } catch (error: any) {
    console.error("repair pricing error:", error?.message || error);
    return res.status(500).json({
      ok: false,
      error: error?.message || "Internal error",
    });
  }
}
