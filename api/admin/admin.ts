// api/admin.ts
import { getAdmin } from "../_lib/firebaseAdmin.js";
import { shopifyGraphQL } from "../_lib/shopify.js";

const MEASUREMENT_METAFIELD_NAMESPACE = "drippr_sizing";

function normalizeMeasurements(input: any) {
  if (!input || typeof input !== "object") return null;

  const toNumOrNull = (value: any) => {
    if (value === "" || value == null) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  return {
    bust: toNumOrNull(input.bust),
    waist: toNumOrNull(input.waist),
    hip: toNumOrNull(input.hip),
    length: toNumOrNull(input.length),
    unit: "in",
  };
}

function hasAnyMeasurement(measurements: any) {
  return Boolean(
    measurements &&
      ["bust", "waist", "hip", "length"].some(
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

function buildMeasurementMetafields(ownerId: string, measurements: any) {
  if (!ownerId || !measurements || typeof measurements !== "object") return [];

  const fields = ["bust", "waist", "hip", "length"] as const;
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

  const result = await shopifyGraphQL(METAFIELDS_SET, { metafields });
  const errors = result?.data?.metafieldsSet?.userErrors || [];
  if (errors.length) {
    throw new Error(errors.map((error: any) => error.message).join("; "));
  }
}

async function syncVariantMeasurementsToShopify(variantMeasurements: any[]) {
  const normalized = normalizeVariantMeasurements(variantMeasurements);
  const metafields = normalized.flatMap((variant) =>
    variant.variantId
      ? buildMeasurementMetafields(variant.variantId, variant.measurements)
      : [],
  );

  if (!metafields.length) return;

  const result = await shopifyGraphQL(METAFIELDS_SET, { metafields });
  const errors = result?.data?.metafieldsSet?.userErrors || [];
  if (errors.length) {
    throw new Error(errors.map((error: any) => error.message).join("; "));
  }
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
          merchant: merchantMap.get(i.merchantId) || null,
        }));

        return res.status(200).json({ ok: true, items: enriched });
      }

      case "queue.approve": {
        const { id, note } = body as { id: string; note?: string };
        if (!id) return res.status(400).json({ ok: false, error: "id required" });

        const ref = adminDb.collection("merchantProducts").doc(id);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ ok: false, error: "queue item not found" });

        const qdoc = snap.data() as any;
        const pendingUpdates =
          qdoc.pendingUpdates && typeof qdoc.pendingUpdates === "object"
            ? qdoc.pendingUpdates
            : {};
        const approvedMeasurements =
          pendingUpdates.measurements !== undefined
            ? pendingUpdates.measurements
            : qdoc.measurements;
        const approvedVariantMeasurements =
          pendingUpdates.variantMeasurements !== undefined
            ? pendingUpdates.variantMeasurements
            : qdoc.variantMeasurements ||
              pendingUpdates.variantDraft?.variants ||
              qdoc.variantDraft?.variants;

        await syncMeasurementsToShopify(qdoc.shopifyProductId, approvedMeasurements);
        await syncVariantMeasurementsToShopify(approvedVariantMeasurements || []);

        await ref.set(
          {
            ...pendingUpdates,
            status: "approved",
            pendingUpdates: null,
            reviewerUid: me.uid,
            reviewNote: note || null,
            reviewedAt: Date.now(),
            updatedAt: Date.now(),
          },
          { merge: true }
        );

        // Optional: flip merchantProducts status to 'active' if linked
        if (qdoc.merchantProductDocId) {
          await adminDb.collection("merchantProducts").doc(qdoc.merchantProductDocId).set(
            { status: "active", updatedAt: Date.now() },
            { merge: true }
          );
        }

        return res.status(200).json({ ok: true });
      }

      case "queue.reject": {
        const { id, reason } = body as { id: string; reason?: string };
        if (!id) return res.status(400).json({ ok: false, error: "id required" });

        const ref = adminDb.collection("merchantProducts").doc(id);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ ok: false, error: "queue item not found" });

        await ref.set(
          {
            status: "rejected",
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

      default:
        return res.status(400).json({ ok: false, error: `Unknown action: ${action}` });
    }
  } catch (e: any) {
    console.error("admin gateway error:", e?.message || e);
    return res.status(500).json({ ok: false, error: e?.message || "server error" });
  }
}
