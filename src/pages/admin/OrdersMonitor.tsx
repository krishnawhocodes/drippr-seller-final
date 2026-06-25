// src/pages/admin/OrdersMonitor.tsx
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Search, Eye, ClipboardList, Clock, Download, Truck } from "lucide-react";
import { assignPickup, ordersList } from "@/lib/adminApi";

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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { auth } from "@/lib/firebase";
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
};

type WorkflowStatus =
  | "vendor_pending"
  | "vendor_accepted"
  | "pickup_assigned"
  | "dispatched"
  | "vendor_expired"
  | "admin_overdue";

type OrderDoc = {
  id: string;
  shopifyOrderId: string;
  orderNumber?: string;

  merchantId: string;

  createdAt: number;
  subtotal?: number;
  currency?: string;
  updatedAt?: number;
  status?: string; // open/closed
  financialStatus?: string;

  customerEmail?: string | null;
  raw?: { customer?: { email?: string } };

  lineItems?: LineItem[];

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

type Filter =
  | "all"
  | "needs_planning"
  | "wf:vendor_pending"
  | "wf:vendor_accepted"
  | "wf:admin_overdue"
  | "wf:pickup_assigned"
  | "wf:dispatched"
  | "wf:vendor_expired";

const THREE_HOURS = 3 * 60 * 60 * 1000;
const THIRTY_MIN = 30 * 60 * 1000;

function fmtCountdown(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export default function AdminOrdersMonitor() {
  const [planningOrder, setPlanningOrder] = useState<any | null>(null);
  const [isPlanOpen, setIsPlanOpen] = useState(false);
  const [orders, setOrders] = useState<OrderDoc[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [now, setNow] = useState(Date.now());

  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<OrderDoc | null>(null);

  const [planOpen, setPlanOpen] = useState(false);
  const [planFor, setPlanFor] = useState<OrderDoc | null>(null);

  const [busy, setBusy] = useState(false);

  // Plan form
  const [pickupWindow, setPickupWindow] = useState("");
  const [pickupAddress, setPickupAddress] = useState("");
  const [notes, setNotes] = useState("");

  const [partnerName, setPartnerName] = useState("");
  const [partnerPhone, setPartnerPhone] = useState("");
  const [etaText, setEtaText] = useState("");
  const [trackingUrl, setTrackingUrl] = useState("");

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // 🔥 Admin global watcher: all orders (recent N)
  useEffect(() => {
    let cancelled = false;
    ordersList({ limit: 500 })
      .then((result) => {
        if (!cancelled) {
          setOrders(Array.isArray(result.items) ? result.items : []);
        }
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) toast.error("Failed to load orders");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // keep selected fresh
  useEffect(() => {
    if (!selected) return;
    const fresh = orders.find((o) => o.id === selected.id);
    if (fresh) setSelected(fresh);
  }, [orders, selected?.id]);

  const currency = useMemo(() => orders.find((o) => o.currency)?.currency || "INR", [orders]);

  const money = (v: number | undefined) =>
    new Intl.NumberFormat("en-IN", { style: "currency", currency }).format(Number(v || 0));

  const customerFor = (o: OrderDoc) => o.customerEmail || o.raw?.customer?.email || "—";

  // ✅ Calculate deadline with business hours
  const getVendorAcceptByDeadline = (o: OrderDoc): number => {
    if (o.vendorAcceptBy) {
      return o.vendorAcceptBy;
    }
    return addBusinessHours(o.createdAt, THREE_HOURS);
  };

  const getAdminPlanByDeadline = (o: OrderDoc): number => {
    if (o.adminPlanBy) return o.adminPlanBy;

    const acceptedAt =
      Number(o.vendorAcceptedAt || 0) ||
      Number((o as any).updatedAt || 0) ||
      o.createdAt;

    return addBusinessHours(acceptedAt, THIRTY_MIN);
  };

  const workflowFor = (o: OrderDoc): WorkflowStatus => {
    const stored = o.workflowStatus;

    // Treat missing as vendor_pending for backward compatibility
    const base = stored || "vendor_pending";

    if (base === "vendor_pending") {
      const acceptBy = getVendorAcceptByDeadline(o);
      return now > acceptBy ? "vendor_expired" : "vendor_pending";
    }

    if (base === "vendor_accepted") {
      const planBy = getAdminPlanByDeadline(o);
      return now > planBy ? "admin_overdue" : "vendor_accepted";
    }

    if (base === "pickup_assigned") return "pickup_assigned";
    if (base === "dispatched") return "dispatched";

    return base as WorkflowStatus;
  };

  const badgeText = (st: WorkflowStatus) => {
    switch (st) {
      case "vendor_pending":
        return "Pending (Vendor)";
      case "vendor_expired":
        return "Expired";
      case "vendor_accepted":
        return "Accepted";
      case "admin_overdue":
        return "Admin Overdue";
      case "pickup_assigned":
        return "Pickup Assigned";
      case "dispatched":
        return "Dispatched";
      default:
        return st;
    }
  };

  const badgeClass = (st: WorkflowStatus) => {
    if (st === "vendor_pending") return "bg-warning/10 text-warning border-warning/20";
    if (st === "vendor_accepted") return "bg-primary/10 text-primary border-primary/20";
    if (st === "pickup_assigned" || st === "dispatched")
      return "bg-success/10 text-success border-success/20";
    if (st === "vendor_expired" || st === "admin_overdue")
      return "bg-destructive/10 text-destructive border-destructive/20";
    return "bg-muted text-muted-foreground border-muted";
  };

  const timerFor = (o: OrderDoc): { label: string; ms: number } | null => {
    const st = workflowFor(o);

    if (st === "vendor_pending") {
      const acceptBy = getVendorAcceptByDeadline(o);
      const remaining = getRemainingBusinessTime(acceptBy, now);
      return { label: "Vendor accept in", ms: remaining };
    }

    if (st === "vendor_accepted" || st === "admin_overdue") {
      const planBy = getAdminPlanByDeadline(o);
      const remaining = getRemainingBusinessTime(planBy, now);
      return { label: "Admin plan in", ms: remaining };
    }

    return null;
  };

  const counts = useMemo(() => {
    const c: Record<WorkflowStatus, number> = {
      vendor_pending: 0,
      vendor_expired: 0,
      vendor_accepted: 0,
      admin_overdue: 0,
      pickup_assigned: 0,
      dispatched: 0,
    };
    orders.forEach((o) => c[workflowFor(o)]++);
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, now]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    return orders.filter((o) => {
      const st = workflowFor(o);

      if (filter !== "all") {
        if (filter === "needs_planning") {
          if (!(st === "vendor_accepted" || st === "admin_overdue")) return false;
        } else if (filter.startsWith("wf:")) {
          const want = filter.replace("wf:", "") as WorkflowStatus;
          if (st !== want) return false;
        }
      }

      if (!q) return true;

      const itemsText = (o.lineItems || []).map((li) => li.title).join(" ");
      const hay = `${o.orderNumber || ""} ${o.shopifyOrderId || ""} ${o.merchantId || ""} ${customerFor(o)} ${itemsText}`.toLowerCase();
      return hay.includes(q);
    });
  }, [orders, search, filter, now]);

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
    a.download = `billing-slip_${orderId}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    window.URL.revokeObjectURL(objectUrl);
  }

  function openDetails(o: OrderDoc) {
    setSelected(o);
    setDetailOpen(true);
  }

  function openPlan(o: OrderDoc) {
    setPlanFor(o);
    setPlanOpen(true);

    setPickupWindow("");
    setPickupAddress("");
    setNotes("");
    setPartnerName("");
    setPartnerPhone("");
    setEtaText("");
    setTrackingUrl("");
  }

  async function submitPlan() {
    if (!planFor?.id) return;

    setBusy(true);
    try {
      await assignPickup({
        orderId: planFor.id, // ✅ FIX: use the selected order's Firestore doc id
        pickupWindow,
        pickupAddress,
        notes,
        deliveryPartner: {
          name: partnerName,
          phone: partnerPhone,
          etaText,
          trackingUrl,
        },
      });

      toast.success("Pickup assigned successfully");
      setPlanOpen(false);
      setPlanFor(null);
    } catch (e: any) {
      toast.error(e?.message || "Failed to assign pickup");
    } finally {
      setBusy(false);
    }
  }

  const officeStatus = getOfficeStatusMessage();
  const isOfficeOpen = isCurrentlyOfficeHours();

  return (
    <>
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Orders Monitor</h2>
          <p className="text-muted-foreground">Admin view of all orders end-to-end</p>
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
            <div className="flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                <div className="space-y-1">
                  <CardTitle>All Orders</CardTitle>
                  <div className="text-sm text-muted-foreground flex flex-wrap gap-3 items-center">
                    <span className="flex items-center gap-1">
                      <Clock className="h-4 w-4" /> Pending: <b>{counts.vendor_pending}</b>
                    </span>
                    <span className="flex items-center gap-1 text-destructive">
                      <Clock className="h-4 w-4" /> Expired: <b>{counts.vendor_expired}</b>
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-4 w-4" /> Accepted: <b>{counts.vendor_accepted}</b>
                    </span>
                    <span className="flex items-center gap-1 text-destructive">
                      <Clock className="h-4 w-4" /> Admin Overdue: <b>{counts.admin_overdue}</b>
                    </span>
                    <span className="flex items-center gap-1">
                      <ClipboardList className="h-4 w-4" /> Pickup Assigned: <b>{counts.pickup_assigned}</b>
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-4 w-4" /> Dispatched: <b>{counts.dispatched}</b>
                    </span>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
                  <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
                    <SelectTrigger className="w-full sm:w-56">
                      <SelectValue placeholder="Filter" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="needs_planning">Needs Planning (Accepted)</SelectItem>
                      <SelectItem value="wf:vendor_pending">Workflow: Pending</SelectItem>
                      <SelectItem value="wf:vendor_expired">Workflow: Expired</SelectItem>
                      <SelectItem value="wf:vendor_accepted">Workflow: Accepted</SelectItem>
                      <SelectItem value="wf:admin_overdue">Workflow: Admin Overdue</SelectItem>
                      <SelectItem value="wf:pickup_assigned">Workflow: Pickup Assigned</SelectItem>
                      <SelectItem value="wf:dispatched">Workflow: Dispatched</SelectItem>
                    </SelectContent>
                  </Select>

                  <div className="relative w-full sm:w-72">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search order / merchant / customer / item..."
                      className="pl-9"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
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
                    <TableHead>Merchant</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Workflow</TableHead>
                    <TableHead>Timer</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {filtered.map((o) => {
                    const st = workflowFor(o);
                    const t = timerFor(o);
                    const canPlan = st === "vendor_accepted" || st === "admin_overdue";
                    const canInvoice =
                      st === "vendor_accepted" || st === "admin_overdue" || st === "pickup_assigned" || st === "dispatched";

                    return (
                      <TableRow key={o.id}>
                        <TableCell className="font-medium">
                          {o.orderNumber || o.shopifyOrderId || o.id}
                        </TableCell>

                        <TableCell className="text-xs">{o.merchantId}</TableCell>

                        <TableCell>{customerFor(o)}</TableCell>

                        <TableCell className="font-semibold">{money(o.subtotal)}</TableCell>

                        <TableCell>{new Date(o.createdAt || Date.now()).toLocaleString()}</TableCell>

                        <TableCell>
                          <Badge className={badgeClass(st)}>{badgeText(st)}</Badge>
                        </TableCell>

                        <TableCell>
                          {t ? (
                            <div className="flex flex-col gap-1">
                              <div className="text-xs text-muted-foreground">{t.label}</div>
                              <div className={t.ms > 0 ? "font-medium" : "font-medium text-destructive"}>
                                {t.ms > 0 ? (
                                  <>
                                    {fmtCountdown(t.ms)}
                                    {!isOfficeOpen && <span className="text-orange-600 text-xs ml-1">(Paused)</span>}
                                  </>
                                ) : "Overdue"}
                              </div>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>

                        <TableCell className="text-right">
                          <div className="flex gap-2 justify-end">
                            <Button variant="ghost" size="icon" onClick={() => openDetails(o)}>
                              <Eye className="h-4 w-4" />
                            </Button>

                            <Button onClick={() => openPlan(o)} disabled={!canPlan || busy}>
                              <ClipboardList className="h-4 w-4 mr-2" />
                              Plan Pickup
                            </Button>

                            <Button
                              variant="outline"
                              onClick={() => downloadInvoice(o.id, o.invoice?.url)}
                              disabled={!canInvoice || busy}
                            >
                              <Download className="h-4 w-4 mr-2" />
                              Invoice
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}

                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground">
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

      {/* DETAILS */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              Order Details — {selected?.orderNumber || selected?.shopifyOrderId || selected?.id}
            </DialogTitle>
          </DialogHeader>

          {selected && (
            <div className="space-y-4 text-sm">
              {/* Office hours notice */}
              {!isOfficeOpen && (workflowFor(selected) === "vendor_pending" || workflowFor(selected) === "vendor_accepted") && (
                <div className="border border-orange-200 bg-orange-50 rounded-md p-3">
                  <div className="flex items-center gap-2 text-orange-800">
                    <Clock className="h-4 w-4" />
                    <span className="font-medium">{officeStatus}</span>
                  </div>
                  <div className="text-orange-700 text-xs mt-1">
                    Timer is paused outside office hours and will resume at 10 AM
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="text-muted-foreground">Merchant</div>
                  <div className="text-xs">{selected.merchantId}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Customer</div>
                  <div>{customerFor(selected)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Created</div>
                  <div>{new Date(selected.createdAt || Date.now()).toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Workflow</div>
                  <div>
                    <Badge className={badgeClass(workflowFor(selected))}>
                      {badgeText(workflowFor(selected))}
                    </Badge>
                  </div>
                </div>
              </div>

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
                          No items
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              {(selected.pickupPlan || selected.deliveryPartner) && (
                <div className="border rounded-md p-3 space-y-2">
                  <div className="font-medium">Pickup & Delivery</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <div className="text-muted-foreground">Pickup Window</div>
                      <div>{selected.pickupPlan?.pickupWindow || "—"}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Pickup Address</div>
                      <div>{selected.pickupPlan?.pickupAddress || "—"}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Partner</div>
                      <div>{selected.deliveryPartner?.name || "—"}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Phone</div>
                      <div>{selected.deliveryPartner?.phone || "—"}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">ETA</div>
                      <div>{selected.deliveryPartner?.etaText || "—"}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Tracking</div>
                      {selected.deliveryPartner?.trackingUrl ? (
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
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* PLAN PICKUP */}
      <Dialog open={planOpen} onOpenChange={setPlanOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              Plan Pickup — {planFor?.orderNumber || planFor?.shopifyOrderId || planFor?.id}
            </DialogTitle>
          </DialogHeader>

          {planFor && (
            <div className="space-y-4">
              {/* Office hours notice */}
              {!isOfficeOpen && (
                <div className="border border-orange-200 bg-orange-50 rounded-md p-3 text-sm">
                  <div className="flex items-center gap-2 text-orange-800">
                    <Clock className="h-4 w-4" />
                    <span className="font-medium">{officeStatus}</span>
                  </div>
                  <div className="text-orange-700 text-xs mt-1">
                    Timer is paused and will resume at 10 AM
                  </div>
                </div>
              )}

              <div className="text-sm">
                <div className="text-muted-foreground">Timer</div>
                {(() => {
                  const t = timerFor(planFor);
                  if (!t) return <div className="text-muted-foreground">—</div>;
                  return (
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4" />
                      <span className={t.ms > 0 ? "font-medium" : "font-medium text-destructive"}>
                        {t.ms > 0 ? (
                          <>
                            {fmtCountdown(t.ms)}
                            {!isOfficeOpen && <span className="text-orange-600 text-xs ml-1">(Paused)</span>}
                          </>
                        ) : "Overdue"}
                      </span>
                    </div>
                  );
                })()}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  placeholder='Pickup Window (e.g. "Today 4-6 PM")'
                  value={pickupWindow}
                  onChange={(e) => setPickupWindow(e.target.value)}
                />
                <Input
                  placeholder="Pickup Address"
                  value={pickupAddress}
                  onChange={(e) => setPickupAddress(e.target.value)}
                />
                <Input
                  placeholder="Notes (optional)"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
                <div />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  placeholder="Delivery Partner Name"
                  value={partnerName}
                  onChange={(e) => setPartnerName(e.target.value)}
                />
                <Input
                  placeholder="Delivery Partner Phone"
                  value={partnerPhone}
                  onChange={(e) => setPartnerPhone(e.target.value)}
                />
                <Input
                  placeholder='ETA text (e.g. "Arriving in 45 min")'
                  value={etaText}
                  onChange={(e) => setEtaText(e.target.value)}
                />
                <Input
                  placeholder="Tracking URL (optional)"
                  value={trackingUrl}
                  onChange={(e) => setTrackingUrl(e.target.value)}
                />
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <Button onClick={submitPlan} disabled={busy}>
                  <Truck className="h-4 w-4 mr-2" />
                  Assign Pickup
                </Button>
                <Button variant="outline" onClick={() => setPlanOpen(false)} disabled={busy}>
                  Cancel
                </Button>
              </div>

              <div className="text-xs text-muted-foreground">
                Planning works only when vendor has accepted (or admin overdue).
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
