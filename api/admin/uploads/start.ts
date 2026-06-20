// api/admin/uploads/start.ts
import { getAdmin } from "../../_lib/firebaseAdmin.js";
import { shopifyGraphQL } from "../../_lib/shopify.js";

const STAGED_UPLOADS_CREATE = `
mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
  stagedUploadsCreate(input: $input) {
    stagedTargets {
      url
      resourceUrl
      parameters { name value }
    }
    userErrors { field message }
  }
}
`;

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const { adminAuth } = getAdmin();

    const authHeader = String(req.headers.authorization || "");
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return res.status(401).json({ ok: false, error: "Missing Authorization" });
    await adminAuth.verifyIdToken(token);

    const { files } = req.body || {};
    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ ok: false, error: "No files provided" });
    }

    // 🔧 fileSize MUST be a STRING for Shopify UnsignedInt64
    const input = files.map((f: any) => ({
      resource: "IMAGE",
      filename: String(f.filename || "image.jpg"),
      mimeType: String(f.mimeType || "image/jpeg"),
      fileSize: String(f.fileSize),   // <<— key fix
      httpMethod: "POST",
    }));

    const r = await shopifyGraphQL(STAGED_UPLOADS_CREATE, { input });
    const targets = r.data.stagedUploadsCreate.stagedTargets;

    return res.status(200).json({ ok: true, targets });
  } catch (e: any) {
    console.error("uploads/start error:", e?.message || e);
    return res.status(500).json({ ok: false, error: e?.message || "Internal error" });
  }
}
