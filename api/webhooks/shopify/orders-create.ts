// api/webhooks/shopify/orders-create.ts
import crypto from "node:crypto";
import { getAdmin } from "../../_lib/firebaseAdmin.js";
import { FieldValue } from "firebase-admin/firestore";

export const config = {
  api: { bodyParser: false },
};

async function readRawBody(req: any): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function chunk<T>(arr: T[], size: number) {
  return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  );
}

function toNumber(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function safeVerifyShopifyHmac(rawBody: Buffer, secret: string, hmacHeader: string) {
  if (!secret) return false;
  if (!hmacHeader) return false;

  const computed = crypto.createHmac("sha256", secret).update(rawBody).digest(); // Buffer
  let headerBuf: Buffer;
  try {
    headerBuf = Buffer.from(String(hmacHeader), "base64");
  } catch {
    return false;
  }

  if (headerBuf.length !== computed.length) return false;
  return crypto.timingSafeEqual(computed, headerBuf);
}

type OwnerMapDoc = {
  merchantId?: string;
  merchantProductDocId?: string;
  shopifyProductId?: string;
  shopifyProductNumericId?: string;
  createdAt?: number;
  updatedAt?: number;
};

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  const secret = process.env.SHOPIFY_WEBHOOK_SECRET || "";
  if (!secret) return res.status(500).send("Webhook secret not configured");

  try {
    const rawBody = await readRawBody(req);

    const hmacHeader = String(req.headers["x-shopify-hmac-sha256"] || "");
    const topic = String(req.headers["x-shopify-topic"] || "");
    const webhookId = String(req.headers["x-shopify-webhook-id"] || "");

    const ok = safeVerifyShopifyHmac(rawBody, secret, hmacHeader);
    if (!ok) return res.status(401).send("HMAC mismatch");
    if (topic !== "orders/create") return res.status(200).send("Ignored topic");

    const payload = JSON.parse(rawBody.toString("utf8"));
    const shopifyOrderId = String(payload.id || "");
    if (!shopifyOrderId) return res.status(400).send("Missing order id");

    const orderNumber = payload.name || payload.order_number || shopifyOrderId;
    const createdAt = payload.created_at ? new Date(payload.created_at).getTime() : Date.now();
    const currency =
      payload.currency || payload.total_price_set?.shop_money?.currency_code || "INR";
    const financialStatus = payload.financial_status || "pending";
    const lineItems = Array.isArray(payload.line_items) ? payload.line_items : [];

    const customerEmail =
      payload.customer?.email ||
      payload.email ||
      payload.contact_email ||
      payload.customer_email ||
      null;

    const { adminDb } = getAdmin();

    // --- PRIMARY KEY: product_id ---
    const productNums: string[] = lineItems
      .map((li: any) => (li?.product_id != null ? String(li.product_id) : ""))
      .filter(Boolean);

    // fallbacks
    const variantNums: string[] = lineItems
      .map((li: any) => (li?.variant_id != null ? String(li.variant_id) : ""))
      .filter(Boolean);

    const skus: string[] = lineItems
      .map((li: any) => String(li?.sku || "").trim())
      .filter(Boolean);

    // 1) Fast mapping collection: shopifyProductOwners/{productId}
    const productOwnerByNum = new Map<string, OwnerMapDoc>();
    for (const part of chunk([...new Set(productNums)], 100)) {
      if (!part.length) continue;
      const refs = part.map((p) => adminDb.collection("shopifyProductOwners").doc(p));
      const snaps = await (adminDb as any).getAll(...refs);
      for (const s of snaps) {
        if (!s.exists) continue;
        productOwnerByNum.set(String(s.id), (s.data() || {}) as OwnerMapDoc);
      }
    }

    // 2) Fallback: merchantProducts by product numeric id (legacy-safe)
    const productNumToProduct = new Map<string, any>();
    const missingProductNums = [...new Set(productNums)].filter((p) => !productOwnerByNum.has(p));

    for (const part of chunk(missingProductNums, 10)) {
      if (!part.length) continue;

      const snapNum = await adminDb
        .collection("merchantProducts")
        .where("shopifyProductNumericId", "in", part)
        .get();

      snapNum.forEach((doc: any) => {
        const pnum = String(doc.get("shopifyProductNumericId") || "");
        if (!pnum) return;
        productNumToProduct.set(pnum, { id: doc.id, ...(doc.data() as any) });
      });

      // extra fallback for very old docs that only have gid
      const gids = part.map((p) => `gid://shopify/Product/${p}`);
      const snapGid = await adminDb
        .collection("merchantProducts")
        .where("shopifyProductId", "in", gids)
        .get();

      snapGid.forEach((doc: any) => {
        const gid = String(doc.get("shopifyProductId") || "");
        const pnum = gid.split("/").pop();
        if (!pnum) return;
        productNumToProduct.set(pnum, { id: doc.id, ...(doc.data() as any) });
      });
    }

    // 3) Variant numeric fallback (only works if stored)
    const variantNumToProduct = new Map<string, any>();
    for (const part of chunk([...new Set(variantNums)], 10)) {
      if (!part.length) continue;

      const snap = await adminDb
        .collection("merchantProducts")
        .where("shopifyVariantNumericIds", "array-contains-any", part)
        .get();

      snap.forEach((doc: any) => {
        const ids =
          ((doc.get("shopifyVariantNumericIds") as (string | number)[] | undefined) ?? []) as (
            | string
            | number
          )[];

        const data = { id: doc.id, ...(doc.data() as any) };
        for (const n of ids) variantNumToProduct.set(String(n), data);
      });
    }

    // 4) SKU fallback (least reliable; kept for backward compatibility)
    const skuToProduct = new Map<string, any>();
    for (const part of chunk([...new Set(skus)], 10)) {
      if (!part.length) continue;
      const snap = await adminDb.collection("merchantProducts").where("sku", "in", part).get();
      snap.forEach((doc: any) => {
        skuToProduct.set(String(doc.get("sku")), { id: doc.id, ...(doc.data() as any) });
      });
    }

    // Group line items by merchant
    const byMerchant = new Map<string, { items: any[]; subtotal: number }>();

    // backfill mapping if we discovered owner via fallback
    const ownerUpserts = new Map<string, OwnerMapDoc>();

    for (const li of lineItems) {
      const sku = String(li?.sku || "").trim();
      const variantNum = li?.variant_id != null ? String(li.variant_id) : "";
      const productNum = li?.product_id != null ? String(li.product_id) : "";

      let merchantId = "";
      let merchantProductDocId: string | null = null;
      let matchedBy: "ownerMap" | "productNumeric" | "variantId" | "sku" | "unknown" = "unknown";

      // A) product_id -> owner map (BEST)
      if (productNum) {
        const owner = productOwnerByNum.get(productNum);
        if (owner?.merchantId) {
          merchantId = String(owner.merchantId);
          merchantProductDocId = owner.merchantProductDocId ? String(owner.merchantProductDocId) : null;
          matchedBy = "ownerMap";
        }
      }

      // B) product_id -> merchantProducts (fallback)
      if (!merchantId && productNum) {
        const mp = productNumToProduct.get(productNum);
        if (mp?.merchantId) {
          merchantId = String(mp.merchantId);
          merchantProductDocId = mp?.id ? String(mp.id) : null;
          matchedBy = "productNumeric";

          ownerUpserts.set(productNum, {
            merchantId,
            merchantProductDocId: merchantProductDocId || undefined,
            shopifyProductId: mp.shopifyProductId ? String(mp.shopifyProductId) : undefined,
            shopifyProductNumericId: productNum,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
        }
      }

      // C) variant_id fallback
      if (!merchantId && variantNum) {
        const mp = variantNumToProduct.get(variantNum);
        if (mp?.merchantId) {
          merchantId = String(mp.merchantId);
          merchantProductDocId = mp?.id ? String(mp.id) : null;
          matchedBy = "variantId";

          const mpProductNum = mp.shopifyProductNumericId
            ? String(mp.shopifyProductNumericId)
            : mp.shopifyProductId
            ? String(mp.shopifyProductId).split("/").pop()
            : "";
          if (mpProductNum) {
            ownerUpserts.set(mpProductNum, {
              merchantId,
              merchantProductDocId: merchantProductDocId || undefined,
              shopifyProductId: mp.shopifyProductId ? String(mp.shopifyProductId) : undefined,
              shopifyProductNumericId: mpProductNum,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            });
          }
        }
      }

      // D) sku fallback
      if (!merchantId && sku) {
        const mp = skuToProduct.get(sku);
        if (mp?.merchantId) {
          merchantId = String(mp.merchantId);
          merchantProductDocId = mp?.id ? String(mp.id) : null;
          matchedBy = "sku";

          const mpProductNum = mp.shopifyProductNumericId
            ? String(mp.shopifyProductNumericId)
            : mp.shopifyProductId
            ? String(mp.shopifyProductId).split("/").pop()
            : "";
          if (mpProductNum) {
            ownerUpserts.set(mpProductNum, {
              merchantId,
              merchantProductDocId: merchantProductDocId || undefined,
              shopifyProductId: mp.shopifyProductId ? String(mp.shopifyProductId) : undefined,
              shopifyProductNumericId: mpProductNum,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            });
          }
        }
      }

      if (!merchantId) continue;

      const qty = toNumber(li?.quantity, 0);
      const unitPrice =
        li?.price != null ? toNumber(li.price, 0) : toNumber(li?.price_set?.shop_money?.amount, 0);
      const lineTotal = unitPrice * qty;

      const bucket = byMerchant.get(merchantId) || { items: [], subtotal: 0 };
      bucket.items.push({
        line_item_id: li?.id ?? null,
        title: li?.title || "",
        sku: sku || (variantNum ? `v:${variantNum}` : ""),
        quantity: qty,
        price: unitPrice,
        total: Number(lineTotal.toFixed(2)),
        variant_id: variantNum || null,
        product_id: productNum || null,

        // debugging trace
        merchantProductDocId,
        matchedBy,
      });

      bucket.subtotal += lineTotal;
      byMerchant.set(merchantId, bucket);
    }

    // Idempotency
    const eventId = webhookId || `order_${shopifyOrderId}`;
    const eventRef = adminDb.collection("webhookEvents").doc(eventId);

    const THREE_HOURS = 3 * 60 * 60 * 1000;
    let alreadyProcessed = false;

    await adminDb.runTransaction(async (tx: any) => {
      const evSnap = await tx.get(eventRef);
      if (evSnap.exists) {
        alreadyProcessed = true;
        return;
      }

      tx.set(eventRef, {
        topic,
        shopifyOrderId,
        receivedAt: Date.now(),
        merchantsCount: byMerchant.size,
      });

      if (byMerchant.size === 0) {
        tx.set(eventRef, { note: "no matching marketplace items" }, { merge: true });
        return;
      }

      // Backfill/ensure mapping docs
      for (const [productNum, owner] of ownerUpserts.entries()) {
        if (!productNum || !owner?.merchantId) continue;
        const ownerRef = adminDb.collection("shopifyProductOwners").doc(productNum);
        tx.set(
          ownerRef,
          {
            shopifyProductNumericId: productNum,
            merchantId: String(owner.merchantId),
            merchantProductDocId: owner.merchantProductDocId ? String(owner.merchantProductDocId) : null,
            shopifyProductId: owner.shopifyProductId ? String(owner.shopifyProductId) : null,
            createdAt: owner.createdAt || Date.now(),
            updatedAt: Date.now(),
          },
          { merge: true }
        );
      }

      for (const [merchantId, group] of byMerchant.entries()) {
        const orderDocId = `${shopifyOrderId}_${merchantId}`;
        const orderRef = adminDb.collection("orders").doc(orderDocId);

        tx.set(orderRef, {
          shopifyOrderId,
          orderNumber,
          merchantId,
          createdAt,
          updatedAt: Date.now(),
          currency,
          financialStatus,
          lineItems: group.items,
          subtotal: Number(group.subtotal.toFixed(2)),
          status: "open",
          customerEmail,

          raw: payload.customer
            ? { customer: { id: payload.customer.id, email: payload.customer.email } }
            : {},

          workflowStatus: "vendor_pending",
          vendorAcceptBy: createdAt + THREE_HOURS,
          vendorAcceptedAt: null,
          adminPlanBy: null,
          adminPlannedAt: null,
          pickupPlan: null,
          deliveryPartner: null,
          dispatchedAt: null,
          invoice: { status: "none" },

          workflowTimeline: [
            { at: Date.now(), type: "vendor_pending", note: "Order received; awaiting vendor acceptance" },
          ],
        });

        const statsRef = adminDb.collection("merchantStats").doc(merchantId);
        tx.set(
          statsRef,
          {
            merchantId,
            ordersCount: FieldValue.increment(1),
            revenue: FieldValue.increment(Number(group.subtotal.toFixed(2))),
            updatedAt: Date.now(),
          },
          { merge: true }
        );
      }
    });

    if (alreadyProcessed) return res.status(200).send("Already processed");
    return res.status(200).send("ok");
  } catch (err: any) {
    console.error("orders-create webhook error:", err?.message || err);
    return res.status(500).send("server error");
  }
}
