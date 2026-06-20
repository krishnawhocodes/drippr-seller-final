import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import type { Merchant } from "@/lib/types";
import { useState } from "react";

export default function Register() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "").trim();
    const phone = String(form.get("phone") || "").trim();
    const name = String(form.get("name") || "").trim();
    const business_name = String(form.get("business-name") || "").trim();

    if (!email || !password || !name) {
      toast.error("Please fill name, email and password.");
      return;
    }

    try {
      setBusy(true);
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      if (name) await updateProfile(cred.user, { displayName: name });

      const merchant: Omit<Merchant, "id" | "createdAt"> = {
        email,
        phone,
        businessName: business_name,
        displayName: name,
        status: "active",
        kycStatus: "pending",
        commissionRate: 0.1,
      };

      await setDoc(doc(db, "merchants", cred.user.uid), {
        ...merchant,
        createdAt: Date.now(),
      });

      toast.success("Registration successful. Welcome to DRIPPR!");
      navigate("/dashboard");
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || "Registration failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-hero p-4 py-12">
      <Card className="w-full max-w-2xl">
        <CardHeader className="text-center">
          <img className="mx-auto mb-4 h-12 w-12 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold text-2xl" src="../../logo_rounded.png" />
          <CardTitle className="text-2xl">Register as Seller</CardTitle>
          <CardDescription>Create your seller account on DRIPPR</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="name">Full Name</Label>
                <Input id="name" name="name" placeholder="Your name" required />
              </div>
              <div>
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" placeholder="you@company.com" required />
              </div>
              <div>
                <Label htmlFor="password">Password</Label>
                <Input id="password" name="password" type="password" required />
              </div>
              <div>
                <Label htmlFor="phone">Phone Number</Label>
                <Input id="phone" name="phone" type="phone" placeholder="1234567890" required />
              </div>
              <div>
                <Label htmlFor="business-name">Business Name</Label>
                <Input id="business-name" name="business-name" type="business-name" required />
              </div>
              <div>
                <Label htmlFor="business-type">Business Type</Label>
                <Select name="businessType" defaultValue="individual">
                  <SelectTrigger id="business-type"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="individual">Individual</SelectItem>
                    <SelectItem value="company">Company</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Creating account..." : "Create account"}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Already have an account? <Link className="underline" to="/login">Login</Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
