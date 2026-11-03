import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Bell,
  Package,
  ShoppingCart,
  AlertCircle,
  CheckCircle,
  Clock,
  Truck,
  MessageSquare,
  ExternalLink,
} from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import {
  getRemainingBusinessTime,
  formatBusinessHoursCountdown,
} from "@/lib/officeHours";

type OrderRow = {
  id: string;
  orderNumber?: string;
  shopifyOrderId?: string;
  workflowStatus?: string;
  createdAt?: number;
  vendorAcceptBy?: number;
  adminPlannedAt?: number;
  dispatchedAt?: number;
  lineItems?: unknown[];
  shippingLabel?: { url?: string } | null;
};

type ProductRow = {
  id: string;
  title?: string;
  status?: string;
  published?: boolean;
  reviewNote?: string | null;
  createdAt?: number;
  updatedAt?: number;
};

type TicketRow = {
  id: string;
  subject?: string;
  adminReply?: string;
  repliedAt?: number;
  updatedAt?: { seconds?: number } | number;
};

type NotificationKind =
  | "order_action"
  | "order_info"
  | "product_rejected"
  | "product_live"
  | "product_review"
  | "support_reply";

type Notification = {
  id: string;
  kind: NotificationKind;
  title: string;
  description: string;
  at: number;
  link: string;
  actionText: string;
  urgent?: boolean;
};

const ICONS: Record<NotificationKind, typeof Bell> = {
  order_action: ShoppingCart,
  order_info: Truck,
  product_rejected: AlertCircle,
  product_live: CheckCircle,
  product_review: Package,
  support_reply: MessageSquare,
};

const TONES: Record<NotificationKind, string> = {
  order_action: "text-primary bg-primary/10 border-primary/20",
  order_info: "text-sky-600 bg-sky-500/10 border-sky-500/20",
  product_rejected: "text-destructive bg-destructive/10 border-destructive/20",
  product_live: "text-emerald-600 bg-emerald-500/10 border-emerald-500/20",
  product_review: "text-amber-600 bg-amber-500/10 border-amber-500/20",
  support_reply: "text-violet-600 bg-violet-500/10 border-violet-500/20",
};

function relativeTime(at: number) {
  const diff = Date.now() - at;
  if (!at || diff < 0) return "just now";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(at).toLocaleDateString("en-IN");
}

/**
 * Notifications are derived live from the seller's own orders, products and
 * support tickets. This page previously rendered a hardcoded list, so it
 * showed invented activity and never surfaced anything that actually needed
 * the seller's attention.
 */
export default function Notifications() {
  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid ?? null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => onAuthStateChanged(auth, (u) => setUid(u?.uid ?? null)), []);

  useEffect(() => {
    if (!uid) {
      setOrders([]);
      setProducts([]);
      setTickets([]);
      setLoading(false);
      return;
    }
    setLoading(true);

    function rows<T>(snap: {
      forEach: (cb: (doc: { id: string; data: () => unknown }) => void) => void;
    }): T[] {
      const out: T[] = [];
      snap.forEach((doc) => out.push({ id: doc.id, ...(doc.data() as object) } as T));
      return out;
    }

    const unsubOrders = onSnapshot(
      query(
        collection(db, "orders"),
        where("merchantId", "==", uid),
        orderBy("createdAt", "desc"),
        limit(50),
      ),
      (snap) => {
        setOrders(rows<OrderRow>(snap));
        setLoading(false);
      },
      () => setLoading(false),
    );

    const unsubProducts = onSnapshot(
      query(
        collection(db, "merchantProducts"),
        where("merchantId", "==", uid),
        orderBy("createdAt", "desc"),
        limit(50),
      ),
      (snap) => setProducts(rows<ProductRow>(snap)),
      () => undefined,
    );

    const unsubTickets = onSnapshot(
      query(collection(db, "supportRequests"), where("merchantId", "==", uid)),
      (snap) => setTickets(rows<TicketRow>(snap)),
      () => undefined,
    );

    return () => {
      unsubOrders();
      unsubProducts();
      unsubTickets();
    };
  }, [uid]);

  const notifications = useMemo<Notification[]>(() => {
    const now = Date.now();
    const items: Notification[] = [];

    for (const order of orders) {
      const label = order.orderNumber || order.shopifyOrderId || order.id;
      const status = String(order.workflowStatus || "vendor_pending");

      if (status === "vendor_pending") {
        const deadline =
          Number(order.vendorAcceptBy) || Number(order.createdAt) || now;
        const left = getRemainingBusinessTime(deadline, now);
        items.push(
          left > 0
            ? {
                id: `order-accept-${order.id}`,
                kind: "order_action",
                title: `Order ${label} needs your acceptance`,
                description: `${
                  (order.lineItems || []).length
                } item(s). Time left: ${formatBusinessHoursCountdown(deadline, now)}.`,
                at: Number(order.createdAt) || now,
                link: "/dashboard/orders",
                actionText: "Accept order",
                urgent: true,
              }
            : {
                id: `order-expired-${order.id}`,
                kind: "product_rejected",
                title: `Order ${label} acceptance window closed`,
                description:
                  "DRIPPR support can still take this order forward for you.",
                at: Number(order.createdAt) || now,
                link: "/dashboard/support",
                actionText: "Contact support",
                urgent: true,
              },
        );
      }

      if (status === "pickup_assigned") {
        items.push({
          id: `order-dispatch-${order.id}`,
          kind: "order_action",
          title: `Pickup assigned for order ${label}`,
          description: order.shippingLabel?.url
            ? "Print the shipping label and hand the parcel over, then mark it dispatched."
            : "Hand the parcel to the delivery partner, then mark it dispatched.",
          at: Number(order.adminPlannedAt) || Number(order.createdAt) || now,
          link: "/dashboard/orders",
          actionText: "Mark dispatched",
          urgent: true,
        });
      }

      if (status === "dispatched" && order.dispatchedAt) {
        items.push({
          id: `order-done-${order.id}`,
          kind: "order_info",
          title: `Order ${label} dispatched`,
          description: "On its way to the customer.",
          at: Number(order.dispatchedAt),
          link: "/dashboard/orders",
          actionText: "View order",
        });
      }
    }

    for (const product of products) {
      const status = String(product.status || "");
      const title = product.title || "Your product";
      const at = Number(product.updatedAt) || Number(product.createdAt) || now;

      if (status === "rejected") {
        items.push({
          id: `product-rejected-${product.id}`,
          kind: "product_rejected",
          title: `"${title}" was not approved`,
          description: product.reviewNote
            ? String(product.reviewNote)
            : "Open the product to see what needs changing.",
          at,
          link: "/dashboard/products",
          actionText: "Review product",
          urgent: true,
        });
      } else if (status === "pending" || status === "update_in_review") {
        items.push({
          id: `product-review-${product.id}`,
          kind: "product_review",
          title: `"${title}" is awaiting review`,
          description:
            status === "update_in_review"
              ? "Your changes are with the DRIPPR team."
              : "DRIPPR is reviewing this submission.",
          at,
          link: "/dashboard/products",
          actionText: "View status",
        });
      } else if (status === "approved" && product.published) {
        items.push({
          id: `product-live-${product.id}`,
          kind: "product_live",
          title: `"${title}" is live on the store`,
          description: "Customers can now buy this product.",
          at,
          link: "/dashboard/products",
          actionText: "View product",
        });
      }
    }

    for (const ticket of tickets) {
      if (!ticket.adminReply) continue;
      items.push({
        id: `ticket-${ticket.id}`,
        kind: "support_reply",
        title: `DRIPPR replied: ${ticket.subject || "your ticket"}`,
        description: String(ticket.adminReply).slice(0, 160),
        at:
          Number(ticket.repliedAt) ||
          (typeof ticket.updatedAt === "object" && ticket.updatedAt?.seconds
            ? ticket.updatedAt.seconds * 1000
            : Number(ticket.updatedAt)) ||
          now,
        link: "/dashboard/support",
        actionText: "Open ticket",
      });
    }

    return items
      .filter((item) => !dismissed.has(item.id))
      .sort((a, b) => Number(b.urgent) - Number(a.urgent) || b.at - a.at);
  }, [orders, products, tickets, dismissed]);

  const urgentCount = notifications.filter((item) => item.urgent).length;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <Card>
          <div className="space-y-4 p-6">
            <div className="flex items-start gap-3">
              <div className="relative">
                <Bell className="h-8 w-8 text-primary" />
                {urgentCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-xs font-bold text-destructive-foreground">
                    {urgentCount}
                  </span>
                )}
              </div>
              <div>
                <h1 className="text-3xl font-bold">Notifications</h1>
                <p className="text-muted-foreground">
                  Live from your orders, products and support tickets.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3 text-sm">
              <span className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-1.5 font-medium">
                {urgentCount} needing action
              </span>
              <span className="rounded-lg border bg-muted/40 px-3 py-1.5 font-medium">
                {notifications.length} total
              </span>
            </div>
          </div>
        </Card>

        <div className="space-y-3">
          {loading ? (
            <Card className="p-10 text-center text-muted-foreground">
              Loading your activity…
            </Card>
          ) : notifications.length === 0 ? (
            <Card className="p-12 text-center">
              <Bell className="mx-auto mb-3 h-12 w-12 text-muted-foreground" />
              <h3 className="text-xl font-semibold">All caught up</h3>
              <p className="text-muted-foreground">
                Nothing needs your attention right now.
              </p>
            </Card>
          ) : (
            notifications.map((item) => {
              const Icon = ICONS[item.kind];
              return (
                <Card
                  key={item.id}
                  className={cn(
                    "p-5 transition-shadow hover:shadow-md",
                    item.urgent && "border-primary/30",
                  )}
                >
                  <div className="flex gap-4">
                    <div
                      className={cn(
                        "flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl border",
                        TONES[item.kind],
                      )}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold">{item.title}</h3>
                            {item.urgent && (
                              <Badge className="border-destructive/20 bg-destructive/10 text-destructive">
                                Action needed
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {item.description}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="shrink-0"
                          onClick={() =>
                            setDismissed((current) =>
                              new Set(current).add(item.id),
                            )
                          }
                        >
                          Dismiss
                        </Button>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {relativeTime(item.at)}
                        </span>
                        <Link to={item.link}>
                          <Button variant="ghost" size="sm" className="gap-1">
                            {item.actionText}
                            <ExternalLink className="h-3 w-3" />
                          </Button>
                        </Link>
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
