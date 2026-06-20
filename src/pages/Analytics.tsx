import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";

type LineItem = {
  title: string;
  sku?: string;
  quantity: number;
  price: number;
  total: number;
};

type OrderDoc = {
  id: string;
  merchantId: string;
  createdAt: number;
  currency?: string;
  subtotal?: number;
  lineItems?: LineItem[];
  financialStatus?: string;   // "paid" | "pending" | "authorized" | "refunded" | ...
  fulfillmentStatus?: string; // "unfulfilled" | "partial" | "fulfilled"
  status?: string;            // "open" | "closed" | "cancelled"
};

type TopProductRow = { key: string; name: string; sales: number; revenue: number };

export default function Analytics() {
  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid ?? null);
  const [orders, setOrders] = useState<OrderDoc[]>([]);
  const [loading, setLoading] = useState(true);

  // Current user
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUid(u?.uid ?? null));
    return () => unsub();
  }, []);

  // Utility: first day of month, N months back (0 = current month)
  const firstDayMonthsBack = (monthsBack: number) => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    d.setMonth(d.getMonth() - monthsBack);
    return d;
  };

  // Subscribe to last 6 months of orders for this merchant (covers daily last 30d too)
  useEffect(() => {
    if (!uid) return;
    setLoading(true);
    const since = firstDayMonthsBack(5).getTime(); // current + prev 5 months
    const qRef = query(
      collection(db, "orders"),
      where("merchantId", "==", uid),
      where("createdAt", ">=", since),
      orderBy("createdAt", "asc")
    );
    const unsub = onSnapshot(
      qRef,
      (snap) => {
        const rows: OrderDoc[] = [];
        snap.forEach((d) => rows.push({ id: d.id, ...(d.data() as any) }));
        setOrders(rows);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [uid]);

  const currency = useMemo(() => orders.find((o) => o.currency)?.currency || "INR", [orders]);
  const money = (v: number) =>
    new Intl.NumberFormat("en-IN", { style: "currency", currency }).format(Number(v || 0));

  // ===== Monthly (last 6 months) =====
  const monthKeys = useMemo(() => {
    const arr: { key: string; label: string }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = firstDayMonthsBack(i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleString("en-US", { month: "short" }); // Jan, Feb, ...
      arr.push({ key, label });
    }
    return arr;
  }, []);

  const salesData = useMemo(() => {
    const map = new Map<string, number>();
    monthKeys.forEach(({ key }) => map.set(key, 0));

    for (const o of orders) {
      const d = new Date(o.createdAt || 0);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!map.has(k)) continue;
      map.set(k, (map.get(k) || 0) + Number(o.subtotal || 0));
    }

    return monthKeys.map(({ key, label }) => ({
      month: label,
      sales: Number((map.get(key) || 0).toFixed(2)),
    }));
  }, [orders, monthKeys]);

  // ===== Daily (last 30 days) — split Paid vs Pending =====
  const last30Keys = useMemo(() => {
    const arr: { key: string; label: string; dayStart: number }[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
      ).padStart(2, "0")}`;
      const label = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }); // "04 Oct"
      arr.push({ key, label, dayStart: d.getTime() });
    }
    return arr;
  }, []);

  const dailyData = useMemo(() => {
    const map = new Map<string, { paid: number; pending: number }>();
    last30Keys.forEach(({ key }) => map.set(key, { paid: 0, pending: 0 }));

    const startTs = last30Keys[0]?.dayStart ?? 0;
    const endTs = (last30Keys[last30Keys.length - 1]?.dayStart ?? 0) + 24 * 60 * 60 * 1000;

    // classify financial statuses
    const isPaidLike = (s?: string | null) => {
      const v = String(s || "").toLowerCase();
      return v === "paid" || v === "partially_paid";
    };
    const isPendingLike = (s?: string | null) => {
      const v = String(s || "").toLowerCase();
      return v === "pending" || v === "authorized";
    };

    for (const o of orders) {
      const ts = Number(o.createdAt || 0);
      if (ts < startTs || ts >= endTs) continue;

      const d = new Date(ts);
      d.setHours(0, 0, 0, 0);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
      ).padStart(2, "0")}`;
      const bucket = map.get(key);
      if (!bucket) continue;

      const amt = Number(o.subtotal || 0);
      if (isPaidLike(o.financialStatus)) bucket.paid += amt;
      else if (isPendingLike(o.financialStatus)) bucket.pending += amt;
      // ignore refunded/voided here (or you can subtract if you track refund amounts)
    }

    return last30Keys.map(({ key, label }) => ({
      day: label,
      paid: Number((map.get(key)?.paid || 0).toFixed(2)),
      pending: Number((map.get(key)?.pending || 0).toFixed(2)),
    }));
  }, [orders, last30Keys]);

  // ===== Top products (same 6-month window) =====
  const topProducts = useMemo<TopProductRow[]>(() => {
    const acc = new Map<string, TopProductRow>(); // key by SKU if present, else Title
    for (const o of orders) {
      for (const li of o.lineItems || []) {
        const key = (li.sku && li.sku.trim()) || li.title || "Unknown";
        const row = acc.get(key) || { key, name: li.title || key, sales: 0, revenue: 0 };
        row.sales += Number(li.quantity || 0);
        row.revenue += Number(li.total || 0);
        acc.set(key, row);
      }
    }
    return Array.from(acc.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8);
  }, [orders]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Analytics</h2>
          <p className="text-muted-foreground">Insights into your sales performance</p>
        </div>

        {/* Daily Sales (30d) Paid vs Pending */}
        <Card>
          <CardHeader>
            <CardTitle>Daily Sales (Last 30 Days) — Paid vs Pending</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-sm text-muted-foreground p-4">Loading daily sales…</div>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={dailyData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" />
                  <YAxis />
                  <Tooltip
                    formatter={(value: number, name: string) => [
                      money(value),
                      name === "paid" ? "Paid" : "Pending",
                    ]}
                  />
                  <Legend />
                  <Bar dataKey="paid" stackId="a" fill="hsl(var(--success))" name="Paid" />
                  <Bar dataKey="pending" stackId="a" fill="hsl(var(--warning))" name="Pending" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Sales Trend (6 months) */}
        <Card>
          <CardHeader>
            <CardTitle>Sales Trend (Last 6 Months)</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-sm text-muted-foreground p-4">Loading sales…</div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={salesData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip formatter={(value: number) => [money(value), "Sales"]} />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="sales"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={{ fill: "hsl(var(--primary))" }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Top Products Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Top Performing Products</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-sm text-muted-foreground p-4">Loading products…</div>
            ) : topProducts.length === 0 ? (
              <div className="text-sm text-muted-foreground p-4">No product sales yet.</div>
            ) : (
              <ResponsiveContainer width="100%" height={350}>
                <BarChart data={topProducts}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip
                    formatter={(value: number, name: string) => [
                      name === "revenue" ? money(value) : value,
                      name === "revenue" ? "Revenue" : "Units Sold",
                    ]}
                  />
                  <Legend />
                  <Bar dataKey="sales" fill="hsl(var(--primary))" name="Units Sold" />
                  <Bar dataKey="revenue" fill="hsl(var(--success))" name="Revenue" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Top Products Table */}
        <Card>
          <CardHeader>
            <CardTitle>Top Products by Revenue</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-sm text-muted-foreground p-4">Loading…</div>
            ) : topProducts.length === 0 ? (
              <div className="text-sm text-muted-foreground p-4">No data found.</div>
            ) : (
              <div className="space-y-4">
                {topProducts.map((p, index) => (
                  <div
                    key={p.key}
                    className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-accent/5 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary font-bold">
                        #{index + 1}
                      </div>
                      <div>
                        <p className="font-semibold">{p.name}</p>
                        <p className="text-sm text-muted-foreground">{p.sales} units sold</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xl font-bold text-success">{money(p.revenue)}</p>
                      <p className="text-xs text-muted-foreground">Total Revenue </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
