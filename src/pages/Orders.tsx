import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Search, Eye, Download, CheckCircle2, Truck, Clock } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { collection, onSnapshot, orderBy, query, where, limit } from "firebase/firestore";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { 
  addBusinessHours, 
  getRemainingBusinessTime, 
  isCurrentlyOfficeHours,
  getOfficeStatusMessage 
} from "@/lib/officeHours";

type LineItem = {
  title: string;
  sku?: string;
  quantity: number;
  price: number;
  total: number;
  variant_id?: any;
  product_id?: any;
};

type WorkflowStatus =
  | "vendor_pending"
  | "vendor_accepted"
  | "pickup_assigned"
  | "dispatched"
  | "vendor_expired"
  | "admin_overdue";

type OrderDoc = {
  id: string;                // `${shopifyOrderId}_${merchantId}`
  shopifyOrderId: string;
  orderNumber?: string;
  merchantId: string;
  createdAt: number;         // epoch ms
  currency?: string;         // e.g. "INR"
  financialStatus?: string;  // "paid" | "pending" | "refunded" | "voided" | ...
  status?: string;           // "open" | "closed"
  lineItems?: LineItem[];
  subtotal?: number;

  raw?: { customer?: { id?: any; email?: string } };
  customerEmail?: string | null;

  // ✅ NEW WORKFLOW FIELDS (may be missing for older docs)
  workflowStatus?: WorkflowStatus;
  vendorAcceptBy?: number;
  vendorAcceptedAt?: number | null;
  adminPlanBy?: number | null;
  adminPlannedAt?: number | null;

  pickupPlan?: {
    pickupWindow?: string | null;
    pickupAddress?: string | null;
    notes?: string | null;
  } | null;

  deliveryPartner?: {
    name?: string | null;
    phone?: string | null;
    etaText?: string | null;
    trackingUrl?: string | null;
  } | null;

  dispatchedAt?: number | null;

  invoice?: {
    status?: "none" | "generating" | "ready";
    url?: string;
    generatedAt?: number;
  } | null;
};

// Keep old filter options + add workflow filters (so nothing breaks)
type UiFilter =
  | "all"
  | "pay:pending"
  | "pay:paid"
  | "pay:refunded"
  | "pay:voided"
  | "ord:open"
  | "ord:closed"
  | "wf:vendor_pending"
  | "wf:vendor_accepted"
  | "wf:pickup_assigned"
  | "wf:dispatched"
  | "wf:vendor_expired"
  | "wf:admin_overdue";

const THREE_HOURS = 3 * 60 * 60 * 1000;
const THIRTY_MIN = 30 * 60 * 1000;

function fmtCountdown(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export default function Orders() {
  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid ?? null);
  const [orders, setOrders] = useState<OrderDoc[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<UiFilter>("all");

  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<OrderDoc | null>(null);

  const [now, setNow] = useState(Date.now());
  const [actionBusy, setActionBusy] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUid(u?.uid ?? null));
    return () => unsub();
  }, []);

  // live tick for timers
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!uid) return;
    // Recent 200 orders; adjust if needed
    const q = query(
      collection(db, "orders"),
      where("merchantId", "==", uid),
      orderBy("createdAt", "desc"),
      limit(200)
    );
    const unsub = onSnapshot(q, (snap) => {
      const rows: OrderDoc[] = [];
      snap.forEach((d) => rows.push({ id: d.id, ...(d.data() as any) }));
      setOrders(rows);
    });
    return () => unsub();
  }, [uid]);

  // keep selected in sync as Firestore updates
  useEffect(() => {
    if (!selected) return;
    const fresh = orders.find((o) => o.id === selected.id);
    if (fresh) setSelected(fresh);
  }, [orders, selected?.id]);

  const currency = useMemo(
    () => orders.find((o) => o.currency)?.currency || "INR",
    [orders]
  );

  const money = (v: number | undefined) =>
    new Intl.NumberFormat("en-IN", { style: "currency", currency }).format(Number(v || 0));

  const customerFor = (o: OrderDoc) => o.customerEmail || o.raw?.customer?.email || "—";

  const payLabelFor = (o: OrderDoc) => (o.financialStatus || "pending").toLowerCase();
  const ordLabelFor = (o: OrderDoc) => (o.status || "open").toLowerCase();

  // ✅ Calculate deadline with business hours
  const getVendorAcceptByDeadline = (o: OrderDoc): number => {
    // If vendorAcceptBy exists in DB, use it (for already-created orders)
    if (o.vendorAcceptBy) {
      return o.vendorAcceptBy;
    }
    
    // Otherwise calculate with business hours
    return addBusinessHours(o.createdAt, THREE_HOURS);
  };

  const getAdminPlanByDeadline = (o: OrderDoc): number => {
    // If adminPlanBy exists in DB, use it
    if (o.adminPlanBy) {
      return o.adminPlanBy;
    }
    
    // Otherwise calculate from vendor accepted time
    const acceptedAt = o.vendorAcceptedAt || now;
    return addBusinessHours(acceptedAt, THIRTY_MIN);
  };

  // ✅ Workflow status (with safe fallback and business hours)
  const workflowFor = (o: OrderDoc): WorkflowStatus => {
    const st = o.workflowStatus;
    if (st) {
      // if vendor_pending and deadline passed, display as vendor_expired
      if (st === "vendor_pending") {
        const acceptBy = getVendorAcceptByDeadline(o);
        if (now > acceptBy) return "vendor_expired";
      }
      if (st === "vendor_accepted") {
        const planBy = getAdminPlanByDeadline(o);
        if (now > planBy) return "admin_overdue";
      }
      return st;
    }

    // For old orders that don't have workflow yet:
    const acceptBy = getVendorAcceptByDeadline(o);
    return now > acceptBy ? "vendor_expired" : "vendor_pending";
  };

  const workflowBadgeText = (st: WorkflowStatus) => {
    switch (st) {
      case "vendor_pending":
        return "Pending Acceptance";
      case "vendor_accepted":
        return "Accepted (Admin Planning)";
      case "pickup_assigned":
        return "Pickup Assigned";
      case "dispatched":
        return "Dispatched";
      case "vendor_expired":
        return "Expired";
      case "admin_overdue":
        return "Admin Overdue";
      default:
        return st;
    }
  };

  const workflowBadgeClass = (st: WorkflowStatus) => {
    if (st === "vendor_pending") return "bg-warning/10 text-warning border-warning/20";
    if (st === "vendor_accepted") return "bg-primary/10 text-primary border-primary/20";
    if (st === "pickup_assigned") return "bg-success/10 text-success border-success/20";
    if (st === "dispatched") return "bg-success/10 text-success border-success/20";
    if (st === "vendor_expired" || st === "admin_overdue") return "bg-destructive/10 text-destructive border-destructive/20";
    return "bg-muted text-muted-foreground border-muted";
  };

  // payment badge colors (existing behavior)
  const payBadgeClass = (o: OrderDoc) => {
    const l = payLabelFor(o);
    if (l === "paid") return "bg-success/10 text-success border-success/20";
    if (l === "pending" || l === "authorized") return "bg-warning/10 text-warning border-warning/20";
    if (l === "refunded" || l === "voided") return "bg-destructive/10 text-destructive border-destructive/20";
    return "bg-muted text-muted-foreground border-muted";
  };

  const timeLeftMs = (o: OrderDoc): { label: string; ms: number } | null => {
    const st = workflowFor(o);

    if (st === "vendor_pending") {
      const acceptBy = getVendorAcceptByDeadline(o);
      const remaining = getRemainingBusinessTime(acceptBy, now);
      return { label: "Accept in", ms: remaining };
    }

    if (st === "vendor_accepted" || st === "admin_overdue") {
      const planBy = getAdminPlanByDeadline(o);
      const remaining = getRemainingBusinessTime(planBy, now);
      return { label: "Admin plan in", ms: remaining };
    }

    return null;
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    return orders.filter((o) => {
      // filter by selected filter
      if (filter !== "all") {
        const [kind, val] = filter.split(":") as [string, string];

        if (kind === "wf") {
          if (workflowFor(o) !== (val as WorkflowStatus)) return false;
        } else if (kind === "pay") {
          if (payLabelFor(o) !== val) return false;
        } else if (kind === "ord") {
          if (ordLabelFor(o) !== val) return false;
        }
      }

      if (!q) return true;

      const itemsText = (o.lineItems || []).map((li) => `${li.title} x${li.quantity}`).join(" ");
      const hay = `${o.orderNumber || o.shopifyOrderId} ${customerFor(o)} ${itemsText}`.toLowerCase();
      return hay.includes(q);
    });
  }, [orders, search, filter, now]); // include now for workflowFor()

  const handleViewOrder = (o: OrderDoc) => {
    setSelected(o);
    setDetailOpen(true);
  };

  async function authedJsonPost(url: string, body: any) {
    const u = auth.currentUser;
    if (!u) throw new Error("Not logged in");
    const token = await u.getIdToken();
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data?.error || "Request failed");
    return data;
  }

  async function downloadInvoice(orderId: string, urlFromDoc?: string) {
    const u = auth.currentUser;
    if (!u) return toast.error("Please login again");
    const token = await u.getIdToken();

    const url = urlFromDoc || `/api/orders/invoice?orderId=${encodeURIComponent(orderId)}`;

    const r = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!r.ok) {
      let msg = "Failed to download invoice";
      try {
        const j = await r.json();
        msg = j?.error || msg;
      } catch {}
      toast.error(msg);
      return;
    }

    const blob = await r.blob();
    const objectUrl = window.URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = `billing-slip_${selected?.orderNumber || selected?.shopifyOrderId || orderId}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    window.URL.revokeObjectURL(objectUrl);
  }

  async function onAcceptSelected() {
    if (!selected) return;
    setActionBusy(true);
    try {
      await authedJsonPost("/api/orders/accept", { orderId: selected.id });
      toast.success("Order accepted");
    } catch (e: any) {
      toast.error(e?.message || "Failed to accept");
    } finally {
      setActionBusy(false);
    }
  }

  async function onDispatchSelected() {
    if (!selected) return;
    setActionBusy(true);
    try {
      await authedJsonPost("/api/orders/mark-dispatched", { orderId: selected.id });
      toast.success("Marked as dispatched");
    } catch (e: any) {
      toast.error(e?.message || "Failed to dispatch");
    } finally {
      setActionBusy(false);
    }
  }

  const officeStatus = getOfficeStatusMessage();
  const isOfficeOpen = isCurrentlyOfficeHours();

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Orders</h2>
          <p className="text-muted-foreground">Manage customer orders</p>
        </div>

        {/* Office Hours Status Banner */}
        <Card className={isOfficeOpen ? "border-green-200 bg-green-50" : "border-orange-200 bg-orange-50"}>
          <CardContent className="py-3">
            <div className="flex items-center gap-2">
              <Clock className={`h-4 w-4 ${isOfficeOpen ? "text-green-600" : "text-orange-600"}`} />
              <span className={`text-sm font-medium ${isOfficeOpen ? "text-green-800" : "text-orange-800"}`}>
                {officeStatus}
              </span>
              <span className="text-xs text-muted-foreground ml-2">
                (Office hours: 10 AM - 8 PM)
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
              <CardTitle>All Orders</CardTitle>

              <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
                <Select value={filter} onValueChange={(v) => setFilter(v as UiFilter)}>
                  <SelectTrigger className="w-full sm:w-56">
                    <SelectValue placeholder="Filter" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Orders</SelectItem>

                    {/* Workflow filters */}
                    <SelectItem value="wf:vendor_pending">Workflow: Pending Acceptance</SelectItem>
                    <SelectItem value="wf:vendor_accepted">Workflow: Accepted (Admin Planning)</SelectItem>
                    <SelectItem value="wf:pickup_assigned">Workflow: Pickup Assigned</SelectItem>
                    <SelectItem value="wf:dispatched">Workflow: Dispatched</SelectItem>
                    <SelectItem value="wf:vendor_expired">Workflow: Expired</SelectItem>
                    <SelectItem value="wf:admin_overdue">Workflow: Admin Overdue</SelectItem>

                    {/* Payment / Order filters (previous logic preserved) */}
                    <SelectItem value="pay:pending">Payment: Pending</SelectItem>
                    <SelectItem value="pay:paid">Payment: Paid</SelectItem>
                    <SelectItem value="pay:refunded">Payment: Refunded</SelectItem>
                    <SelectItem value="pay:voided">Payment: Voided</SelectItem>
                    <SelectItem value="ord:open">Order: Open</SelectItem>
                    <SelectItem value="ord:closed">Order: Closed</SelectItem>
                  </SelectContent>
                </Select>

                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search orders..."
                    className="pl-9"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </CardHeader>

          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Products</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {filtered.map((o) => {
                    const wf = workflowFor(o);
                    const tl = timeLeftMs(o);

                    return (
                      <TableRow key={o.id}>
                        <TableCell className="font-medium">
                          {o.orderNumber || o.shopifyOrderId}
                        </TableCell>

                        <TableCell>{customerFor(o)}</TableCell>

                        <TableCell className="max-w-xs truncate">
                          {(o.lineItems || [])
                            .map((li) => `${li.title} × ${li.quantity}`)
                            .join(", ")}
                        </TableCell>

                        <TableCell className="font-semibold">{money(o.subtotal)}</TableCell>

                        <TableCell>{new Date(o.createdAt).toLocaleString()}</TableCell>

                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <Badge className={workflowBadgeClass(wf)}>{workflowBadgeText(wf)}</Badge>

                            {tl ? (
                              <div className="text-xs text-muted-foreground">
                                {tl.ms > 0 ? (
                                  <>
                                    {tl.label}: <span className="font-medium">{fmtCountdown(tl.ms)}</span>
                                    {!isOfficeOpen && <span className="text-orange-600 ml-1">(Paused)</span>}
                                  </>
                                ) : (
                                  <span className="text-destructive">Overdue</span>
                                )}
                              </div>
                            ) : null}

                            {/* small payment badge (keeps old visibility) */}
                            <div>
                              <Badge className={payBadgeClass(o)}>{payLabelFor(o)}</Badge>
                            </div>
                          </div>
                        </TableCell>

                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" onClick={() => handleViewOrder(o)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}

                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground">
                        No orders found.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Order details dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              Order {selected?.orderNumber || selected?.shopifyOrderId}
            </DialogTitle>
          </DialogHeader>

          {selected ? (() => {
            const wf = workflowFor(selected);
            const tl = timeLeftMs(selected);
            const canAccept = wf === "vendor_pending" && !!tl && tl.ms > 0;
            const canDispatch = wf === "pickup_assigned";

            return (
              <div className="space-y-5">
                {/* Office hours notice */}
                {!isOfficeOpen && (wf === "vendor_pending" || wf === "vendor_accepted") && (
                  <div className="border border-orange-200 bg-orange-50 rounded-md p-3 text-sm">
                    <div className="flex items-center gap-2 text-orange-800">
                      <Clock className="h-4 w-4" />
                      <span className="font-medium">{officeStatus}</span>
                    </div>
                    <div className="text-orange-700 text-xs mt-1">
                      Timer is paused outside office hours and will resume at 10 AM
                    </div>
                  </div>
                )}

                {/* Top info */}
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="text-muted-foreground">Date</div>
                    <div>{new Date(selected.createdAt).toLocaleString()}</div>
                  </div>

                  <div>
                    <div className="text-muted-foreground">Customer</div>
                    <div>{customerFor(selected)}</div>
                  </div>

                  <div>
                    <div className="text-muted-foreground">Workflow Status</div>
                    <div className="flex items-center gap-2">
                      <Badge className={workflowBadgeClass(wf)}>{workflowBadgeText(wf)}</Badge>
                      {tl ? (
                        <span className="text-xs text-muted-foreground">
                          {tl.ms > 0 ? (
                            <>
                              {tl.label}: {fmtCountdown(tl.ms)}
                              {!isOfficeOpen && <span className="text-orange-600"> (Paused)</span>}
                            </>
                          ) : "Overdue"}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div>
                    <div className="text-muted-foreground">Payment</div>
                    <div className="flex items-center gap-2">
                      <Badge className={payBadgeClass(selected)}>{payLabelFor(selected)}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {ordLabelFor(selected)}
                      </span>
                    </div>
                  </div>

                  <div>
                    <div className="text-muted-foreground">Amount</div>
                    <div className="font-semibold">{money(selected.subtotal)}</div>
                  </div>

                  <div>
                    <div className="text-muted-foreground">Order ID</div>
                    <div className="text-xs">{selected.shopifyOrderId}</div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-col sm:flex-row gap-3">
                  <Button
                    onClick={onAcceptSelected}
                    disabled={!canAccept || actionBusy}
                    className="w-full sm:w-auto"
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Accept Order
                  </Button>

                  <Button
                    variant="outline"
                    onClick={onDispatchSelected}
                    disabled={!canDispatch || actionBusy}
                    className="w-full sm:w-auto"
                  >
                    <Truck className="h-4 w-4 mr-2" />
                    Mark Dispatched
                  </Button>

                  <Button
                    variant="outline"
                    onClick={() => downloadInvoice(selected.id, selected.invoice?.url)}
                    disabled={!selected.invoice?.url || actionBusy}
                    className="w-full sm:w-auto"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Download Billing Slip
                  </Button>
                </div>

                {/* Pickup / Partner details (visible after admin assigns pickup) */}
                {(wf === "pickup_assigned" || wf === "dispatched") && (
                  <div className="border rounded-md p-3 space-y-2 text-sm">
                    <div className="font-medium">Pickup & Delivery Details</div>

                    {selected.pickupPlan ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <div className="text-muted-foreground">Pickup Window</div>
                          <div>{selected.pickupPlan.pickupWindow || "—"}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Pickup Address</div>
                          <div>{selected.pickupPlan.pickupAddress || "—"}</div>
                        </div>
                        <div className="sm:col-span-2">
                          <div className="text-muted-foreground">Notes</div>
                          <div>{selected.pickupPlan.notes || "—"}</div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-muted-foreground">Pickup plan not shared yet.</div>
                    )}

                    {selected.deliveryPartner ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                        <div>
                          <div className="text-muted-foreground">Delivery Partner</div>
                          <div>{selected.deliveryPartner.name || "—"}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Phone</div>
                          <div>{selected.deliveryPartner.phone || "—"}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">ETA</div>
                          <div>{selected.deliveryPartner.etaText || "—"}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Tracking</div>
                          {selected.deliveryPartner.trackingUrl ? (
                            <a
                              href={selected.deliveryPartner.trackingUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary underline"
                            >
                              Open tracking link
                            </a>
                          ) : (
                            <div>—</div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-muted-foreground mt-2">Delivery partner not assigned yet.</div>
                    )}

                    {selected.dispatchedAt ? (
                      <div className="text-xs text-muted-foreground mt-2">
                        Dispatched at: {new Date(selected.dispatchedAt).toLocaleString()}
                      </div>
                    ) : null}
                  </div>
                )}

                {/* Items table */}
                <div className="border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead className="w-24 text-right">Qty</TableHead>
                        <TableHead className="w-28 text-right">Price</TableHead>
                        <TableHead className="w-28 text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(selected.lineItems || []).map((li, idx) => (
                        <TableRow key={idx}>
                          <TableCell>
                            <div className="flex flex-col">
                              <div className="font-medium">{li.title}</div>
                              {li.sku ? (
                                <div className="text-xs text-muted-foreground">SKU: {li.sku}</div>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">{li.quantity}</TableCell>
                          <TableCell className="text-right">{money(li.price)}</TableCell>
                          <TableCell className="text-right">{money(li.total)}</TableCell>
                        </TableRow>
                      ))}
                      {(selected.lineItems || []).length === 0 && (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center text-muted-foreground">
                            No items.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>

                <div className="text-xs text-muted-foreground">
                  Shopify Order ID: {selected.shopifyOrderId}
                </div>
              </div>
            );
          })() : null}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
