import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";
import {
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  sendPasswordResetEmail,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useState } from "react";

export default function Login() {
  const navigate = useNavigate();
  const loc = useLocation();

  const [busy, setBusy] = useState(false);

  // existing error modal
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMsg, setModalMsg] = useState("");

  // keep email in state so we can reuse it for reset
  const [emailVal, setEmailVal] = useState("");

  // forgot password modal
  const [resetOpen, setResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetBusy, setResetBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);

    const email =
      String(emailVal || "").trim() || String(form.get("email") || "").trim();
    const password = String(form.get("password") || "").trim();

    try {
      setBusy(true);
      await signInWithEmailAndPassword(auth, email, password);
      toast.success("Welcome back!");
      navigate((loc.state as any)?.from?.pathname || "/dashboard", {
        replace: true,
      });
    } catch (err: any) {
      console.error(err);

      // Wrong credentials
      if (err?.code === "auth/invalid-credential") {
        setModalMsg("Incorrect credential. Please try again.");
        setModalOpen(true);
        setTimeout(() => setModalOpen(false), 3000);
      } else if (err?.code === "auth/user-not-found") {
        toast.error("No account found for this email.");
      } else {
        toast.error(err?.message || "Login failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogle() {
    try {
      setBusy(true);
      const prov = new GoogleAuthProvider();
      await signInWithPopup(auth, prov);
      toast.success("Logged in!");
      navigate("/dashboard", { replace: true });
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || "Google sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  function openResetModal() {
    const prefill = String(emailVal || "").trim();
    setResetEmail(prefill);
    setResetOpen(true);
  }

  async function handleSendReset() {
    const email = String(resetEmail || "").trim();
    if (!email) {
      toast.error("Please enter your email.");
      return;
    }

    try {
      setResetBusy(true);
      await sendPasswordResetEmail(auth, email);
      toast.success("Password reset email sent. Check your inbox.");
      setResetOpen(false);
    } catch (err: any) {
      console.error(err);

      if (err?.code === "auth/invalid-email") {
        toast.error("Please enter a valid email address.");
      } else if (err?.code === "auth/user-not-found") {
        toast.error("No account found for this email.");
      } else if (err?.code === "auth/too-many-requests") {
        toast.error("Too many requests. Please try again later.");
      } else {
        toast.error(err?.message || "Failed to send reset email.");
      }
    } finally {
      setResetBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-hero p-4 py-12">
      {/* Existing Error Modal */}
      {modalOpen && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-40 z-50">
          <div className="bg-white rounded-lg shadow-lg p-6 min-w-[300px] text-center">
            <p className="mb-4">{modalMsg}</p>
            <button
              className="bg-primary text-white px-4 py-2 rounded"
              onClick={() => setModalOpen(false)}
            >
              Okay!
            </button>
          </div>
        </div>
      )}

      {/* Forgot Password Modal */}
      {resetOpen && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-40 z-50 p-4">
          <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-sm">
            <h3 className="text-lg font-semibold mb-1">Reset password</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Enter your email and we’ll send you a reset link.
            </p>

            <div className="space-y-2">
              <Label htmlFor="resetEmail">Email</Label>
              <Input
                id="resetEmail"
                type="email"
                placeholder="you@company.com"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                disabled={resetBusy}
              />
            </div>

            <div className="mt-5 flex gap-2 justify-end">
              <Button
                variant="outline"
                type="button"
                onClick={() => setResetOpen(false)}
                disabled={resetBusy}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleSendReset}
                disabled={resetBusy}
              >
                {resetBusy ? "Sending..." : "Send reset link"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <img
            className="mx-auto mb-4 h-12 w-12 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold text-2xl"
            src="../../logo_rounded.png"
          />
          <CardTitle className="text-2xl">Login</CardTitle>
          <CardDescription>Access your DRIPPR seller dashboard</CardDescription>
        </CardHeader>

        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="you@company.com"
                required
                value={emailVal}
                onChange={(e) => setEmailVal(e.target.value)}
              />
            </div>

            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>

                <button
                  type="button"
                  onClick={openResetModal}
                  className="text-sm underline text-muted-foreground hover:text-foreground"
                  disabled={busy}
                >
                  Forgot password?
                </button>
              </div>

              <Input id="password" name="password" type="password" required />
            </div>

            <Button className="w-full" type="submit" disabled={busy}>
              {busy ? "Signing in..." : "Sign in"}
            </Button>

            <Button
              variant="outline"
              className="w-full"
              type="button"
              onClick={handleGoogle}
              disabled={busy}
            >
              Continue with Google
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              New here?{" "}
              <Link className="underline" to="/register">
                Create account
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
