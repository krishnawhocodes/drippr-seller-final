// src/pages/admin/OrdersMonitor.tsx
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Search,
  ClipboardList,
  Clock,
  Download,
  Truck,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Info,
} from "lucide-react";
import {
  assignPickup,
  ordersList,
  updateOrderCustomer,
  uploadAdminFile,
} from "@/lib/adminApi";
import {
  PAYMENT_DOT_CLASS,
  PAYMENT_TEXT_CLASS,
  paymentLabel,
  paymentTone,
} from "@/lib/orderPayment";
import {
  INDIAN_STATES,
  customerDetailsComplete,
  formatCustomerAddress,
  missingCustomerFields,
  normalizeCustomerAddress,
  type CustomerAddress,
} from "@/lib/orderCustomer";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { generateInvoicePdf } from "@/lib/generateInvoicePdf";
import type { InvoiceMerchant } from "@/lib/generateInvoicePdf";

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
  name?: string;
  sku?: string;
  variantTitle?: string;
  quantity: number;
  price: number;
  total: number;
  discount?: number;
  discountedTotal?: number;
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
  discountedSubtotal?: number;
  totalDiscounts?: number;
  totalPrice?: number;
  currency?: string;
  updatedAt?: number;
  status?: string; // open/closed
  financialStatus?: string;

  customerEmail?: string | null;
  customerName?: string | null;
  raw?: { customer?: { email?: string } };
  shippingAddress?: {
    name?: string;
    address1?: string;
    address2?: string;
    city?: string;
    province?: string;
    zip?: string;
    country?: string;
    phone?: string;
  } | null;

  lineItems?: LineItem[];

  workflowStatus?: WorkflowStatus;
  vendorAcceptBy?: number;
  vendorAcceptedAt?: number | null;

  adminPlanBy?: number | null;
  adminPlannedAt?: number | null;

  pickupPlan?: {
    pickupWindow?: string | null;
    pickupAddress?: string | null;
    customerAddress?: string | null;
    deliveryScope?: "same_city" | "different_city" | null;
    notes?: string | null;
  } | null;

  deliveryPartner?: {
    name?: string | null;
    phone?: string | null;
    etaText?: string | null;
    trackingUrl?: string | null;
  } | null;

  dispatchedAt?: number | null;

  // Seller profile attached by orders.list, used to prefill the pickup address
  merchant?: {
    name?: string;
    storeName?: string;
    businessName?: string;
    email?: string;
    phone?: string;
    address?: string;
    city?: string;
    state?: string;
    pincode?: string;
    gstin?: string;
  } | null;

  shippingLabel?: {
    url?: string;
    name?: string;
    uploadedAt?: number;
  } | null;

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

/** Loose place comparison: "New Delhi" and "new delhi." are the same place. */
function samePlace(a: unknown, b: unknown) {
  const key = (value: unknown) =>
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z]/g, "");
  const left = key(a);
  const right = key(b);
  return Boolean(left && right && left === right);
}

type DeliveryScopeGuess = {
  scope: "same_city" | "different_city";
  /** How the guess was reached, so the admin knows how far to trust it. */
  basis: "city" | "state" | "none";
  reason: string;
};

/**
 * Suggests whether an order leaves the seller's city.
 *
 * Cities are the precise signal, but Shopify withholds the buyer's city from
 * apps without protected customer data access while still sending the
 * province. Falling back to the state keeps the suggestion useful on those
 * orders: a Delhi seller shipping to Madhya Pradesh is certainly out of city,
 * even though the city itself is unknown. Same-state is deliberately NOT
 * treated as same-city, because that is the one case the state cannot settle.
 */
function guessDeliveryScope(
  order: Pick<OrderDoc, "merchant" | "shippingAddress">,
): DeliveryScopeGuess {
  const sellerCity = order.merchant?.city;
  const buyerCity = order.shippingAddress?.city;
  if (sellerCity && buyerCity) {
    const same = samePlace(sellerCity, buyerCity);
    return {
      scope: same ? "same_city" : "different_city",
      basis: "city",
      reason: same
        ? `Both in ${String(sellerCity).trim()}.`
        : `${String(sellerCity).trim()} → ${String(buyerCity).trim()}.`,
    };
  }

  const sellerState = order.merchant?.state;
  const buyerState = order.shippingAddress?.province;
  if (sellerState && buyerState && !samePlace(sellerState, buyerState)) {
    return {
      scope: "different_city",
      basis: "state",
      reason: `${String(sellerState).trim()} → ${String(buyerState).trim()}, so it leaves the city.`,
    };
  }

  return {
    scope: "different_city",
    basis: "none",
    reason: sellerState && buyerState
      ? `Both in ${String(buyerState).trim()}, but the delivery city is missing — please confirm.`
      : "Seller or customer location is missing, so this could not be detected — please confirm.",
  };
}

/** True once the address has enough detail for a parcel to be delivered. */
function addressIsDeliverable(address: OrderDoc["shippingAddress"]) {
  return Boolean(
    String(address?.address1 || "").trim() && String(address?.city || "").trim(),
  );
}

/** Flatten the Shopify delivery address into the form's textarea. */
function formatShopifyAddress(address: OrderDoc["shippingAddress"]) {
  if (!address) return "";
  const cityLine = [address.city, address.province, address.zip]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(", ");
  return [
    address.name,
    address.address1,
    address.address2,
    cityLine,
    address.country,
    address.phone ? `Phone: ${address.phone}` : "",
  ]
    .map((line) => String(line || "").trim())
    .filter(Boolean)
    .join("\n");
}

function fmtCountdown(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export default function AdminOrdersMonitor() {
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
  // Plan Pickup runs in two steps: confirm who the parcel is going to, then
  // arrange the pickup itself. The invoice is built from step one, so it has
  // to be settled before anything else is decided.
  const [planStep, setPlanStep] = useState<"customer" | "pickup">("customer");
  // "customer_only" reuses the same first step to fill in the buyer on an
  // order that was planned or shipped before details were being captured,
  // without re-running the pickup transition.
  const [planMode, setPlanMode] = useState<"full" | "customer_only">("full");
  const [customer, setCustomer] = useState<CustomerAddress>({});
  const [customerEmail, setCustomerEmail] = useState("");
  const [labelFile, setLabelFile] = useState<File | null>(null);
  const [deliveryScope, setDeliveryScope] = useState<
    "same_city" | "different_city"
  >("different_city");

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // 🔥 Admin global watcher: all orders (recent N) — polls every 30s
  const fetchOrders = () => {
    ordersList({ limit: 500 })
      .then((result) => {
        setOrders(Array.isArray(result.items) ? result.items : []);
      })
      .catch((err) => {
        console.error(err);
        toast.error("Failed to load orders");
      });
  };

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 30_000);
    return () => clearInterval(interval);
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

  const customerFor = (o: OrderDoc) =>
    o.customerName || o.customerEmail || o.raw?.customer?.email || "—";


  // ✅ Calculate deadline with business hours
  const getVendorAcceptByDeadline = (o: OrderDoc): number => {
    if (o.vendorAcceptBy) {
      return o.vendorAcceptBy;
    }
    return addBusinessHours(o.createdAt, THREE_HOURS);
  };

  const workflowFor = (o: OrderDoc): WorkflowStatus => {
    const stored = o.workflowStatus;

    // Treat missing as vendor_pending for backward compatibility
    const base = stored || "vendor_pending";

    if (base === "vendor_pending") {
      const acceptBy = getVendorAcceptByDeadline(o);
      return now > acceptBy ? "vendor_expired" : "vendor_pending";
    }

    // Admin is NOT time-bound — always show "vendor_accepted" (no admin_overdue)
    if (base === "vendor_accepted") return "vendor_accepted";

    if (base === "pickup_assigned") return "pickup_assigned";
    if (base === "dispatched") return "dispatched";

    return base as WorkflowStatus;
  };

  // Operational wording: each label says whose move it is.
  const badgeText = (st: WorkflowStatus) => {
    switch (st) {
      case "vendor_pending":
        return "Awaiting seller";
      case "vendor_expired":
        return "Seller missed";
      case "vendor_accepted":
        return "Needs planning";
      case "admin_overdue":
        return "Overdue";
      case "pickup_assigned":
        return "Pickup assigned";
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

  const timerFor = (
    o: OrderDoc,
  ): { label: string; ms: number; paused: boolean } | null => {
    const st = workflowFor(o);

    if (st === "vendor_pending") {
      const acceptBy = getVendorAcceptByDeadline(o);
      const remaining = getRemainingBusinessTime(acceptBy, now);
      // No business time left before a deadline that has not yet arrived means
      // the clock is parked outside office hours, not that the seller missed
      // it. Orders created before deadlines became office-hours aware still
      // carry a raw createdAt + 3h, which lands here.
      const paused = remaining <= 0 && acceptBy > now;
      return { label: "Vendor accept in", ms: remaining, paused };
    }

    // Admin has no time limit — no timer shown for vendor_accepted
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

  async function downloadInvoice(order: OrderDoc) {
    // The invoice bills to the captured address; without it the document
    // would go out with an empty BILL TO and the wrong place of supply.
    const missing = missingCustomerFields(order.shippingAddress);
    if (missing.length) {
      toast.error(
        "Capture the customer's " +
          missing.join(", ") +
          " in Plan Pickup before downloading the invoice.",
      );
      return;
    }
    const u = auth.currentUser;
    if (!u) return toast.error("Please login again");

    setBusy(true);
    try {
      // orders.list already attaches the seller profile. The previous code
      // read `data.merchants` from merchants.list, which returns `items`, so
      // merchantInfo was always null and every invoice shipped without a
      // "Sold by" block or GSTIN (and therefore always fell back to IGST).
      const merchantInfo: InvoiceMerchant | null = order.merchant
        ? {
            storeName: order.merchant.storeName || "",
            businessName: order.merchant.businessName || "",
            name: order.merchant.name || "",
            address: order.merchant.address || "",
            city: order.merchant.city || "",
            state: order.merchant.state || "",
            pincode: order.merchant.pincode || "",
            gstin: order.merchant.gstin || "",
            phone: order.merchant.phone || "",
            email: order.merchant.email || "",
          }
        : null;

      const blob = await generateInvoicePdf({
        type: "invoice",
        order: {
          orderNumber: order.orderNumber,
          shopifyOrderId: order.shopifyOrderId,
          createdAt: order.createdAt,
          lineItems: order.lineItems,
          subtotal: order.subtotal,
          discountedSubtotal: order.discountedSubtotal,
          totalDiscounts: order.totalDiscounts,
          totalPrice: order.totalPrice,
          currency: order.currency,
          financialStatus: order.financialStatus,
          customerEmail: order.customerEmail || order.raw?.customer?.email,
          customerName: order.customerName,
          shippingAddress: order.shippingAddress,
        },
        merchant: merchantInfo,
      });

      const objectUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `invoice_${order.orderNumber || order.shopifyOrderId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(objectUrl);

      toast.success("Invoice downloaded!");
    } catch (err: any) {
      toast.error("Failed to generate invoice: " + (err?.message || err));
    } finally {
      setBusy(false);
    }
  }

  function openDetails(o: OrderDoc) {
    setSelected(o);
    setDetailOpen(true);
  }

  function openPlan(o: OrderDoc) {
    setPlanMode("full");
    setPlanFor(o);
    setPlanOpen(true);

    // Start on the pickup step when the buyer's details are already complete,
    // so a store that does get them from Shopify is not made to re-confirm
    // an address nobody changed.
    const known = normalizeCustomerAddress(o.shippingAddress);
    setCustomer(known);
    setCustomerEmail(o.customerEmail || "");
    setPlanStep(customerDetailsComplete(known) ? "pickup" : "customer");

    setPickupWindow("");
    // Prefilled from the seller who owns the product; stays editable.
    setPickupAddress(o.merchant?.address || "");
    // Suggested from the two locations; the admin always decides.
    setDeliveryScope(guessDeliveryScope(o).scope);
    setNotes("");
    setPartnerName("");
    setPartnerPhone("");
    setEtaText("");
    setTrackingUrl("");
    setLabelFile(null);
  }

  const setCustomerField = (key: keyof CustomerAddress, value: string) =>
    setCustomer((current) => ({ ...current, [key]: value }));

  /** Fill in the buyer on an order that is already past planning. */
  function openCustomerEdit(o: OrderDoc) {
    setPlanMode("customer_only");
    setPlanFor(o);
    setPlanStep("customer");
    setCustomer(normalizeCustomerAddress(o.shippingAddress));
    setCustomerEmail(o.customerEmail || "");
    setDetailOpen(false);
    setPlanOpen(true);
  }

  async function saveCustomerOnly() {
    if (!planFor?.id) return;
    const missing = missingCustomerFields(customer);
    if (missing.length) {
      toast.error("Still needed: " + missing.join(", ") + ".");
      return;
    }
    setBusy(true);
    try {
      await updateOrderCustomer(planFor.id, {
        ...normalizeCustomerAddress(customer),
        email: customerEmail.trim(),
      });
      toast.success("Customer details saved. The invoice is now available.");
      setPlanOpen(false);
      setPlanFor(null);
      fetchOrders();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save the details",
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * Takes over an order the seller let expire. Without this the order is
   * unfulfillable: the seller can no longer accept it and a pickup cannot be
   * planned for something still sitting in vendor_pending.
   */
  async function acceptForSeller(order: OrderDoc) {
    setBusy(true);
    try {
      await authedJsonPost("/api/orders/accept", { orderId: order.id });
      toast.success(`Accepted ${order.orderNumber || order.id} for the seller`);
      fetchOrders();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not accept the order",
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitPlan() {
    if (!planFor?.id) return;

    setBusy(true);
    try {
      // Re-check here as well as on the server: the invoice bills to these,
      // and an order planned without them cannot be invoiced at all.
      const missing = missingCustomerFields(customer);
      if (missing.length) {
        setPlanStep("customer");
        toast.error("Customer details still needed: " + missing.join(", "));
        return;
      }

      // Upload the label first so a failed upload does not leave the order
      // marked as planned without its label. Every parcel carries one: DRIPPR
      // prints the local ones, the courier returns the rest.
      if (!labelFile) {
        toast.error(
          deliveryScope === "same_city"
            ? "Upload the DRIPPR shipping label for this local delivery."
            : "Upload the courier's shipping label for this delivery.",
        );
        return;
      }

      let shippingLabel: { url: string; name?: string } | null = null;
      if (labelFile) {
        try {
          shippingLabel = await uploadAdminFile(labelFile, "/shipping-labels");
        } catch (error) {
          toast.error(
            `Shipping label upload failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return;
        }
      }

      await assignPickup({
        orderId: planFor.id, // use the selected order's Firestore doc id
        pickupWindow,
        pickupAddress,
        customerDetails: {
          ...normalizeCustomerAddress(customer),
          email: customerEmail.trim(),
        },
        deliveryScope,
        notes,
        shippingLabel,
        deliveryPartner: {
          name: partnerName,
          phone: partnerPhone,
          etaText,
          trackingUrl,
        },
      });

      toast.success("Pickup assigned. The invoice is now available.");
      setPlanOpen(false);
      setPlanFor(null);
      fetchOrders();
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
          <div className="flex items-center gap-3">
            <h2 className="text-3xl font-bold tracking-tight">Orders Monitor</h2>
            <Button variant="outline" size="icon" onClick={fetchOrders} title="Refresh orders">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-muted-foreground">Admin view of all orders end-to-end (auto-refreshes every 30s)</p>
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
                (Office hours: 9 AM - 9 PM)
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
                      <Clock className="h-4 w-4" /> Awaiting seller: <b>{counts.vendor_pending}</b>
                    </span>
                    <span className="flex items-center gap-1 text-destructive">
                      <Clock className="h-4 w-4" /> Seller missed: <b>{counts.vendor_expired}</b>
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-4 w-4" /> Needs planning: <b>{counts.vendor_accepted}</b>
                    </span>
                    <span className="flex items-center gap-1">
                      <ClipboardList className="h-4 w-4" /> Pickup assigned: <b>{counts.pickup_assigned}</b>
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
                      <SelectItem value="needs_planning">Needs planning</SelectItem>
                      <SelectItem value="wf:vendor_pending">Awaiting seller</SelectItem>
                      <SelectItem value="wf:vendor_expired">Seller missed</SelectItem>
                      <SelectItem value="wf:vendor_accepted">Accepted by seller</SelectItem>
                      <SelectItem value="wf:admin_overdue">Overdue</SelectItem>
                      <SelectItem value="wf:pickup_assigned">Pickup assigned</SelectItem>
                      <SelectItem value="wf:dispatched">Dispatched</SelectItem>
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
            {/* Fixed columns that wrap, so a desktop window needs no
                sideways scrolling. A phone cannot fit six columns whatever we
                do, so it scrolls there rather than clipping them away. */}
            <div className="w-full overflow-x-auto">
              <Table className="w-full min-w-[780px] table-fixed">
                <TableHeader>
                  <TableRow>
                    {/* Fixed pixel widths for everything that has a known
                        size, so the item column absorbs the slack instead of
                        the action buttons being squeezed out of their cell. */}
                    <TableHead className="w-[104px]">Order</TableHead>
                    <TableHead className="w-[15%]">Seller</TableHead>
                    <TableHead>Item &amp; SKU</TableHead>
                    <TableHead className="w-[96px] text-right">Amount</TableHead>
                    <TableHead className="w-[150px]">Status</TableHead>
                    <TableHead className="w-[124px] text-right">&nbsp;</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {filtered.map((o) => {
                    const st = workflowFor(o);
                    const t = timerFor(o);
                    const canPlan = st === "vendor_accepted" || st === "admin_overdue";
                    const items = o.lineItems || [];
                    const first = items[0];

                    return (
                      <TableRow key={o.id} className="align-top">
                        <TableCell className="font-medium">
                          <div className="truncate">
                            {o.orderNumber || o.shopifyOrderId || o.id}
                          </div>
                          <div className="text-xs font-normal text-muted-foreground">
                            {new Date(o.createdAt || Date.now()).toLocaleDateString()}
                          </div>
                          <div className="text-xs font-normal text-muted-foreground">
                            {new Date(o.createdAt || Date.now()).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </div>
                        </TableCell>

                        <TableCell>
                          <div className="line-clamp-2 text-sm">
                            {o.merchant?.storeName || o.merchant?.name || "—"}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {customerFor(o)}
                          </div>
                        </TableCell>

                        {/* Sellers identify what to pull off the shelf by SKU,
                            not by the marketing title, so it is shown here
                            rather than hidden behind the detail view. */}
                        <TableCell>
                          {first ? (
                            <>
                              <div className="line-clamp-2 text-sm">
                                {first.name || first.title}
                              </div>
                              {/* Only printed when Shopify actually sent one;
                                  an empty placeholder is worse than nothing. */}
                              {first.sku ? (
                                <div className="truncate font-mono text-xs text-muted-foreground">
                                  {first.sku}
                                </div>
                              ) : null}
                              {items.length > 1 && (
                                <div className="text-xs text-muted-foreground">
                                  +{items.length - 1} more item
                                  {items.length > 2 ? "s" : ""}
                                </div>
                              )}
                            </>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>

                        <TableCell className="text-right font-semibold">
                          {money(o.discountedSubtotal ?? o.subtotal)}
                        </TableCell>

                        <TableCell>
                          <Badge
                            className={`${badgeClass(st)} whitespace-nowrap`}
                          >
                            {badgeText(st)}
                          </Badge>
                          {/* Payment sits quieter than the workflow badge:
                              two filled badges read as two competing
                              statuses, and only one is being acted on. */}
                          <div
                            className={`mt-1.5 flex items-center gap-1.5 whitespace-nowrap text-xs ${PAYMENT_TEXT_CLASS[paymentTone(o.financialStatus)]}`}
                          >
                            <span
                              className={`h-1.5 w-1.5 shrink-0 rounded-full ${PAYMENT_DOT_CLASS[paymentTone(o.financialStatus)]}`}
                            />
                            {paymentLabel(o.financialStatus)}
                          </div>
                        </TableCell>

                        <TableCell className="text-right">
                          <div className="flex flex-col items-end gap-1.5">
                            {/* Unlabelled on purpose: a bare countdown reads as
                                urgency, and it only appears while one is
                                actually running. */}
                            {t && (
                              <span
                                className={
                                  t.ms > 0 || t.paused
                                    ? "font-mono text-xs text-muted-foreground"
                                    : "font-mono text-xs font-medium text-destructive"
                                }
                                title={t.paused ? "Paused until the office opens" : t.label}
                              >
                                {t.ms > 0
                                  ? fmtCountdown(t.ms) + (isOfficeOpen ? "" : " ⏸")
                                  : t.paused
                                    ? "Paused ⏸"
                                    : "Overdue"}
                              </span>
                            )}

                            <div className="flex flex-wrap items-center justify-end gap-1">
                              {st === "vendor_expired" ? (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  className="h-8 px-2"
                                  onClick={() => acceptForSeller(o)}
                                  disabled={busy}
                                  title="The seller missed the window. Accept on their behalf so this order can still ship."
                                >
                                  <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                                  Accept
                                </Button>
                              ) : canPlan ? (
                                <Button
                                  size="sm"
                                  className="h-8 px-2"
                                  onClick={() => openPlan(o)}
                                  disabled={busy}
                                >
                                  <ClipboardList className="mr-1 h-3.5 w-3.5" />
                                  Plan
                                </Button>
                              ) : null}

                              {/* Everything else about the order, including
                                  the invoice and the label, lives behind this
                                  one button. */}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => openDetails(o)}
                                title="Order details, invoice and shipping label"
                                aria-label="Order details"
                              >
                                <Info className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}

                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground">
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
        <DialogContent className="flex max-w-3xl flex-col gap-0 p-0">
          <DialogHeader className="shrink-0 border-b px-6 py-4 pr-12">
            <DialogTitle>
              Order Details — {selected?.orderNumber || selected?.shopifyOrderId || selected?.id}
            </DialogTitle>
          </DialogHeader>

          {selected && (
            <div className="min-h-0 space-y-4 overflow-y-auto px-6 py-5 text-sm">
              {/* Office hours notice */}
              {!isOfficeOpen && (workflowFor(selected) === "vendor_pending" || workflowFor(selected) === "vendor_accepted") && (
                <div className="border border-orange-200 bg-orange-50 rounded-md p-3">
                  <div className="flex items-center gap-2 text-orange-800">
                    <Clock className="h-4 w-4" />
                    <span className="font-medium">{officeStatus}</span>
                  </div>
                  <div className="text-orange-700 text-xs mt-1">
                    Timer is paused outside office hours and will resume at 9 AM
                  </div>
                </div>
              )}

              {(() => {
                const ready = customerDetailsComplete(selected.shippingAddress);
                const label = selected.shippingLabel;
                return (
                  <div className="space-y-2 rounded-md border p-3">
                    <div className="font-medium">Documents</div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => downloadInvoice(selected)}
                        disabled={busy || !ready}
                        title={
                          ready
                            ? "Download the GST tax invoice"
                            : "Capture the customer's details in Plan Pickup first"
                        }
                      >
                        <Download className="mr-2 h-4 w-4" />
                        Invoice
                      </Button>

                      {label?.url ? (
                        <Button size="sm" variant="outline" asChild>
                          <a href={label.url} target="_blank" rel="noreferrer">
                            <Download className="mr-2 h-4 w-4" />
                            Shipping label
                          </a>
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" disabled>
                          <Download className="mr-2 h-4 w-4" />
                          Shipping label
                        </Button>
                      )}
                    </div>
                    {!ready ? (
                      <div className="space-y-2">
                        <p className="flex gap-1.5 text-xs text-amber-700">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span>
                            The invoice needs the buyer&rsquo;s{" "}
                            {missingCustomerFields(selected.shippingAddress).join(", ")}
                            .
                          </span>
                        </p>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => openCustomerEdit(selected)}
                          disabled={busy}
                        >
                          Add customer details
                        </Button>
                      </div>
                    ) : !label?.url ? (
                      <p className="text-xs text-muted-foreground">
                        The shipping label is uploaded when the pickup is planned.
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {label.name}
                        {label.uploadedAt
                          ? " · " + new Date(label.uploadedAt).toLocaleString()
                          : ""}
                      </p>
                    )}
                  </div>
                );
              })()}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="text-muted-foreground">Seller</div>
                  <div title={selected.merchantId}>
                    {selected.merchant?.storeName ||
                      selected.merchant?.name ||
                      "Unknown seller"}
                  </div>
                  {selected.merchant?.phone ? (
                    <div className="text-xs text-muted-foreground">
                      {selected.merchant.phone}
                    </div>
                  ) : null}
                </div>
                <div>
                  <div className="text-muted-foreground">Customer</div>
                  <div>
                    {selected.customerName || (
                      <span className="text-muted-foreground">
                        Not captured yet
                      </span>
                    )}
                  </div>
                  {selected.customerEmail ? (
                    <div className="text-xs text-muted-foreground">
                      {selected.customerEmail}
                    </div>
                  ) : null}
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

              <div className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium">Delivery Address</div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => openCustomerEdit(selected)}
                    disabled={busy}
                  >
                    Edit
                  </Button>
                </div>
                {(() => {
                  // Once pickup is planned, the address the admin confirmed is
                  // the one the courier was given, so it wins over whatever
                  // Shopify was willing to send.
                  const planned = String(
                    selected.pickupPlan?.customerAddress || "",
                  ).trim();
                  const fromShopify = formatShopifyAddress(
                    selected.shippingAddress,
                  );
                  const shown = planned || fromShopify;

                  return (
                    <>
                      {shown ? (
                        <div className="whitespace-pre-line text-sm">{shown}</div>
                      ) : (
                        <div className="text-muted-foreground">
                          Shopify did not send a delivery address for this order.
                        </div>
                      )}
                      {planned ? (
                        <p className="text-xs text-muted-foreground">
                          Confirmed when the pickup was planned.
                        </p>
                      ) : !addressIsDeliverable(selected.shippingAddress) ? (
                        <p className="flex gap-1.5 text-xs leading-relaxed text-amber-700">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span>
                            No street address — either this order has none,
                            or the store's plan withholds Level 2 customer data
                            (name, phone, street, PIN) from custom apps. Fill it
                            in when planning the pickup.
                          </span>
                        </p>
                      ) : null}
                    </>
                  );
                })()}
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
                            <div className="font-medium">{li.name || li.title}</div>
                            {li.sku ? (
                              <div className="font-mono text-xs text-muted-foreground">
                                {li.sku}
                              </div>
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
        <DialogContent className="flex max-w-3xl flex-col gap-0 p-0">
          <DialogHeader className="shrink-0 border-b px-6 py-4 pr-12">
            <DialogTitle>
              {planMode === "full" ? "Plan Pickup" : "Customer Details"} &mdash;{" "}
              {planFor?.orderNumber || planFor?.shopifyOrderId || planFor?.id}
            </DialogTitle>
            {planMode === "full" ? (
              <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
                <span
                  className={
                    planStep === "customer" ? "font-medium text-foreground" : ""
                  }
                >
                  1. Customer details
                </span>
                <span>&rarr;</span>
                <span
                  className={
                    planStep === "pickup" ? "font-medium text-foreground" : ""
                  }
                >
                  2. Pickup &amp; label
                </span>
              </div>
            ) : (
              <div className="pt-1 text-xs text-muted-foreground">
                Filling in the buyer so this order can be invoiced.
              </div>
            )}
          </DialogHeader>

          {planFor && (
            <div className="min-h-0 space-y-4 overflow-y-auto px-6 py-5">
              {!isOfficeOpen && (
                <div className="rounded-md border border-orange-200 bg-orange-50 p-3 text-sm">
                  <div className="flex items-center gap-2 text-orange-800">
                    <Clock className="h-4 w-4" />
                    <span className="font-medium">{officeStatus}</span>
                  </div>
                  <div className="mt-1 text-xs text-orange-700">
                    Timer is paused and will resume at 9 AM
                  </div>
                </div>
              )}

              {/* ---------------- STEP 1: who the parcel goes to ----------- */}
              {planStep === "customer" ? (
                <>
                  <div className="rounded-md border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
                    Copy these from the Shopify order. The tax invoice is
                    billed to exactly what is entered here, and the state
                    decides whether GST is charged as CGST + SGST or as IGST.
                  </div>

                  <div className="text-sm font-medium">Buyer</div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="cust-name">
                        Full name <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="cust-name"
                        placeholder="As it appears on the Shopify order"
                        value={customer.name || ""}
                        onChange={(e) => setCustomerField("name", e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="cust-phone">
                        Phone <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="cust-phone"
                        placeholder="10-digit mobile"
                        value={customer.phone || ""}
                        onChange={(e) => setCustomerField("phone", e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="cust-email">Email (optional)</Label>
                    <Input
                      id="cust-email"
                      placeholder="For the invoice copy"
                      value={customerEmail}
                      onChange={(e) => setCustomerEmail(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="cust-address1">
                      Address <span className="text-destructive">*</span>
                    </Label>
                    <Textarea
                      id="cust-address1"
                      rows={2}
                      placeholder="House / flat, street, area"
                      value={customer.address1 || ""}
                      onChange={(e) => setCustomerField("address1", e.target.value)}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="cust-address2">
                      Landmark / second line (optional)
                    </Label>
                    <Input
                      id="cust-address2"
                      value={customer.address2 || ""}
                      onChange={(e) => setCustomerField("address2", e.target.value)}
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="cust-city">
                        City <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="cust-city"
                        value={customer.city || ""}
                        onChange={(e) => setCustomerField("city", e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="cust-state">
                        State <span className="text-destructive">*</span>
                      </Label>
                      <Select
                        value={customer.province || ""}
                        onValueChange={(value) => setCustomerField("province", value)}
                      >
                        <SelectTrigger id="cust-state">
                          <SelectValue placeholder="Select state" />
                        </SelectTrigger>
                        <SelectContent>
                          {INDIAN_STATES.map((state) => (
                            <SelectItem key={state} value={state}>
                              {state}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="cust-zip">
                        PIN code <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="cust-zip"
                        inputMode="numeric"
                        value={customer.zip || ""}
                        onChange={(e) => setCustomerField("zip", e.target.value)}
                      />
                    </div>
                  </div>

                  {(() => {
                    const missing = missingCustomerFields(customer);
                    const sellerState = planFor.merchant?.state || "";
                    const buyerState = customer.province || "";
                    const taxKnown = Boolean(sellerState && buyerState);
                    const intra =
                      taxKnown &&
                      sellerState.toLowerCase().replace(/[^a-z]/g, "") ===
                        buyerState.toLowerCase().replace(/[^a-z]/g, "");

                    return (
                      <>
                        {buyerState ? (
                          <div className="rounded-md border bg-muted/20 p-3 text-xs">
                            <span className="font-medium">
                              {taxKnown
                                ? intra
                                  ? "This order will be taxed as CGST 2.5% + SGST 2.5%."
                                  : "This order will be taxed as IGST 5%."
                                : "This order will be taxed as IGST 5%."}
                            </span>{" "}
                            <span className="text-muted-foreground">
                              {taxKnown
                                ? `${sellerState} \u2192 ${buyerState}.`
                                : "The seller has not saved a state, so the supply cannot be shown as local."}
                            </span>
                          </div>
                        ) : null}

                        {missing.length ? (
                          <p className="flex gap-1.5 text-xs text-amber-700">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span>Still needed: {missing.join(", ")}.</span>
                          </p>
                        ) : (
                          <div className="rounded-md border p-3">
                            <div className="mb-1 text-xs text-muted-foreground">
                              Parcel will be addressed to
                            </div>
                            <div className="whitespace-pre-line text-sm">
                              {formatCustomerAddress(customer)}
                            </div>
                          </div>
                        )}

                        <div className="flex flex-col gap-3 sm:flex-row">
                          <Button
                            onClick={
                              planMode === "full"
                                ? () => setPlanStep("pickup")
                                : saveCustomerOnly
                            }
                            disabled={missing.length > 0 || busy}
                          >
                            {planMode === "full"
                              ? "Continue to pickup"
                              : "Save details"}
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => setPlanOpen(false)}
                            disabled={busy}
                          >
                            Cancel
                          </Button>
                        </div>
                      </>
                    );
                  })()}
                </>
              ) : (
                /* ---------------- STEP 2: how it gets there -------------- */
                <>
                  <div className="rounded-md border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs text-muted-foreground">
                          Delivering to
                        </div>
                        <div className="whitespace-pre-line text-sm">
                          {formatCustomerAddress(customer)}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 shrink-0 px-2 text-xs"
                        onClick={() => setPlanStep("customer")}
                        disabled={busy}
                      >
                        Edit
                      </Button>
                    </div>
                  </div>

                  <div className="text-sm">
                    <div className="text-muted-foreground">Timer</div>
                    {(() => {
                      const t = timerFor(planFor);
                      if (!t) return <div className="text-muted-foreground">&mdash;</div>;
                      return (
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4" />
                          <span
                            className={
                              t.ms > 0 || t.paused
                                ? "font-medium"
                                : "font-medium text-destructive"
                            }
                          >
                            {t.ms > 0 ? (
                              <>
                                {fmtCountdown(t.ms)}
                                {!isOfficeOpen && (
                                  <span className="ml-1 text-xs text-orange-600">
                                    (Paused)
                                  </span>
                                )}
                              </>
                            ) : t.paused ? (
                              <span className="text-orange-600">
                                Paused until the office opens
                              </span>
                            ) : (
                              "Overdue"
                            )}
                          </span>
                        </div>
                      );
                    })()}
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="plan-pickup-window">Pickup Window</Label>
                      <Input
                        id="plan-pickup-window"
                        placeholder='e.g. "Today 4-6 PM"'
                        value={pickupWindow}
                        onChange={(e) => setPickupWindow(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="plan-notes">Notes (optional)</Label>
                      <Input
                        id="plan-notes"
                        placeholder="Anything the pickup agent should know"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="plan-pickup-address">Pickup Address</Label>
                    <Textarea
                      id="plan-pickup-address"
                      rows={3}
                      placeholder="Seller pickup address"
                      value={pickupAddress}
                      onChange={(e) => setPickupAddress(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      {planFor?.merchant?.address
                        ? `From ${planFor.merchant.storeName || planFor.merchant.name || "the seller"}'s profile.`
                        : "This seller has not saved a business address yet \u2014 enter it manually."}
                    </p>
                  </div>

                  <div className="space-y-2 rounded-md border bg-muted/20 p-3">
                    <Label>Delivery scope</Label>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {(
                        [
                          [
                            "same_city",
                            "Same city",
                            "Delivered locally. DRIPPR provides the label.",
                          ],
                          [
                            "different_city",
                            "Different city",
                            "Goes via courier. Shiprocket provides the label.",
                          ],
                        ] as const
                      ).map(([value, title, hint]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setDeliveryScope(value)}
                          className={`rounded-lg border p-3 text-left transition-colors ${
                            deliveryScope === value
                              ? "border-primary bg-primary/5"
                              : "border-border hover:bg-muted/40"
                          }`}
                        >
                          <span className="block text-sm font-medium">{title}</span>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {hint}
                          </span>
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {planFor ? guessDeliveryScope(planFor).reason : null}
                    </p>
                  </div>

                  {/* Every parcel ships with a label; only its source differs. */}
                  <div className="space-y-1.5">
                    <Label htmlFor="plan-shipping-label">
                      Shipping Label <span className="text-destructive">*</span>
                    </Label>
                    <div className="flex flex-wrap items-center gap-3">
                      <Input
                        id="plan-shipping-label"
                        type="file"
                        accept="application/pdf,image/png,image/jpeg,image/jpg"
                        className="max-w-sm"
                        onChange={(e) => setLabelFile(e.target.files?.[0] || null)}
                        disabled={busy}
                      />
                      {labelFile ? (
                        <span className="text-xs text-muted-foreground">
                          {labelFile.name}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {deliveryScope === "same_city"
                        ? "The DRIPPR label for this local delivery. PDF or image."
                        : "The courier's label from Shiprocket. PDF or image."}{" "}
                      Shared with the seller so they can print it for the parcel.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

                  <div className="flex flex-col gap-3 sm:flex-row">
                    <Button onClick={submitPlan} disabled={busy}>
                      <Truck className="mr-2 h-4 w-4" />
                      Assign Pickup
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setPlanStep("customer")}
                      disabled={busy}
                    >
                      Back
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setPlanOpen(false)}
                      disabled={busy}
                    >
                      Cancel
                    </Button>
                  </div>

                  <div className="text-xs text-muted-foreground">
                    Planning works only when the vendor has accepted (or the
                    admin is overdue). Assigning makes the invoice available to
                    both you and the seller.
                  </div>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
