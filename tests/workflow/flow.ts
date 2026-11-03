// Drives the real order-workflow handlers through the full lifecycle against
// an in-memory Firestore, to prove the state machine end to end.
import accept from "../../api/orders/accept.js";
import dispatch from "../../api/orders/mark-dispatched.js";
import { store, tokens } from "./fakeAdmin.js";
import { addBusinessHours, VENDOR_ACCEPT_WINDOW_MS } from "../../api/_lib/officeHours.js";

const SELLER = "seller-uid-1";
const OTHER_SELLER = "seller-uid-2";
const ADMIN = "admin-uid-1";
process.env.ADMIN_UIDS = ADMIN;

tokens["seller-token"] = { uid: SELLER };
tokens["other-token"] = { uid: OTHER_SELLER };
tokens["admin-token"] = { uid: ADMIN };

let fail = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
};

function res() {
  const out: { code: number; body: any } = { code: 0, body: undefined };
  const r: any = {
    setHeader: () => r,
    status: (c: number) => { out.code = c; return r; },
    json: (b: unknown) => { out.body = b; return r; },
    end: () => r,
  };
  return { r, out };
}

async function call(handler: any, token: string, orderId: string) {
  const { r, out } = res();
  await handler(
    { method: "POST", headers: { authorization: `Bearer ${token}` }, body: { orderId } },
    r,
  );
  return out;
}

function seedOrder(id: string, patch: Record<string, unknown> = {}) {
  const createdAt = Date.now() - 10 * 60 * 1000;
  store[`orders/${id}`] = {
    merchantId: SELLER,
    createdAt,
    vendorAcceptBy: addBusinessHours(createdAt, VENDOR_ACCEPT_WINDOW_MS),
    workflowStatus: "vendor_pending",
    workflowTimeline: [{ at: createdAt, type: "vendor_pending", note: "Order received" }],
    ...patch,
  };
}
const statusOf = (id: string) => (store[`orders/${id}`] as any).workflowStatus;
const timelineOf = (id: string) => ((store[`orders/${id}`] as any).workflowTimeline || []) as any[];

(async () => {
  console.log("=== happy path: pending -> accepted -> pickup -> dispatched ===");
  seedOrder("A");
  let out = await call(accept, "seller-token", "A");
  check("seller accepts -> 200", out.code, 200);
  check("  status is vendor_accepted", statusOf("A"), "vendor_accepted");
  check("  timeline records it", timelineOf("A").at(-1).type, "vendor_accepted");

  // Admin assigns pickup (performed by the admin gateway in production).
  (store["orders/A"] as any).workflowStatus = "pickup_assigned";

  out = await call(dispatch, "seller-token", "A");
  check("seller dispatches -> 200", out.code, 200);
  check("  status is dispatched", statusOf("A"), "dispatched");
  check("  dispatchedAt recorded", typeof (store["orders/A"] as any).dispatchedAt, "number");

  console.log("\n=== idempotency: repeated taps must not corrupt ===");
  out = await call(accept, "seller-token", "A");
  check("re-accept after dispatch -> 200 no-op", out.code, 200);
  check("  still dispatched", statusOf("A"), "dispatched");
  out = await call(dispatch, "seller-token", "A");
  check("re-dispatch -> 200 no-op", out.code, 200);
  check("  flagged alreadyDispatched", out.body.alreadyDispatched, true);

  console.log("\n=== ordering: cannot dispatch before pickup is assigned ===");
  seedOrder("B");
  out = await call(dispatch, "seller-token", "B");
  check("dispatch while vendor_pending -> 400", out.code, 400);
  check("  explains why", out.body.error, "DRIPPR has not assigned a pickup for this order yet.");
  check("  status unchanged", statusOf("B"), "vendor_pending");

  await call(accept, "seller-token", "B");
  out = await call(dispatch, "seller-token", "B");
  check("dispatch while vendor_accepted -> 400", out.code, 400);
  check("  status unchanged", statusOf("B"), "vendor_accepted");

  console.log("\n=== tenant isolation ===");
  seedOrder("C");
  out = await call(accept, "other-token", "C");
  check("another seller cannot accept -> 403", out.code, 403);
  check("  status untouched", statusOf("C"), "vendor_pending");
  out = await call(dispatch, "other-token", "C");
  check("another seller cannot dispatch -> 403", out.code, 403);

  console.log("\n=== expired window ===");
  const longAgo = Date.now() - 20 * 24 * 60 * 60 * 1000;
  seedOrder("D", { createdAt: longAgo, vendorAcceptBy: longAgo + 3 * 3600e3 });
  out = await call(accept, "seller-token", "D");
  check("seller cannot accept expired -> 400", out.code, 400);
  check("  status unchanged", statusOf("D"), "vendor_pending");

  // The fix: an expired order used to be unfulfillable by anyone.
  out = await call(accept, "admin-token", "D");
  check("ADMIN can take it over -> 200", out.code, 200);
  check("  status is vendor_accepted", statusOf("D"), "vendor_accepted");
  check("  override recorded", timelineOf("D").at(-1).type, "accepted_by_admin");
  check("  flagged on the order", (store["orders/D"] as any).acceptanceOverridden, true);

  (store["orders/D"] as any).workflowStatus = "pickup_assigned";
  out = await call(dispatch, "seller-token", "D");
  check("  seller can then dispatch it", statusOf("D"), "dispatched");

  console.log("\n=== unknown order ===");
  out = await call(accept, "seller-token", "does-not-exist");
  check("missing order -> 404", out.code, 404);

  console.log(fail ? `\n${fail} FAILURE(S)` : "\nall checks passed");
  process.exit(fail ? 1 : 0);
})();
