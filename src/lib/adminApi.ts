// --- Admin check hook (Firestore-based) ---
import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";

import type { SupportTicket } from "@/types/admin";



// Cached per uid so navigating between pages does not re-hit admin.me (and,
// for ordinary sellers, does not spam 403s) on every layout mount.
const adminCheckCache = new Map<string, Promise<boolean>>();

function checkIsAdmin(uid: string): Promise<boolean> {
  const cached = adminCheckCache.get(uid);
  if (cached) return cached;
  const pending = adminMe()
    .then(() => true)
    .catch(() => false);
  adminCheckCache.set(uid, pending);
  return pending;
}

/**
 * Returns true if the signed-in user is an admin.
 *
 * Authority is the server: `admin.me` verifies the Firebase ID token and checks
 * the uid against the ADMIN_UIDS env allowlist. This hook is only for showing
 * or hiding UI; every admin action is re-checked server-side.
 */
export function useIsAdmin(): boolean {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const unsubAuth = onAuthStateChanged(auth, (u) => {
      if (!u) {
        adminCheckCache.clear();
        setIsAdmin(false);
        return;
      }
      checkIsAdmin(u.uid).then((result) => {
        if (!cancelled) setIsAdmin(result);
      });
    });

    return () => {
      cancelled = true;
      unsubAuth();
    };
  }, []);

  return isAdmin;
}


export function assignPickup(payload: {
  orderId: string;
  pickupWindow?: string | null;
  pickupAddress?: string | null;
  customerAddress?: string | null;
  deliveryScope?: "same_city" | "different_city";
  notes?: string | null;
  deliveryPartner?: {
    name?: string | null;
    phone?: string | null;
    etaText?: string | null;
    trackingUrl?: string | null;
  };
  shippingLabel?: { url: string; name?: string } | null;
}) {
  return call("orders.assignPickup", payload);
}

/**
 * Re-reads the buyer's name and delivery address from Shopify for one order
 * and merges in anything the webhook was not allowed to see.
 *
 * `stillRedacted` is true when Shopify handed back an address with no street
 * line, which means protected customer data access has not been approved yet.
 */
export function refreshOrderCustomer(orderId: string): Promise<{
  ok: true;
  changed: boolean;
  stillRedacted: boolean;
  shippingAddress: Record<string, string> | null;
  customerName: string | null;
  customerEmail: string | null;
  error?: string;
}> {
  return call("orders.refreshCustomer", { orderId });
}

/**
 * Signed ImageKit credentials for admin-side uploads (shipping labels).
 * The file goes straight from the browser to ImageKit; only the resulting URL
 * comes back through our API.
 */
export async function uploadAdminFile(file: File, folder = "/shipping-labels") {
  const signed = await call("uploads.sign", { folder });

  const form = new FormData();
  form.append("file", file);
  form.append("fileName", file.name);
  form.append("publicKey", signed.publicKey);
  form.append("signature", signed.auth.signature);
  form.append("token", signed.auth.token);
  form.append("expire", String(signed.auth.expire));
  if (signed.folder) form.append("folder", signed.folder);

  const response = await fetch(
    "https://upload.imagekit.io/api/v1/files/upload",
    { method: "POST", body: form },
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result?.url) {
    throw new Error(result?.message || "File upload failed");
  }
  return { url: String(result.url), name: String(result.name || file.name) };
}

let _publicationIdCache: string | null | undefined; // undefined => not fetched yet

/**
 * One-time fetch of the Shopify Publication (sales channel) GraphQL ID
 * from Firestore: adminSettings/shopify.publicationId
 */
export async function getPublicationId(): Promise<string | null> {
  if (_publicationIdCache !== undefined) return _publicationIdCache ?? null;

  const result = await call("settings.publication.get");
  const val = (result.publicationId as string | null | undefined) ?? null;

  _publicationIdCache = val;
  return val;
}

/**
 * Realtime listener (optional) if your UI should update live.
 * Returns unsubscribe() like any Firestore onSnapshot.
 */
export function watchPublicationId(cb: (id: string | null) => void) {
  getPublicationId()
    .then(cb)
    .catch(() => cb(null));
  return () => {};
}

/**
 * Write the Publication ID (admins only).
 * Saves admin uid + timestamp for audit.
 */
export async function setPublicationId(id: string | null): Promise<void> {
  const publicationId = (id ?? "").trim() || null;
  await call("settings.publication.set", { publicationId });
  _publicationIdCache = publicationId;
}



async function call(action: string, payload: any = {}) {
  const u = auth.currentUser;
  if (!u) throw new Error("Not signed in");
  const idToken = await u.getIdToken(true);

  const r = await fetch("/api/admin/admin?action=" + encodeURIComponent(action), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j?.ok === false) {
    throw new Error(j?.error || `Admin call failed: ${action}`);
  }
  return j;
}

// ---------- exported APIs used by your pages ----------
export const listMerchants = (params: { q?: string } = {}) =>
  call("merchants.list", params);

export const updateMerchant = (uid: string, patch: Record<string, any>) =>
  call("merchants.update", { uid, patch });

export const adminMe = () => call("admin.me");

/**
 * Shopify webhook management and the internal test coupon.
 *
 * These were standalone serverless functions. They are admin-only and the
 * gateway already enforces that, so they were folded in to stay within the
 * hosting plan's function budget.
 */
export type ShopifyDiagnostics = {
  ok: true;
  shop: string;
  apiVersion: string;
  grantedScopes: string[];
  scopeError: string | null;
  probedOrderNumber: string | null;
  probeError: string | null;
  /** Null when no order was available to test against. */
  customerDataReadable: boolean | null;
  required: Array<{ scope: string; granted: boolean; why: string }>;
};

/** Asks Shopify what the deployed token can actually do. */
export const shopifyDiagnostics = (): Promise<ShopifyDiagnostics> =>
  call("shopify.diagnostics");

export const listShopifyWebhooks = () => call("webhooks.list");

export const registerShopifyWebhooks = () => call("webhooks.register");

export const createTestDiscount = (code: string, title?: string) =>
  call("discounts.create", { code, title });

export const dashboardOverview = () => call("dashboard.overview");

export const ordersList = (params: { limit?: number } = {}) =>
  call("orders.list", params);

export const queueList = (params: { status?: string; limit?: number } = {}) =>
  call("queue.list", params);

/**
 * Live Shopify collection titles, so the approval dropdown always matches the
 * store. Returns an empty list (never throws) if Shopify is unreachable, and
 * callers fall back to their local defaults.
 */
export const listStoreCollections = (): Promise<{
  ok: true;
  collections: string[];
}> => call("settings.collections.list") as Promise<{ ok: true; collections: string[] }>;

export const queueApprove = (
  id: string,
  note?: string,
  collections?: string[],
) => call("queue.approve", { id, note, collections });

export const queueReject = (id: string, reason?: string) =>
  call("queue.reject", { id, reason });

export const supportList = (params: { status?: string } = {}) =>
  call("support.list", params);

export const supportReply = (id: string, message: string, nextStatus?: string) =>
  call("support.reply", { id, message, nextStatus });






// Mock data
/**
 * Support tickets, backed by the real `supportRequests` collection.
 *
 * These were previously hardcoded fixtures, so every ticket a seller actually
 * raised was invisible to the admin and replies went nowhere. The backend
 * actions existed the whole time and simply were not wired up.
 */
export async function listSupport(params: {
  status?: string;
  q?: string;
}): Promise<{ ok: true; items: SupportTicket[] }> {
  const result = await call("support.list", {
    status: params.status || "all",
    q: params.q || "",
  });
  return {
    ok: true,
    items: Array.isArray(result.items) ? (result.items as SupportTicket[]) : [],
  };
}

export async function replySupport(
  id: string,
  message: string,
  newStatus?: "processing" | "resolved",
): Promise<{ ok: true }> {
  await call("support.reply", { id, message, nextStatus: newStatus });
  return { ok: true };
}
