// api/webhooks/shopify/fulfillments-update.ts
import crypto from "node:crypto";
import { getAdmin } from "../../_lib/firebaseAdmin.js";

export const config = { api: { bodyParser: false } };

async function readRawBody(req: any): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function safeVerifyShopifyHmac(rawBody: Buffer, secret: string, hmacHeader: string) {
  if (!secret || !hmacHeader) return false;
  const computed = crypto.createHmac("sha256", secret).update(rawBody).digest();
  let headerBuf: Buffer;
  try {
    headerBuf = Buffer.from(String(hmacHeader), "base64");
  } catch {
    return false;
  }
  if (headerBuf.length !== computed.length) return false;
  return crypto.timingSafeEqual(computed, headerBuf);
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  const secret = process.env.SHOPIFY_WEBHOOK_SECRET || "";
  if (!secret) return res.status(500).send("Webhook secret not configured");

  try {
    const rawBody = await readRawBody(req);

    const hmacHeader = String(req.headers["x-shopify-hmac-sha256"] || "");
    const topic = String(req.headers["x-shopify-topic"] || "");
    const webhookId = String(req.headers["x-shopify-webhook-id"] || "");

    if (!safeVerifyShopifyHmac(rawBody, secret, hmacHeader)) return res.status(401).send("HMAC mismatch");
    if (topic !== "fulfillments/update") return res.status(200).send("Ignored topic");

    const payload = JSON.parse(rawBody.toString("utf8"));
    const shopifyOrderId = String(payload.order_id || "");
    const fulfillmentId = String(payload.id || "");
    if (!shopifyOrderId) return res.status(400).send("Missing order_id");

    const { adminDb } = getAdmin();

    // Idempotency
    const evRef = adminDb.collection("webhookEvents").doc(webhookId || `fulfillments_update_${shopifyOrderId}_${fulfillmentId}`);
    let already = false;
    await adminDb.runTransaction(async (tx: any) => {
      const snap = await tx.get(evRef);
      if (snap.exists) {
        already = true;
        return;
      }
      tx.set(evRef, { topic, shopifyOrderId, fulfillmentId: fulfillmentId || null, receivedAt: Date.now() });
    });
    if (already) return res.status(200).send("Already processed");

    const trackingCompany = payload.tracking_company || null;
    const trackingNumber = payload.tracking_number || null;
    const trackingUrl = payload.tracking_url || null;

    const atIso = payload.updated_at || payload.created_at || null;
    const deliveryStatus = payload.delivery_status || payload.status || null;

    const lineItems = Array.isArray(payload.line_items) ? payload.line_items : [];
    const fulfilledLineItemIds = new Set(
      lineItems
        .map((li: any) => String(li?.id ?? li?.line_item_id ?? ""))
        .filter(Boolean)
    );

    const q = await adminDb.collection("orders").where("shopifyOrderId", "==", shopifyOrderId).get();
    const batch = adminDb.batch();

    q.forEach((doc: any) => {
      const data = doc.data() || {};
      const orderLineItems = Array.isArray(data.lineItems) ? data.lineItems : [];

      const matchedItems =
        fulfilledLineItemIds.size > 0
          ? orderLineItems.filter((it: any) => fulfilledLineItemIds.has(String(it?.line_item_id ?? "")))
          : orderLineItems;

      if (!matchedItems.length) return;

      const shipment = {
        fulfillmentId: fulfillmentId || null,
        atIso,
        topic,
        trackingCompany,
        trackingNumber,
        trackingUrl,
        status: deliveryStatus,
        items: matchedItems.map((it: any) => ({
          line_item_id: it.line_item_id ?? null,
          sku: it.sku ?? null,
          title: it.title ?? "",
          quantity: it.quantity ?? 0,
        })),
      };

      const patch: any = {
        updatedAt: Date.now(),
        shipmentsById: fulfillmentId ? { [fulfillmentId]: shipment } : {},
        lastShipment: shipment,
      };

      // convenience
      if (deliveryStatus === "delivered") patch.fulfillmentStatus = "fulfilled";

      batch.set(doc.ref, patch, { merge: true });
    });

    await batch.commit();
    return res.status(200).send("ok");
  } catch (err: any) {
    console.error("fulfillments-update webhook error:", err?.message || err);
    return res.status(500).send("server error");
  }
}
