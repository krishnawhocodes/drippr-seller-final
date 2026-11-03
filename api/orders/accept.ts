// api/orders/accept.ts
// Seller accepts an order. Previously proxied to a separate deployment; it now
// lives here so the whole workflow is owned by this repo.

import {
  appendTimeline,
  requireCaller,
  sendWorkflowError,
  transitionOrder,
  WorkflowError,
} from "../_lib/orderWorkflow.js";
import {
  getRemainingBusinessTime,
  vendorAcceptDeadline,
} from "../_lib/officeHours.js";

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

        // Idempotent: accepting twice is a no-op, not an error. The seller may
        // simply have double-tapped or retried on a flaky connection.
        if (
          status === "vendor_accepted" ||
          status === "pickup_assigned" ||
          status === "dispatched"
        ) {
          return null;
        }
        if (status !== "vendor_pending") {
          throw new WorkflowError(
            400,
            `This order cannot be accepted while it is "${status}".`,
          );
        }

        // The deadline only consumes office hours, so an order that arrived
        // overnight is still acceptable when the office reopens.
        const deadline = vendorAcceptDeadline(
          order as { createdAt?: number; vendorAcceptBy?: number | null },
        );
        if (getRemainingBusinessTime(deadline, now) <= 0) {
          throw new WorkflowError(
            400,
            "The acceptance window for this order has expired. Please contact DRIPPR support.",
          );
        }

        return {
          workflowStatus: "vendor_accepted",
          vendorAcceptedAt: now,
          vendorAcceptedBy: caller.uid,
          // Admin planning is not time boxed, kept explicit for clarity.
          adminPlanBy: null,
          workflowTimeline: appendTimeline(order.workflowTimeline, {
            at: now,
            type: "vendor_accepted",
            note: "Seller accepted the order",
            by: caller.uid,
          }),
        };
      },
    });

    return res.status(200).json({
      ok: true,
      orderId,
      workflowStatus: "vendor_accepted",
      alreadyAccepted: !changed,
      acceptedAt: now,
    });
  } catch (error) {
    return sendWorkflowError(res, error, "Failed to accept order");
  }
}
