// src/lib/orderStatus.ts
export type Shipment = {
  status?: string | null;           // "in_transit" | "out_for_delivery" | "delivered" | ...
  trackingCompany?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  at?: number;
};

export type OrderDoc = {
  financialStatus?: string | null;   // "paid" | "pending" | "authorized" | ...
  fulfillmentStatus?: string | null; // "unfulfilled" | "partial" | "fulfilled"
  status?: string | null;            // "open" | "closed" | "cancelled"
  shipments?: Shipment[];
};

export type UiStatus = {
  key: "delivered" | "shipped" | "pending" | "cancelled" | "paid";
  label: string;
  className: string;
};

export function deriveUiStatus(o: OrderDoc): UiStatus {
  const shipments = Array.isArray(o.shipments) ? o.shipments : [];
  const latest = shipments.length ? shipments[shipments.length - 1] : undefined;
  const latestShip = String(latest?.status || "").toLowerCase();
  const fulfillment = String(o.fulfillmentStatus || "").toLowerCase();
  const ordStatus = String(o.status || "").toLowerCase();
  const financial = String(o.financialStatus || "").toLowerCase();

  if (latestShip === "delivered" || fulfillment === "fulfilled") {
    return { key: "delivered", label: "delivered", className: "bg-success/10 text-success border-success/20" };
  }
  if (ordStatus === "cancelled") {
    return { key: "cancelled", label: "cancelled", className: "bg-destructive/10 text-destructive border-destructive/20" };
  }
  if (shipments.length) {
    return { key: "shipped", label: latestShip || "shipped", className: "bg-primary/10 text-primary border-primary/20" };
  }
  if (!financial || financial === "pending" || financial === "authorized") {
    return { key: "pending", label: "pending", className: "bg-warning/10 text-warning border-warning/20" };
  }
  return { key: "paid", label: "paid", className: "bg-muted text-muted-foreground border-muted" };
}

// These two match your component usage:
export const statusText = (o: OrderDoc) => deriveUiStatus(o).label;
export const getStatusColor = (o: OrderDoc) => deriveUiStatus(o).className;
