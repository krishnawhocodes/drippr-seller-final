import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { auth, db } from "@/lib/firebase";
import {
  onAuthStateChanged,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from "firebase/auth";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// -------- Types --------
type BankDetails = {
  accountHolder?: string;
  bankName?: string;
  accountNumber?: string; // keep as string
  ifsc?: string;
  upi?: string; // optional alternative payout
  accountType?: "SAVINGS" | "CURRENT";
  payoutMethod?: "BANK" | "UPI";
  updatedAt?: number;
};

type MerchantDoc = {
  uid: string;
  email?: string;
  name?: string;
  phone?: string;
  createdAt?: number; // ms
  storeName?: string;
  businessCategory?: string;
  gstin?: string;
  address?: string;
  bank?: BankDetails; // <-- new
  shopStatus?: "open" | "closed";
  shopClosed?: boolean;
  shopClosedAt?: number | null;
  shopCloseReason?: string | null;
};

export default function Settings() {
  // ---------- Auth ----------
  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid ?? null);
  const [authEmail, setAuthEmail] = useState<string | null>(auth.currentUser?.email ?? null);
  const joinDateText = useMemo(() => {
    const createdAt = auth.currentUser?.metadata?.creationTime
      ? new Date(auth.currentUser.metadata.creationTime).toLocaleDateString()
      : null;
    return createdAt ?? "";
  }, [uid]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUid(u?.uid ?? null);
      setAuthEmail(u?.email ?? null);
    });
    return () => unsub();
  }, []);

  // ---------- Live Merchant doc ----------
  const [loadingDoc, setLoadingDoc] = useState(true);
  const [merchant, setMerchant] = useState<MerchantDoc | null>(null);

  useEffect(() => {
    if (!uid) return;
    const ref = doc(db, "merchants", uid);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = (snap.data() as MerchantDoc | undefined) || null;
        setMerchant(data);
        setLoadingDoc(false);

        // hydrate forms if user hasn't started typing yet
        if (data && !dirtyProfile) {
          setName(data.name || "");
          setPhone(data.phone || "");
        }
        if (data && !dirtyStore) {
          setStoreName(data.storeName || "");
          setBusinessCategory(data.businessCategory || "");
          setGstin(data.gstin || "");
          setAddress(data.address || "");

          const isClosed =
            data.shopClosed === true || data.shopStatus === "closed";
          setShopClosed(isClosed);
          setShopCloseReason(data.shopCloseReason || "");
        }
        if (data?.bank && !dirtyBank) {
          setAccountHolder(data.bank.accountHolder || "");
          setBankName(data.bank.bankName || "");
          setAccountNumber(data.bank.accountNumber || "");
          setIfsc(data.bank.ifsc || "");
          setUpi(data.bank.upi || "");
          setAccountType((data.bank.accountType as any) || "SAVINGS");
          setPayoutMethod((data.bank.payoutMethod as any) || "BANK");
        }
      },
      () => setLoadingDoc(false)
    );
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  // ========== PROFILE ==========
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [dirtyProfile, setDirtyProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uid) return toast.error("Please sign in again.");

    try {
      setSavingProfile(true);
      const ref = doc(db, "merchants", uid);
      await setDoc(
        ref,
        {
          uid,
          email: authEmail ?? merchant?.email ?? null,
          name: name.trim(),
          phone: phone.trim(),
          updatedAt: Date.now(),
          ...(merchant ? {} : { createdAt: Date.now() }),
        },
        { merge: true }
      );
      toast.success("Profile updated successfully!");
      setDirtyProfile(false);
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || "Failed to update profile");
    } finally {
      setSavingProfile(false);
    }
  };

  // ========== STORE ==========
  const [storeName, setStoreName] = useState("");
  const [businessCategory, setBusinessCategory] = useState("");
  const [gstin, setGstin] = useState("");
  const [address, setAddress] = useState("");
  const [shopClosed, setShopClosed] = useState(false);
  const [shopCloseReason, setShopCloseReason] = useState("");
  const [dirtyStore, setDirtyStore] = useState(false);
  const [savingStore, setSavingStore] = useState(false);

  const handleSaveStore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uid) return toast.error("Please sign in again.");
    try {
      setSavingStore(true);
      const ref = doc(db, "merchants", uid);
      await setDoc(
        ref,
        {
  uid,
  storeName: storeName.trim() || null,
  businessCategory: businessCategory.trim() || null,
  gstin: gstin.trim() || null,
  address: address.trim() || null,

  shopClosed,
  shopStatus: shopClosed ? "closed" : "open",
  shopClosedAt: shopClosed ? merchant?.shopClosedAt ?? Date.now() : null,
  shopCloseReason: shopClosed ? shopCloseReason.trim() || null : null,

  updatedAt: Date.now(),
  ...(merchant ? {} : { createdAt: Date.now(), email: authEmail ?? null }),
},
        { merge: true }
      );
      toast.success("Store details updated successfully!");
      setDirtyStore(false);
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || "Failed to update store details");
    } finally {
      setSavingStore(false);
    }
  };

  // ========== PASSWORD ==========
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [changingPw, setChangingPw] = useState(false);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const user = auth.currentUser;
    if (!user || !authEmail) return toast.error("Please sign in again.");
    if (newPw.length < 6) return toast.error("New password must be at least 6 characters.");
    if (newPw !== confirmPw) return toast.error("New passwords do not match.");

    try {
      setChangingPw(true);
      const cred = EmailAuthProvider.credential(authEmail, currentPw);
      await reauthenticateWithCredential(user, cred);
      await updatePassword(user, newPw);
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
      toast.success("Password changed successfully!");
    } catch (err: any) {
      console.error(err);
      const msg =
        err?.code === "auth/wrong-password"
          ? "Current password is incorrect."
          : err?.code === "auth/too-many-requests"
          ? "Too many attempts. Please try again later."
          : err?.message || "Failed to change password";
      toast.error(msg);
    } finally {
      setChangingPw(false);
    }
  };

  // ========== BANK / PAYOUTS ==========
  const [accountHolder, setAccountHolder] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [upi, setUpi] = useState("");
  const [accountType, setAccountType] = useState<"SAVINGS" | "CURRENT">("SAVINGS");
  const [payoutMethod, setPayoutMethod] = useState<"BANK" | "UPI">("BANK");

  const [dirtyBank, setDirtyBank] = useState(false);
  const [savingBank, setSavingBank] = useState(false);

  function normalizeIfsc(v: string) {
    return v.toUpperCase().replace(/\s+/g, "");
  }

  function validateBankForm() {
    if (payoutMethod === "BANK") {
      if (!accountHolder.trim()) return "Account holder is required.";
      if (!bankName.trim()) return "Bank name is required.";
      if (!accountNumber.trim()) return "Account number is required.";
      const onlyDigits = accountNumber.replace(/\s+/g, "");
      if (!/^\d{6,20}$/.test(onlyDigits)) return "Account number should be 6–20 digits.";
      if (!ifsc.trim()) return "IFSC is required.";
      const IFSC = normalizeIfsc(ifsc);
      // Standard IFSC pattern: 4 letters + 0 + 6 alphanumeric
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(IFSC)) return "Invalid IFSC format.";
    } else {
      if (!upi.trim()) return "UPI ID is required for UPI payouts.";
      // very loose UPI validation
      if (!/^[a-z0-9.\-_]{2,}@[a-z]{2,}$/i.test(upi.trim())) return "Invalid UPI ID.";
    }
    return null;
  }

  const handleSaveBank = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uid) return toast.error("Please sign in again.");

    const err = validateBankForm();
    if (err) {
      toast.error(err);
      return;
    }

    try {
      setSavingBank(true);
      const ref = doc(db, "merchants", uid);
      await setDoc(
        ref,
        {
          uid,
          bank: {
            accountHolder: accountHolder.trim(),
            bankName: bankName.trim(),
            accountNumber: accountNumber.trim().replace(/\s+/g, ""),
            ifsc: normalizeIfsc(ifsc),
            upi: upi.trim() || undefined,
            accountType,
            payoutMethod,
            updatedAt: Date.now(),
          } as BankDetails,
          updatedAt: Date.now(),
          ...(merchant ? {} : { createdAt: Date.now(), email: authEmail ?? null }),
        },
        { merge: true }
      );
      toast.success("Payout details saved!");
      setDirtyBank(false);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Failed to save payout details");
    } finally {
      setSavingBank(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Settings</h2>
          <p className="text-muted-foreground">
            Manage your account and store settings
          </p>
        </div>

        <Tabs defaultValue="profile" className="space-y-6">
          <TabsList>
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="store">Store Details</TabsTrigger>
            <TabsTrigger value="bank">Bank / Payouts</TabsTrigger>
            <TabsTrigger value="password">Password</TabsTrigger>
          </TabsList>

          {/* Profile */}
          <TabsContent value="profile">
            <Card>
              <CardHeader>
                <CardTitle>Personal Information</CardTitle>
                <CardDescription>Update your personal details</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSaveProfile} className="space-y-4">
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">Full Name</Label>
                      <Input
                        id="name"
                        placeholder="Enter your name"
                        value={name}
                        onChange={(e) => {
                          setName(e.target.value);
                          setDirtyProfile(true);
                        }}
                        disabled={!uid || loadingDoc || savingProfile}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        value={authEmail || ""}
                        disabled
                      />
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="phone">Phone</Label>
                      <Input
                        id="phone"
                        placeholder="+91 98765 43210"
                        value={phone}
                        onChange={(e) => {
                          setPhone(e.target.value);
                          setDirtyProfile(true);
                        }}
                        disabled={!uid || loadingDoc || savingProfile}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="joinDate">Member Since</Label>
                      <Input id="joinDate" value={joinDateText} disabled />
                    </div>
                  </div>

                  <Button type="submit" disabled={!uid || savingProfile}>
                    {savingProfile ? "Saving…" : "Save Changes"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          <div className="rounded-lg border p-4 space-y-3 bg-muted/20">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label className="text-base font-medium">Close Your Shop</Label>
                <p className="text-sm text-muted-foreground mt-1">
                  Temporarily close your shop. Admin will be able to see this
                  status.
                </p>
              </div>

              <Switch
                checked={shopClosed}
                onCheckedChange={(checked) => {
                  setShopClosed(checked);
                  setDirtyStore(true);
                }}
                disabled={!uid || loadingDoc || savingStore}
              />
            </div>

            {shopClosed && (
              <div className="space-y-2">
                <Label htmlFor="shopCloseReason">Reason for closing shop</Label>
                <Textarea
                  id="shopCloseReason"
                  placeholder="Example: Stock update, vacation, maintenance..."
                  value={shopCloseReason}
                  onChange={(e) => {
                    setShopCloseReason(e.target.value);
                    setDirtyStore(true);
                  }}
                  disabled={!uid || loadingDoc || savingStore}
                />
              </div>
            )}
          </div> 

          {/* Store */}
          <TabsContent value="store">
            <Card>
              <CardHeader>
                <CardTitle>Store Information</CardTitle>
                <CardDescription>Manage your store details</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSaveStore} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="storeName">Store Name</Label>
                    <Input
                      id="storeName"
                      placeholder="Enter store name"
                      value={storeName}
                      onChange={(e) => {
                        setStoreName(e.target.value);
                        setDirtyStore(true);
                      }}
                      disabled={!uid || loadingDoc || savingStore}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="category">Business Category</Label>
                    <Input
                      id="category"
                      placeholder="e.g., Fashion & Electronics"
                      value={businessCategory}
                      onChange={(e) => {
                        setBusinessCategory(e.target.value);
                        setDirtyStore(true);
                      }}
                      disabled={!uid || loadingDoc || savingStore}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="gstin">GSTIN</Label>
                    <Input
                      id="gstin"
                      placeholder="Enter GSTIN"
                      value={gstin}
                      onChange={(e) => {
                        setGstin(e.target.value);
                        setDirtyStore(true);
                      }}
                      disabled={!uid || loadingDoc || savingStore}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="address">Business Address</Label>
                    <Textarea
                      id="address"
                      placeholder="Enter complete address"
                      className="min-h-24"
                      value={address}
                      onChange={(e) => {
                        setAddress(e.target.value);
                        setDirtyStore(true);
                      }}
                      disabled={!uid || loadingDoc || savingStore}
                    />
                  </div>

                  <Button type="submit" disabled={!uid || savingStore}>
                    {savingStore ? "Saving…" : "Save Changes"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Bank / Payouts */}
          <TabsContent value="bank">
            <Card>
              <CardHeader>
                <CardTitle>Bank / Payout Details</CardTitle>
                <CardDescription>
                  Choose your payout method and add the required details.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSaveBank} className="space-y-4">
                  {/* Payout method */}
                  <div className="space-y-2">
                    <Label>Payout Method</Label>
                    <Select
                      value={payoutMethod}
                      onValueChange={(v) => {
                        setPayoutMethod(v as "BANK" | "UPI");
                        setDirtyBank(true);
                      }}
                      disabled={!uid || loadingDoc || savingBank}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select method" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="BANK">Bank Transfer</SelectItem>
                        <SelectItem value="UPI">UPI</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* BANK fields */}
                  {payoutMethod === "BANK" && (
                    <>
                      <div className="grid sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="accountHolder">Account Holder</Label>
                          <Input
                            id="accountHolder"
                            placeholder="Full name as per bank"
                            value={accountHolder}
                            onChange={(e) => {
                              setAccountHolder(e.target.value);
                              setDirtyBank(true);
                            }}
                            disabled={!uid || loadingDoc || savingBank}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="bankName">Bank Name</Label>
                          <Input
                            id="bankName"
                            placeholder="e.g., HDFC Bank"
                            value={bankName}
                            onChange={(e) => {
                              setBankName(e.target.value);
                              setDirtyBank(true);
                            }}
                            disabled={!uid || loadingDoc || savingBank}
                          />
                        </div>
                      </div>

                      <div className="grid sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="accountNumber">Account Number</Label>
                          <Input
                            id="accountNumber"
                            placeholder="e.g., 123456789012"
                            value={accountNumber}
                            onChange={(e) => {
                              setAccountNumber(e.target.value);
                              setDirtyBank(true);
                            }}
                            disabled={!uid || loadingDoc || savingBank}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="ifsc">IFSC</Label>
                          <Input
                            id="ifsc"
                            placeholder="e.g., HDFC0001234"
                            value={ifsc}
                            onChange={(e) => {
                              setIfsc(e.target.value.toUpperCase());
                              setDirtyBank(true);
                            }}
                            disabled={!uid || loadingDoc || savingBank}
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label>Account Type</Label>
                        <Select
                          value={accountType}
                          onValueChange={(v) => {
                            setAccountType(v as "SAVINGS" | "CURRENT");
                            setDirtyBank(true);
                          }}
                          disabled={!uid || loadingDoc || savingBank}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="SAVINGS">Savings</SelectItem>
                            <SelectItem value="CURRENT">Current</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </>
                  )}

                  {/* UPI field */}
                  {payoutMethod === "UPI" && (
                    <div className="space-y-2">
                      <Label htmlFor="upi">UPI ID</Label>
                      <Input
                        id="upi"
                        placeholder="name@bank"
                        value={upi}
                        onChange={(e) => {
                          setUpi(e.target.value);
                          setDirtyBank(true);
                        }}
                        disabled={!uid || loadingDoc || savingBank}
                      />
                    </div>
                  )}

                  <Button type="submit" disabled={!uid || savingBank}>
                    {savingBank ? "Saving…" : "Save Payout Details"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Password */}
          <TabsContent value="password">
            <Card>
              <CardHeader>
                <CardTitle>Change Password</CardTitle>
                <CardDescription>Update your account password</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleChangePassword} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="currentPassword">Current Password</Label>
                    <Input
                      id="currentPassword"
                      type="password"
                      placeholder="Enter current password"
                      value={currentPw}
                      onChange={(e) => setCurrentPw(e.target.value)}
                      required
                      disabled={!uid || changingPw}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="newPassword">New Password</Label>
                    <Input
                      id="newPassword"
                      type="password"
                      placeholder="Enter new password"
                      value={newPw}
                      onChange={(e) => setNewPw(e.target.value)}
                      required
                      disabled={!uid || changingPw}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword">
                      Confirm New Password
                    </Label>
                    <Input
                      id="confirmPassword"
                      type="password"
                      placeholder="Re-enter new password"
                      value={confirmPw}
                      onChange={(e) => setConfirmPw(e.target.value)}
                      required
                      disabled={!uid || changingPw}
                    />
                  </div>

                  <Button type="submit" disabled={!uid || changingPw}>
                    {changingPw ? "Changing…" : "Change Password"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
