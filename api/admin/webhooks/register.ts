// api/admin/webhooks/register.ts
import { getAdmin } from "../../_lib/firebaseAdmin.js";

type UpsertResult = {
  ok: boolean;
  topic: string;
  address: string;
  id?: number;
  already?: boolean;
  error?: any;
};

function baseUrlFromReq(req: any) {
  const envBase = (process.env.APP_BASE_URL || "").trim();
  if (envBase) return envBase.replace(/\/$/, "");
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const host = req.headers.host as string;
  return `${proto}://${host}`;
}

async function upsertWebhook(
  shop: string,
  api: string,
  adminToken: string,
  topic: string,
  address: string
): Promise<UpsertResult> {
  const headers = {
    "X-Shopify-Access-Token": adminToken,
    "Content-Type": "application/json",
  };

  // 1) Lookup existing (Shopify allows multiple per topic, but we dedupe by address)
  const lookup = await fetch(
    `https://${shop}/admin/api/${api}/webhooks.json?topic=${encodeURIComponent(topic)}`,
    { headers }
  );
  const existing = await lookup.json().catch(() => ({} as any));
  if (lookup.ok) {
    const found = (existing.webhooks || []).find((w: any) => w.address === address);
    if (found) return { ok: true, topic, address, id: found.id, already: true };
  }

  // 2) Create
  const resp = await fetch(`https://${shop}/admin/api/${api}/webhooks.json`, {
    method: "POST",
    headers,
    body: JSON.stringify({ webhook: { topic, address, format: "json" } }),
  });
  const data = await resp.json().catch(() => ({} as any));
  if (!resp.ok) {
    return { ok: false, topic, address, error: data?.errors || data };
  }
  return { ok: true, topic, address, id: data?.webhook?.id };
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { adminAuth } = getAdmin();

    // Require a logged-in user
    const authHeader = String(req.headers.authorization || "");
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return res.status(401).json({ ok: false, error: "Missing Authorization" });
    await adminAuth.verifyIdToken(token);

    const base = baseUrlFromReq(req);
    const shop = process.env.SHOPIFY_STORE_DOMAIN!;
    const api = process.env.SHOPIFY_API_VERSION || "2025-01";
    const adminToken = process.env.SHOPIFY_ADMIN_TOKEN!;
    if (!shop || !adminToken) {
      return res.status(400).json({ ok: false, error: "Shopify env vars missing" });
    }

    // Webhooks we want
    const targets = [
      { topic: "orders/create",        path: "/api/webhooks/shopify/orders-create" },
      { topic: "orders/updated",       path: "/api/webhooks/shopify/orders-updated" },
      { topic: "fulfillments/create",  path: "/api/webhooks/shopify/fulfillments-create" },
      { topic: "fulfillments/update",  path: "/api/webhooks/shopify/fulfillments-update" },
    ];

    const results: UpsertResult[] = [];
    for (const t of targets) {
      const address = `${base}${t.path}`;
      const r = await upsertWebhook(shop, api, adminToken, t.topic, address);
      results.push(r);
    }

    // If any failed, surface it but still show the others
    const failed = results.filter((r) => !r.ok);
    if (failed.length) {
      return res.status(207).json({ ok: false, results }); // 207: multi-status
    }
    return res.status(200).json({ ok: true, results });
  } catch (e: any) {
    console.error("webhook register error:", e?.message || e);
    return res.status(500).json({ ok: false, error: e?.message || "Internal error" });
  }
}
