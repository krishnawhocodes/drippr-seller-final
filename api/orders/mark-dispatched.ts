// api/orders/mark-dispatched.ts
// Seller confirms the parcel has been handed to the courier. Previously
// proxied to a separate deployment; it now lives here.

import {
  appendTimeline,
  requireCaller,
  sendWorkflowError,
  transitionOrder,
  WorkflowError,
} from "../_lib/orderWorkflow.js";

export default async function handler(req: any, res: any) {
  if (req.method === "OPTIONS") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const caller = await requireCaller(req, res);
  if (!caller) return;

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const orderId = String(body.orderId || "").trim();
  if (!orderId) {
    return res.status(400).json({ ok: false, error: "orderId is required" });
  }

  const now = Date.now();

  try {
    const { changed } = await transitionOrder({
      orderId,
      caller,
      mutate: (order) => {
        const status = String(order.workflowStatus || "vendor_pending");

        // Idempotent, same reasoning as accept.
        if (status === "dispatched") return null;

        if (status !== "pickup_assigned") {
          throw new WorkflowError(
            400,
            status === "vendor_pending" || status === "vendor_accepted"
              ? "DRIPPR has not assigned a pickup for this order yet."
              : `This order cannot be dispatched while it is "${status}".`,
          );
        }

        return {
          workflowStatus: "dispatched",
          dispatchedAt: now,
          dispatchedBy: caller.uid,
          workflowTimeline: appendTimeline(order.workflowTimeline, {
            at: now,
            type: "dispatched",
            note: "Seller handed the parcel to the delivery partner",
            by: caller.uid,
          }),
        };
      },
    });

    return res.status(200).json({
      ok: true,
      orderId,
      workflowStatus: "dispatched",
      alreadyDispatched: !changed,
      dispatchedAt: now,
    });
  } catch (error) {
    return sendWorkflowError(res, error, "Failed to mark order dispatched");
  }
}
