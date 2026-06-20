import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DollarSign, TrendingUp, Clock } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import StatsCard from "@/components/StatsCard";
import { useEffect, useMemo, useState } from "react";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection, doc, onSnapshot, orderBy, query, where, limit,
} from "firebase/firestore";

type Payout = {
  id: string;
  merchantId: string;
  amount: number;           // in store currency (e.g. INR)
  createdAt: number;        // ms epoch
  method: string;           // "Bank Transfer" | "UPI" | etc
  status: "pending" | "processing" | "completed" | "failed";
};

type MerchantStats = {
  merchantId: string;
  revenue: number;          // lifetime gross from orders sub-totals we tracked
  ordersCount?: number;
  updatedAt?: number;
};

type OrderDoc = {
  id: string;
  merchantId: string;
  createdAt: number;        // ms epoch
  subtotal: number;         // numeric
  currency?: string;        // e.g. "INR"
  financialStatus?: string; // "paid" | "pending" | "refunded"...
};

type BankDetails = {
  accountHolder?: string;
  bankName?: string;
  accountNumber?: string; // stored raw; we’ll mask for display
  ifsc?: string;
};

function formatMoney(n: number | undefined, currency = "₹") {
  if (n == null || Number.isNaN(n)) return `${currency}0`;
  return `${currency}${Number(n).toLocaleString()}`;
}

function maskAccount(acc?: string) {
  if (!acc) return "Not set";
  // Show last 4 digits only
  const last4 = acc.slice(-4);
  return `******* ${last4}`;
}

export default function Payments() {
  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid ?? null);

  // live state
  const [stats, setStats] = useState<MerchantStats | null>(null);
  const [orders, setOrders] = useState<OrderDoc[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [bank, setBank] = useState<BankDetails | null>(null);

  const [loading, setLoading] = useState(true);

  // track auth
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUid(u?.uid ?? null));
    return () => unsub();
  }, []);

  // stream everything once uid is available
  useEffect(() => {
    if (!uid) return;

    setLoading(true);

    // merchantStats/{uid}
    const statsUnsub = onSnapshot(doc(db, "merchantStats", uid), (snap) => {
      if (snap.exists()) setStats(snap.data() as MerchantStats);
      else setStats(null);
    });

    // orders (compute "This Month")
    // We’ll cap to a reasonable recent set; you can remove limit() if you want all.
    const ordersQ = query(
      collection(db, "orders"),
      where("merchantId", "==", uid),
      orderBy("createdAt", "desc"),
      limit(500)
    );
    const ordersUnsub = onSnapshot(ordersQ, (snap) => {
      const arr: OrderDoc[] = [];
      snap.forEach((d) => arr.push({ id: d.id, ...(d.data() as any) }));
      setOrders(arr);
    });

    // payouts list
    const payoutsQ = query(
      collection(db, "payouts"),
      where("merchantId", "==", uid),
      orderBy("createdAt", "desc")
    );
    const payoutsUnsub = onSnapshot(payoutsQ, (snap) => {
      const arr: Payout[] = [];
      snap.forEach((d) => arr.push({ id: d.id, ...(d.data() as any) }));
      setPayouts(arr);
    });

    // bank details from merchants/{uid}
    const bankUnsub = onSnapshot(doc(db, "merchants", uid), (snap) => {
      const data = snap.data() as any;
      setBank((data?.bank as BankDetails) ?? null);
    });

    // small settle timeout to hide loader once first frames land
    const t = setTimeout(() => setLoading(false), 500);

    return () => {
      clearTimeout(t);
      statsUnsub();
      ordersUnsub();
      payoutsUnsub();
      bankUnsub();
    };
  }, [uid]);

  // compute cards
  const currency = "₹"; // store default; switch to stats/orders currency if you persist per-merchant
  const lifetimeEarnings = stats?.revenue ?? 0;

  const pendingAmount = useMemo(
    () => payouts.filter((p) => p.status === "pending" || p.status === "processing")
                 .reduce((sum, p) => sum + (p.amount || 0), 0),
    [payouts]
  );

  const thisMonthRevenue = useMemo(() => {
    if (!orders.length) return 0;
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    return orders
      .filter((o) => (o.createdAt ?? 0) >= firstOfMonth && (o.financialStatus ?? "paid") !== "refunded")
      .reduce((sum, o) => sum + (o.subtotal || 0), 0);
  }, [orders]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Payments</h2>
          <p className="text-muted-foreground">Track your earnings and payouts</p>
        </div>

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-3">
          <StatsCard
            title="Total Earnings"
            value={formatMoney(lifetimeEarnings, currency)}
            change={stats?.updatedAt ? `Updated ${new Date(stats.updatedAt).toLocaleDateString()}` : "—"}
            changeType="neutral"
            icon={DollarSign}
            iconColor="text-success"
          />
          <StatsCard
            title="Pending Payout"
            value={formatMoney(pendingAmount, currency)}
            change="Typically 3–7 business days"
            changeType="neutral"
            icon={Clock}
            iconColor="text-warning"
          />
          <StatsCard
            title="This Month"
            value={formatMoney(thisMonthRevenue, currency)}
            change="Gross order subtotal"
            changeType={thisMonthRevenue > 0 ? "positive" : "neutral"}
            icon={TrendingUp}
            iconColor="text-primary"
          />
        </div>

        {/* Payout History */}
        <Card>
          <CardHeader>
            <CardTitle>Payout History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Payout ID</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && payouts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-muted-foreground">
                        Loading payouts…
                      </TableCell>
                    </TableRow>
                  ) : payouts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-muted-foreground">
                        No payouts yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    payouts.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.id}</TableCell>
                        <TableCell className="font-semibold text-lg">
                          {formatMoney(p.amount, currency)}
                        </TableCell>
                        <TableCell>
                          {p.createdAt ? new Date(p.createdAt).toLocaleString() : "—"}
                        </TableCell>
                        <TableCell>{p.method || "—"}</TableCell>
                        <TableCell>
                          <Badge
                            className={
                              p.status === "completed"
                                ? "bg-success/10 text-success border-success/20"
                                : p.status === "failed"
                                ? "bg-destructive/10 text-destructive border-destructive/20"
                                : "bg-warning/10 text-warning border-warning/20"
                            }
                          >
                            {p.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Bank Details */}
        <Card>
          <CardHeader>
            <CardTitle>Bank Account Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between py-2 border-b">
                <span className="text-muted-foreground">Account Holder</span>
                <span className="font-medium">{bank?.accountHolder || "Not set"}</span>
              </div>
              <div className="flex justify-between py-2 border-b">
                <span className="text-muted-foreground">Bank Name</span>
                <span className="font-medium">{bank?.bankName || "Not set"}</span>
              </div>
              <div className="flex justify-between py-2 border-b">
                <span className="text-muted-foreground">Account Number</span>
                <span className="font-medium">{maskAccount(bank?.accountNumber)}</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-muted-foreground">IFSC Code</span>
                <span className="font-medium">{bank?.ifsc || "Not set"}</span>
              </div>
              {/* Optional: link to Settings */}
              <p className="text-xs text-muted-foreground">
                Update bank details in <a href="/dashboard/settings" className="underline">Settings</a>.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
