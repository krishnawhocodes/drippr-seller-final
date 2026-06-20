import { getAdmin } from "../../_lib/firebaseAdmin.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  try {
    const { adminAuth } = getAdmin();
    const authHeader = String(req.headers.authorization || "");
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return res.status(401).json({ ok: false, error: "Missing Authorization" });
    await adminAuth.verifyIdToken(token);

    const shop = process.env.SHOPIFY_STORE_DOMAIN!;
    const api = process.env.SHOPIFY_API_VERSION || "2025-01";
    const adminToken = process.env.SHOPIFY_ADMIN_TOKEN!;

    const resp = await fetch(`https://${shop}/admin/api/${api}/webhooks.json`, {
      headers: { "X-Shopify-Access-Token": adminToken, "Content-Type": "application/json" },
    });
    const data = await resp.json().catch(() => ({} as any));
    return res.status(resp.ok ? 200 : 400).json({ ok: resp.ok, ...data });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Internal error" });
  }
}