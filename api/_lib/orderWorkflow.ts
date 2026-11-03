// api/_lib/orderWorkflow.ts
// Shared pieces of the order lifecycle, owned by this repo.
//
// The workflow states, in order:
//   vendor_pending   -> seller must accept within the office-hours window
//   vendor_accepted  -> admin plans the pickup
//   pickup_assigned  -> seller hands the parcel over
//   dispatched       -> done from the panel's point of view
//   vendor_expired   -> derived, not stored: vendor_pending past its deadline
//
// Everything here reads and writes the same `orders` collection the Shopify
// webhooks populate, so no other service is involved in moving an order
// forward.

import { getAdmin } from "./firebaseAdmin.js";

export type WorkflowStatus =
  | "vendor_pending"
  | "vendor_accepted"
  | "pickup_assigned"
  | "dispatched"
  | "vendor_expired"
  | "admin_overdue";

export type TimelineEntry = {
  at: number;
  type: string;
  note: string;
  by?: string;
};

export type AuthedCaller = {
  uid: string;
  email: string | null;
  isAdmin: boolean;
};

function adminUids(): string[] {
  return (process.env.ADMIN_UIDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * Verifies the Firebase ID token. Responds and returns null when the caller is
 * not signed in, so handlers can `if (!caller) return;`.
 */
export async function requireCaller(
  req: { headers: Record<string, unknown> },
  res: {
    status: (code: number) => { json: (body: unknown) => unknown };
  },
): Promise<AuthedCaller | null> {
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    res.status(401).json({ ok: false, error: "Missing Authorization" });
    return null;
  }
  try {
    const { adminAuth } = getAdmin();
    const decoded = await adminAuth.verifyIdToken(token);
    return {
      uid: decoded.uid,
      email: decoded.email || null,
      isAdmin: adminUids().includes(decoded.uid),
    };
  } catch {
    res.status(401).json({ ok: false, error: "Invalid or expired session" });
    return null;
  }
}

/** Appends to the order's timeline, capped so a doc cannot grow unbounded. */
export function appendTimeline(
  existing: unknown,
  entry: TimelineEntry,
): TimelineEntry[] {
  const current = Array.isArray(existing) ? (existing as TimelineEntry[]) : [];
  return [...current, entry].slice(-50);
}

/** An order may only be acted on by the seller who owns it, or by an admin. */
export function callerMayActOnOrder(
  caller: AuthedCaller,
  order: { merchantId?: unknown },
) {
  return caller.isAdmin || String(order?.merchantId || "") === caller.uid;
}

export class WorkflowError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

/**
 * Runs a guarded state transition inside a transaction.
 *
 * `mutate` returns the fields to merge, or null to make the call a no-op (used
 * for idempotency, so a double-tap on Accept is not an error).
 */
export async function transitionOrder(args: {
  orderId: string;
  caller: AuthedCaller;
  mutate: (order: Record<string, unknown>) => Record<string, unknown> | null;
}): Promise<{ changed: boolean; order: Record<string, unknown> }> {
  const { adminDb } = getAdmin();
  const ref = adminDb.collection("orders").doc(args.orderId);

  let changed = false;
  let order: Record<string, unknown> = {};

  await adminDb.runTransaction(async (tx: FirebaseFirestore.Transaction) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new WorkflowError(404, "Order not found");

    order = (snap.data() || {}) as Record<string, unknown>;
    if (!callerMayActOnOrder(args.caller, order)) {
      throw new WorkflowError(403, "This order belongs to another seller");
    }

    const patch = args.mutate(order);
    if (!patch) return;

    tx.set(ref, { ...patch, updatedAt: Date.now() }, { merge: true });
    changed = true;
  });

  return { changed, order };
}

/** Narrow helper so handlers all fail the same way. */
export function sendWorkflowError(
  res: { status: (code: number) => { json: (body: unknown) => unknown } },
  error: unknown,
  fallback: string,
) {
  if (error instanceof WorkflowError) {
    return res.status(error.statusCode).json({ ok: false, error: error.message });
  }
  console.error(fallback, error);
  return res.status(500).json({
    ok: false,
    error: error instanceof Error ? error.message : fallback,
  });
}
