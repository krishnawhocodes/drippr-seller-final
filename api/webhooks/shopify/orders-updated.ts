// api/webhooks/shopify/orders-updated.ts
import crypto from "node:crypto";
import { getAdmin } from "../../_lib/firebaseAdmin.js";
import { FieldValue } from "firebase-admin/firestore";

async function readRawBody(req: any): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  const secret = process.env.SHOPIFY_WEBHOOK_SECRET || "";
  if (!secret) return res.status(500).send("Webhook secret not configured");

  try {
    const rawBody = await readRawBody(req);

    // HMAC verify
    const hmacHeader = String(req.headers["x-shopify-hmac-sha256"] || "");
    const topic = String(req.headers["x-shopify-topic"] || "");
    const webhookId = String(req.headers["x-shopify-webhook-id"] || "");
    const computed = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
    if (computed !== hmacHeader) return res.status(401).send("HMAC mismatch");
    if (topic !== "orders/updated") return res.status(200).send("Ignored topic");

    const payload = JSON.parse(rawBody.toString("utf8"));
    const shopifyOrderId = String(payload.id);

    const { adminDb } = getAdmin();

    // idempotency
    const evRef = adminDb.collection("webhookEvents").doc(webhookId || `orders_updated_${shopifyOrderId}`);
    const evSnap = await evRef.get();
    if (!evSnap.exists) await evRef.set({ topic, shopifyOrderId, receivedAt: Date.now() });

    // update every merchant doc for this order
    const q = await adminDb.collection("orders").where("shopifyOrderId", "==", shopifyOrderId).get();
    const batch = adminDb.batch();

    const financialStatus: string | undefined = payload.financial_status || undefined;
    const status = payload.closed_at ? "closed" : payload.cancelled_at ? "cancelled" : "open";

    q.forEach((doc) => {
      batch.set(
        doc.ref,
        {
          updatedAt: Date.now(),
          ...(financialStatus ? { financialStatus } : {}),
          status,
          // keep a tiny audit trail
          audit: FieldValue.arrayUnion({
            at: Date.now(),
            type: "orders/updated",
            financialStatus: financialStatus ?? null,
            status,
          }),
        },
        { merge: true }
      );
    });

    await batch.commit();
    return res.status(200).send("ok");
  } catch (err: any) {
    console.error("orders-updated webhook error:", err?.message || err);
    return res.status(500).send("server error");
  }
}
