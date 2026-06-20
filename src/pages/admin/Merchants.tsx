import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Search } from "lucide-react";

import { db } from "@/lib/firebase";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
} from "firebase/firestore";

// If you already have a shared Merchant type, you can remove this and import yours.
type Merchant = {
  uid: string;
  email?: string;
  name?: string;
  phone?: string;
  storeName?: string;
  businessName?: string;
  displayName?: string;
  enabled?: boolean;
  createdAt?: number;
  businessCategory?: string;
  gstin?: string;
  address?: string;
  // Optional bank fields (adjust if your schema differs)
  bankAccountName?: string;
  bankName?: string;
  bankAccountNumber?: string; // we will mask on render
  ifsc?: string;
  shopStatus?: "open" | "closed";
  shopClosed?: boolean;
  shopClosedAt?: number | null;
  shopCloseReason?: string | null;
};

export default function Merchants() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedMerchant, setSelectedMerchant] = useState<Merchant | null>(null);

  // Live Firestore subscription
  useEffect(() => {
    const qRef = query(collection(db, "merchants"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      qRef,
      (snap) => {
        const rows: Merchant[] = [];
        snap.forEach((d) => rows.push({ uid: d.id, ...(d.data() as any) }));
        setMerchants(rows);
        setLoading(false);
      },
      (err) => {
        console.error(err);
        toast.error("Failed to load merchants");
        setLoading(false);
      }
    );
    
    return () => unsub();
  }, []);

  // Client-side filter (name/email/store/phone)
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return merchants;
    return merchants.filter((m) =>
      `${m.name || ""} ${m.email || ""} ${m.storeName || ""} ${m.phone || ""}`
        .toLowerCase()
        .includes(q)
    );
  }, [merchants, search]);

  async function handleToggleEnabled(e: React.MouseEvent, merchant: Merchant) {
    e.stopPropagation(); // don't open the sheet
    try {
      const newEnabled = !Boolean(merchant.enabled);
      await updateDoc(doc(db, "merchants", merchant.uid), {
        enabled: newEnabled,
        updatedAt: Date.now(),
      });
      toast.success(`${merchant.storeName || merchant.name || merchant.email} ${newEnabled ? "enabled" : "disabled"} successfully.`);
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || "Failed to update merchant");
    }
  }

  function maskAccount(num?: string) {
    if (!num) return "";
    const last4 = num.slice(-4);
    return `•••• •••• •••• ${last4}`;
  }

  function renderBank(m: Merchant) {
    const hasAny =
      m.bankAccountName || m.bankName || m.bankAccountNumber || m.ifsc;
    if (!hasAny) {
      return <p className="text-xs text-muted-foreground italic">No bank details provided</p>;
    }
    return (
      <div className="space-y-1 text-sm text-muted-foreground">
        {m.bankAccountName && <p><span className="font-medium text-foreground">Holder:</span> {m.bankAccountName}</p>}
        {m.bankName && <p><span className="font-medium text-foreground">Bank:</span> {m.bankName}</p>}
        {m.bankAccountNumber && <p><span className="font-medium text-foreground">Account:</span> {maskAccount(m.bankAccountNumber)}</p>}
        {m.ifsc && <p><span className="font-medium text-foreground">IFSC:</span> {m.ifsc}</p>}
      </div>
    );
  }

  function isMerchantShopClosed(merchant: Merchant) {
    return merchant.shopClosed === true || merchant.shopStatus === "closed";
  }

  return (
    <div className="space-y-4">
      {/* Search */}
      <Card>
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, email, phone, or store..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </CardContent>
      </Card>

      {/* Merchants Table */}
      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Store</TableHead>
                  <TableHead>Shop Status</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((merchant) => (
                  <TableRow
                    key={merchant.uid}
                    className="cursor-pointer"
                    onClick={() => setSelectedMerchant(merchant)}
                  >
                    <TableCell className="font-medium">
                      {merchant.displayName || "-"}
                    </TableCell>
                    <TableCell>{merchant.email || "-"}</TableCell>
                    <TableCell>{merchant.phone || "-"}</TableCell>
                    <TableCell>{merchant.businessName || "-"}</TableCell>
                    <TableCell>
                      {isMerchantShopClosed(merchant) ? (
                        <Badge className="bg-red-500/10 text-red-700 border-red-500/20">
                          Closed
                        </Badge>
                      ) : (
                        <Badge className="bg-green-500/10 text-green-700 border-green-500/20">
                          Open
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Switch
                        checked={!!merchant.enabled}
                        onCheckedChange={() => {
                          /* handled onClick below */
                        }}
                        onClick={(e) => handleToggleEnabled(e, merchant)}
                      />
                    </TableCell>
                    <TableCell>
                      {merchant.createdAt
                        ? new Date(merchant.createdAt).toLocaleDateString()
                        : "-"}
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="text-center text-muted-foreground"
                    >
                      No merchants found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Merchant Details Sheet */}
      <Sheet
        open={!!selectedMerchant}
        onOpenChange={(open) => {
          if (!open) setSelectedMerchant(null);
        }}
      >
        <SheetContent className="overflow-y-auto">
          {selectedMerchant && (
            <>
              <SheetHeader>
                <SheetTitle>
                  {selectedMerchant.storeName ||
                    selectedMerchant.name ||
                    "Merchant"}
                </SheetTitle>
                <SheetDescription>Merchant Profile Details</SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-4">
                <div className="flex justify-between items-center">
                  <span className="font-semibold">Status:</span>
                  <Badge
                    variant={selectedMerchant.enabled ? "default" : "secondary"}
                  >
                    {selectedMerchant.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                </div>

                <div className="flex justify-between items-center">
                  <span className="font-semibold">Shop Status:</span>
                  {isMerchantShopClosed(selectedMerchant) ? (
                    <Badge className="bg-red-500/10 text-red-700 border-red-500/20">
                      Closed
                    </Badge>
                  ) : (
                    <Badge className="bg-green-500/10 text-green-700 border-green-500/20">
                      Open
                    </Badge>
                  )}
                </div>

                {isMerchantShopClosed(selectedMerchant) && (
                  <div>
                    <span className="font-semibold block mb-1">
                      Close Reason:
                    </span>
                    <p className="text-sm text-muted-foreground">
                      {selectedMerchant.shopCloseReason || "-"}
                    </p>
                  </div>
                )}

                <div>
                  <span className="font-semibold block mb-1">Owner Name:</span>
                  <p className="text-sm text-muted-foreground">
                    {selectedMerchant.name || "-"}
                  </p>
                </div>

                <div>
                  <span className="font-semibold block mb-1">Email:</span>
                  <p className="text-sm text-muted-foreground">
                    {selectedMerchant.email || "-"}
                  </p>
                </div>

                <div>
                  <span className="font-semibold block mb-1">Phone:</span>
                  <p className="text-sm text-muted-foreground">
                    {selectedMerchant.phone || "-"}
                  </p>
                </div>

                <div>
                  <span className="font-semibold block mb-1">
                    Business Category:
                  </span>
                  <p className="text-sm text-muted-foreground">
                    {selectedMerchant.businessCategory || "-"}
                  </p>
                </div>

                {selectedMerchant.gstin && (
                  <div>
                    <span className="font-semibold block mb-1">GSTIN:</span>
                    <p className="text-sm text-muted-foreground">
                      {selectedMerchant.gstin}
                    </p>
                  </div>
                )}

                {selectedMerchant.address && (
                  <div>
                    <span className="font-semibold block mb-1">Address:</span>
                    <p className="text-sm text-muted-foreground">
                      {selectedMerchant.address}
                    </p>
                  </div>
                )}

                <div>
                  <span className="font-semibold block mb-1">Joined:</span>
                  <p className="text-sm text-muted-foreground">
                    {selectedMerchant.createdAt
                      ? new Date(
                          selectedMerchant.createdAt,
                        ).toLocaleDateString()
                      : "-"}
                  </p>
                </div>

                <div className="pt-4 border-t">
                  <span className="font-semibold block mb-2">
                    Bank Details:
                  </span>
                  {renderBank(selectedMerchant)}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
