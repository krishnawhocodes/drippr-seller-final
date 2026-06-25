import { useEffect, useState } from "react";
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
import { dashboardOverview } from "@/lib/adminApi";

type DayPoint = { day: string; orders: number };
type RevPoint = { day: string; revenue: number };

export default function AdminDashboard() {
  const [loading, setLoading] = useState(true);
  const [productsInReview, setProductsInReview] = useState(0);
  const [activeSellers, setActiveSellers] = useState(0);
  const [openTickets, setOpenTickets] = useState(0);
  const [mtdRevenue, setMtdRevenue] = useState(0);
  const [ordersSeries, setOrdersSeries] = useState<DayPoint[]>([]);
  const [revenueSeries, setRevenueSeries] = useState<RevPoint[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    dashboardOverview()
      .then((result) => {
        if (cancelled) return;
        const overview = result.overview || {};
        setProductsInReview(Number(overview.productsInReview || 0));
        setActiveSellers(Number(overview.activeSellers || 0));
        setOpenTickets(Number(overview.openTickets || 0));
        setMtdRevenue(Number(overview.mtdRevenue || 0));
        setOrdersSeries(Array.isArray(overview.ordersSeries) ? overview.ordersSeries : []);
        setRevenueSeries(Array.isArray(overview.revenueSeries) ? overview.revenueSeries : []);
      })
      .catch((error) => {
        console.error(error);
        if (cancelled) return;
        setProductsInReview(0);
        setActiveSellers(0);
        setOpenTickets(0);
        setMtdRevenue(0);
        setOrdersSeries([]);
        setRevenueSeries([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
