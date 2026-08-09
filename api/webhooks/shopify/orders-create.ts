// api/webhooks/shopify/orders-create.ts
import crypto from "node:crypto";
import { getAdmin } from "../../_lib/firebaseAdmin.js";
import { FieldValue } from "firebase-admin/firestore";

export const config = {
  api: { bodyParser: false },
};

/**
 * Robust body reader for Vercel serverless functions.
 * Vercel may pre-populate req.body even when bodyParser is disabled,
 * or the async-iterable approach may silently yield nothing.
 * We try multiple strategies in order.
 */
async function readRawBody(req: any): Promise<Buffer> {
  // Strategy 0: Vercel may expose rawBody even with bodyParser off
  if (req.rawBody) {
    if (Buffer.isBuffer(req.rawBody)) {
      console.log("[readRawBody] Using req.rawBody (Buffer, len=" + req.rawBody.length + ")");
      return req.rawBody;
    }
    if (typeof req.rawBody === "string" && req.rawBody.length > 0) {
      console.log("[readRawBody] Using req.rawBody (string, len=" + req.rawBody.length + ")");
      return Buffer.from(req.rawBody, "utf8");
    }
  }

  // Strategy 1: req.body already set (Vercel sometimes does this regardless of config)
  if (req.body != null) {
    if (Buffer.isBuffer(req.body)) {
      console.log("[readRawBody] Using req.body (Buffer, len=" + req.body.length + ")");
      return req.body;
    }
    if (typeof req.body === "string" && req.body.length > 0) {
      console.log("[readRawBody] Using req.body (string, len=" + req.body.length + ")");
      return Buffer.from(req.body, "utf8");
    }
    if (typeof req.body === "object" && Object.keys(req.body).length > 0) {
      // bodyParser parsed it as JSON despite config — re-serialize for HMAC
      // WARNING: re-serialized JSON may not match original bytes, HMAC may fail
      const str = JSON.stringify(req.body);
      console.log("[readRawBody] WARNING: Using req.body (parsed object, re-serialized len=" + str.length + ") — HMAC may not match");
      return Buffer.from(str, "utf8");
    }
  }

  // Strategy 2: event-based stream reading (more reliable than async iteration)
  console.log("[readRawBody] Falling back to stream reading");
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: any) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => {
      const buf = Buffer.concat(chunks);
      console.log("[readRawBody] Stream read complete, len=" + buf.length);
      resolve(buf);
    });
    req.on("error", (err: any) => {
      console.error("[readRawBody] Stream error:", err);
      reject(err);
    });
  });
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
  console.log("[orders-create] Webhook hit:", req.method, new Date().toISOString());

  // GET = health check / reachability test
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      endpoint: "orders-create",
      timestamp: new Date().toISOString(),
      hasSecret: !!process.env.SHOPIFY_WEBHOOK_SECRET,
      bodyParserDisabled: true,
    });
  }

  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  const secret = process.env.SHOPIFY_WEBHOOK_SECRET || "";
  if (!secret) {
    console.error("[orders-create] SHOPIFY_WEBHOOK_SECRET is not set!");
    return res.status(500).send("Webhook secret not configured");
  }

  try {
    const rawBody = await readRawBody(req);
    console.log("[orders-create] Raw body length:", rawBody.length);

    const hmacHeader = String(req.headers["x-shopify-hmac-sha256"] || "");
    const topic = String(req.headers["x-shopify-topic"] || "");
    const webhookId = String(req.headers["x-shopify-webhook-id"] || "");

    console.log("[orders-create] topic:", topic, "webhookId:", webhookId, "hmac present:", !!hmacHeader);

    const hmacOk = safeVerifyShopifyHmac(rawBody, secret, hmacHeader);
    if (!hmacOk) {
      console.error("[orders-create] HMAC verification FAILED. rawBody first 200 chars:", rawBody.toString("utf8").slice(0, 200));
      console.error("[orders-create] hmacHeader:", hmacHeader);
      console.error("[orders-create] rawBody length:", rawBody.length, "rawBody starts with:", rawBody.toString("utf8").slice(0, 1));
      // If body was 0 bytes, the stream was consumed — this is the root cause
      if (rawBody.length === 0) {
        console.error("[orders-create] CRITICAL: rawBody is EMPTY — Vercel consumed the stream. Check readRawBody strategies.");
        return res.status(500).send("Empty body — stream consumed");
      }
      return res.status(401).send("HMAC mismatch");
    }
    console.log("[orders-create] HMAC verified OK");
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

    console.log("[orders-create] Order:", orderNumber, "shopifyId:", shopifyOrderId, "lineItems:", lineItems.length, "customer:", customerEmail);

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

      if (!merchantId) {
        console.warn("[orders-create] UNMATCHED line item:", {
          title: li?.title,
          sku,
          product_id: productNum,
          variant_id: variantNum,
        });
        continue;
      }

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

    console.log("[orders-create] Matched merchants:", byMerchant.size, "from", lineItems.length, "line items");
    for (const [mid, group] of byMerchant.entries()) {
      console.log("[orders-create]   merchant:", mid, "items:", group.items.length, "subtotal:", group.subtotal);
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
        console.warn("[orders-create] NO merchants matched for order", orderNumber, "- all", lineItems.length, "line items unmatched");
        const unmatchedSummary = lineItems.map((li: any) => ({
          title: li?.title, sku: li?.sku, product_id: li?.product_id, variant_id: li?.variant_id,
        }));
        tx.set(eventRef, {
          note: "no matching marketplace items",
          unmatchedItems: unmatchedSummary,
          orderNumber,
          customerEmail,
        }, { merge: true });
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

    if (alreadyProcessed) {
      console.log("[orders-create] Already processed:", eventId);
      return res.status(200).send("Already processed");
    }
    console.log("[orders-create] SUCCESS - created", byMerchant.size, "merchant order(s) for", orderNumber);
    return res.status(200).send("ok");
  } catch (err: any) {
    console.error("[orders-create] WEBHOOK ERROR:", err?.message || err, err?.stack);
    return res.status(500).send("server error");
  }
}
