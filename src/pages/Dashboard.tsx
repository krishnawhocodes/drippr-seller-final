import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import StatsCard from "@/components/StatsCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DollarSign, Package, ShoppingCart, TrendingUp } from "lucide-react";
import { auth, db } from "@/lib/firebase";
import { statusText, getStatusColor } from "@/lib/orderStatus";


import {
  collection,
  doc,
  getCountFromServer,
  onSnapshot,
  orderBy,
  query,
  where,
  limit,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";

type OrderDoc = {
  id: string;
  createdAt: number;
  currency?: string;
  subtotal?: number;
  financialStatus?: string; // "paid" | "pending" | ...
  status?: string; // "open" | "closed"
  lineItems?: { title: string; sku?: string; quantity: number; price: number; total: number }[];
  orderNumber?: string;
};

export default function Dashboard() {
  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid ?? null);

  // card state
  const [totalSales, setTotalSales] = useState<number>(0);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [monthlyEarnings, setMonthlyEarnings] = useState<number>(0);
  const [activeProducts, setActiveProducts] = useState<number>(0);

  // list state
  const [recentOrders, setRecentOrders] = useState<OrderDoc[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUid(u?.uid ?? null));
    return () => unsub();
  }, []);

  // currency helper (default INR)
  const currency = useMemo(() => {
    const fromRecent = recentOrders.find((o) => !!o.currency)?.currency;
    return fromRecent || "INR";
  }, [recentOrders]);

  const formatMoney = (v: number) =>
    new Intl.NumberFormat("en-IN", { style: "currency", currency }).format(v || 0);

  // ===== Stats: Total Sales (running revenue from merchantStats/{uid})
  useEffect(() => {
    if (!uid) return;
    const ref = doc(db, "merchantStats", uid);
    const unsub = onSnapshot(ref, (snap) => {
      const data = snap.data() as { revenue?: number } | undefined;
      setTotalSales(Number(data?.revenue || 0));
    });
    return () => unsub();
  }, [uid]);

  // ===== Stats: Pending orders (count of status == "open")
  useEffect(() => {
    if (!uid) return;
    const q = query(
      collection(db, "orders"),
      where("merchantId", "==", uid),
      where("status", "==", "open")
    );
    getCountFromServer(q)
      .then((snap) => setPendingCount(Number(snap.data().count || 0)))
      .catch(() => setPendingCount(0));
  }, [uid]);

  // ===== Stats: Active products (count)
  useEffect(() => {
    if (!uid) return;
    const q = query(
      collection(db, "merchantProducts"),
      where("merchantId", "==", uid),
      where("status", "==", "active")
    );
    getCountFromServer(q)
      .then((snap) => setActiveProducts(Number(snap.data().count || 0)))
      .catch(() => setActiveProducts(0));
  }, [uid]);

  // ===== Stats: Monthly earnings (sum of last 30 days subtotals)
  useEffect(() => {
    if (!uid) return;
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const q = query(
      collection(db, "orders"),
      where("merchantId", "==", uid),
      where("createdAt", ">=", cutoff)
    );
    const unsub = onSnapshot(q, (snap) => {
      let sum = 0;
      snap.forEach((d) => (sum += Number((d.data() as any)?.subtotal || 0)));
      setMonthlyEarnings(sum);
    });
    return () => unsub();
  }, [uid]);

  // ===== Recent orders (last 5)
  useEffect(() => {
    if (!uid) return;
    setLoadingOrders(true);
    const q = query(
      collection(db, "orders"),
      where("merchantId", "==", uid),
      orderBy("createdAt", "desc"),
      limit(5)
    );
    const unsub = onSnapshot(q, (snap) => {
      const rows: OrderDoc[] = [];
      snap.forEach((d) => rows.push({ id: d.id, ...(d.data() as any) }));
      setRecentOrders(rows);
      setLoadingOrders(false);
    });
    return () => unsub();
  }, [uid]);

  // Badge color based on financialStatus first, then order status
  const getStatusColor = (o: OrderDoc) => {
    const fs = (o.financialStatus || "").toLowerCase();
    if (fs === "paid") return "bg-success/10 text-success border-success/20";
    if (fs === "pending" || fs === "authorized")
      return "bg-warning/10 text-warning border-warning/20";
    if (fs === "refunded" || fs === "voided")
      return "bg-destructive/10 text-destructive border-destructive/20";
    if ((o.status || "").toLowerCase() === "open")
      return "bg-primary/10 text-primary border-primary/20";
    return "bg-muted text-muted-foreground border-muted";
  };

  const statusText = (o: OrderDoc) =>
    (o.financialStatus || o.status || "pending").toLowerCase();

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Dashboard Overview</h2>
          <p className="text-muted-foreground">Track your sales and manage your store</p>
        </div>

        {/* Stats Cards (live) */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatsCard
            title="Total Sales"
            value={formatMoney(totalSales)}
            change="" // you can compute mom change later
            changeType="neutral"
            icon={DollarSign}
            iconColor="text-success"
          />

          <StatsCard
            title="Orders Pending"
            value={String(pendingCount)}
            change=""
            changeType="neutral"
            icon={ShoppingCart}
            iconColor="text-warning"
          />

          <StatsCard
            title="Monthly Earnings"
            value={formatMoney(monthlyEarnings)}
            change=""
            changeType="neutral"
            icon={TrendingUp}
            iconColor="text-primary"
          />

          <StatsCard
            title="Active Products"
            value={String(activeProducts)}
            change=""
            changeType="neutral"
            icon={Package}
            iconColor="text-accent"
          />
        </div>

        {/* Recent Orders (live) */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Orders</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {loadingOrders && (
                <div className="text-sm text-muted-foreground">Loading recent orders…</div>
              )}
              {!loadingOrders && recentOrders.length === 0 && (
                <div className="text-sm text-muted-foreground">No orders yet.</div>
              )}
              {recentOrders.map((order) => (
                <div
                  key={order.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-lg border bg-card hover:bg-accent/5 transition-colors"
                >
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold">{order.orderNumber || order.id}</p>
                      <Badge className={getStatusColor(order)}>{statusText(order)}</Badge>
                     
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {new Date(order.createdAt).toLocaleString()}
                    </p>
                    {/* product summary */}
                    <p className="text-sm">
                      {(order.lineItems || [])
                        .slice(0, 3)
                        .map((li) => `${li.title} × ${li.quantity}`)
                        .join(", ")}
                      {(order.lineItems || []).length > 3 ? "…" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="font-semibold">{formatMoney(Number(order.subtotal || 0))}</p>
                      <p className="text-xs text-muted-foreground">
                        {order.currency || currency}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
