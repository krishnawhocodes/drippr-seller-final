// src/pages/admin/Dashboard.tsx (or wherever your AdminDashboard lives)
import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Package, Users, MessageSquare, IndianRupee } from "lucide-react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

import { db } from "@/lib/firebase";
import {
  collection,
  onSnapshot,
  query,
  where,
  Timestamp,
} from "firebase/firestore";

type DayPoint = { day: string; orders: number };
type RevPoint = { day: string; revenue: number };

// ---- date helpers ----
function startOfMonth(d = new Date()) {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}
function startNDaysAgo(n: number) {
  const x = new Date();
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - (n - 1)); // include today → 30 points
  return x;
}
function keyOf(d: Date) {
  // YYYY-MM-DD
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}
function labelOf(d: Date) {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function AdminDashboard() {
  // ---- state ----
  const [loading, setLoading] = useState(true);

  const [productsInReview, setProductsInReview] = useState(0);
  const [activeSellers, setActiveSellers] = useState(0);
  const [openTickets, setOpenTickets] = useState(0);
  const [mtdRevenue, setMtdRevenue] = useState(0);

  const [ordersSeries, setOrdersSeries] = useState<DayPoint[]>([]);
  const [revenueSeries, setRevenueSeries] = useState<RevPoint[]>([]);

  // ---- subscriptions ----
  useEffect(() => {
    const subs: Array<() => void> = [];

    // Products in review (change "in_review" to "draft" if you haven't switched yet)
    {
      const qRef = query(
        collection(db, "merchantProducts"),
        where("status", "==", "pending")
      );
      subs.push(
        onSnapshot(qRef, (snap) => setProductsInReview(snap.size))
      );
    }

    // Merchants (count all as "active sellers")
    {
      const qRef = query(collection(db, "merchants"));
      subs.push(onSnapshot(qRef, (snap) => setActiveSellers(snap.size)));
    }

    // Support tickets: pending OR processing
    {
      const qRef = query(
        collection(db, "supportTickets"),
        where("status", "in", ["pending", "processing"])
      );
      subs.push(onSnapshot(qRef, (snap) => setOpenTickets(snap.size)));
    }

    // Orders: watch from the *earlier* of 30 days ago vs month start — one stream feeds both charts + MTD
    {
      const start30 = startNDaysAgo(30);
      const startMonth = startOfMonth();
      const minStart = start30 < startMonth ? start30 : startMonth;
      const qRef = query(
        collection(db, "orders"),
        where("createdAt", ">=", minStart.getTime())
      );

      subs.push(
        onSnapshot(qRef, (snap) => {
          // Prepare day buckets
          const dayKeys: string[] = [];
          const dayLabels: Record<string, string> = {};
          const ordersCount: Record<string, number> = {};
          const revenueSum: Record<string, number> = {};

          // initialize last 30 days buckets
          for (let i = 0; i < 30; i++) {
            const d = new Date(start30.getTime());
            d.setDate(start30.getDate() + i);
            const k = keyOf(d);
            dayKeys.push(k);
            dayLabels[k] = labelOf(d);
            ordersCount[k] = 0;
            revenueSum[k] = 0;
          }

          // compute MTD revenue window
          const monthStartMs = startMonth.getTime();
          let mtd = 0;

          snap.forEach((doc) => {
            const data = doc.data() as any;
            const createdAtMs: number = Number(data.createdAt || 0);
            const subtotal = Number(data.subtotal || 0);

            if (!createdAtMs) return;
            const d = new Date(createdAtMs);
            const k = keyOf(d);

            // last 30 days aggregations
            if (k in ordersCount) {
              ordersCount[k] += 1;
              revenueSum[k] += subtotal;
            }

            // month-to-date revenue
            if (createdAtMs >= monthStartMs) {
              mtd += subtotal;
            }
          });

          setMtdRevenue(mtd);

          // Build chart arrays
          setOrdersSeries(
            dayKeys.map((k) => ({ day: dayLabels[k], orders: ordersCount[k] || 0 }))
          );
          setRevenueSeries(
            dayKeys.map((k) => ({ day: dayLabels[k], revenue: Number((revenueSum[k] || 0).toFixed(2)) }))
          );

          setLoading(false);
        })
      );
    }

    return () => subs.forEach((u) => u());
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-4 w-32" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-20" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-32" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-64 w-full" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-32" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-64 w-full" />
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const stats = [
    {
      title: "Products in Review",
      value: productsInReview,
      icon: Package,
      color: "text-accent",
    },
    {
      title: "Active Sellers",
      value: activeSellers,
      icon: Users,
      color: "text-primary",
    },
    {
      title: "Open Tickets",
      value: openTickets,
      icon: MessageSquare,
      color: "text-destructive",
    },
    {
      title: "MTD Revenue",
      value: `₹${mtdRevenue.toLocaleString()}`,
      icon: IndianRupee,
      color: "text-green-600",
    },
  ];

  return (
      <div className="space-y-6">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((stat) => {
            const Icon = stat.icon;
            return (
              <Card key={stat.title}>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {stat.title}
                  </CardTitle>
                  <Icon className={`h-5 w-5 ${stat.color}`} />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stat.value}</div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Orders Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Orders Trend (Last 30 Days)</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={ordersSeries}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" />
                  <YAxis />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="orders"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Revenue Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Revenue Trend (Last 30 Days)</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={revenueSeries}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" />
                  <YAxis />
                  <Tooltip formatter={(v: number) => `₹${v.toLocaleString()}`} />
                  <Bar dataKey="revenue" fill="hsl(var(--accent))" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      </div>
  );
}
