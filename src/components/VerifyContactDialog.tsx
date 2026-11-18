// src/components/VerifyContactDialog.tsx
//
// Two steps in one dialog: type the new email address or mobile number, then
// type the code that arrives there. Email and phone share it so the two never
// drift apart in wording or in how they behave.

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Mail, Smartphone, ShieldCheck } from "lucide-react";
import {
  confirmVerification,
  startVerification,
  type VerificationChannel,
} from "@/lib/accountApi";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel: VerificationChannel;
  /** What the account currently has, shown for contrast. */
  current?: string | null;
  /** Called with the new value once it has been verified and saved. */
  onVerified: (value: string) => void;
};

const COPY = {
  email: {
    title: "Change email address",
    description:
      "This is how you sign in and how a password reset reaches you, so the new address has to be confirmed before the change is made.",
    field: "New email address",
    placeholder: "you@yourbusiness.in",
    inputType: "email",
    sentNote: "We sent a 6-digit code to",
    Icon: Mail,
  },
  phone: {
    title: "Change phone number",
    description:
      "This is the number a rider calls about a pickup, so the new number has to be confirmed before the change is made.",
    field: "New mobile number",
    placeholder: "98765 43210",
    inputType: "tel",
    sentNote: "We sent a 6-digit code by SMS to",
    Icon: Smartphone,
  },
} as const;

export default function VerifyContactDialog({
  open,
  onOpenChange,
  channel,
  current,
  onVerified,
}: Props) {
  const copy = COPY[channel];
  const [step, setStep] = useState<"value" | "code">("value");
  const [value, setValue] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // Start clean every time it opens; a stale half-finished code is confusing
  // and the server has its own expiry anyway.
  useEffect(() => {
    if (open) {
      setStep("value");
      setValue("");
      setCode("");
      setSentTo("");
      setBusy(false);
      setCooldown(0);
    }
  }, [open]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  async function sendCode() {
    if (!value.trim()) {
      toast.error(`Enter your ${channel === "email" ? "new email address" : "new mobile number"}.`);
      return;
    }
    setBusy(true);
    try {
      const result = await startVerification(channel, value.trim());
      setSentTo(result.sentTo);
      setStep("code");
      setCooldown(60);
      toast.success("Code sent.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send the code.");
    } finally {
      setBusy(false);
    }
  }

  async function submitCode() {
    if (code.replace(/\D/g, "").length !== 6) {
      toast.error("Enter the 6-digit code.");
      return;
    }
    setBusy(true);
    try {
      const result = await confirmVerification(channel, code);
      toast.success(
        channel === "email" ? "Email address updated." : "Phone number updated.",
      );
      onVerified(result.value);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not verify the code.");
    } finally {
      setBusy(false);
    }
  }

  const { Icon } = copy;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="h-4 w-4" />
            {copy.title}
          </DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        {step === "value" ? (
          <div className="space-y-4">
            {current ? (
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                <div className="text-xs text-muted-foreground">Currently</div>
                <div className="break-all">{current}</div>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="verify-value">{copy.field}</Label>
              <Input
                id="verify-value"
                type={copy.inputType}
                inputMode={channel === "phone" ? "numeric" : "email"}
                autoComplete={channel === "email" ? "email" : "tel"}
                placeholder={copy.placeholder}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void sendCode();
                  }
                }}
                disabled={busy}
              />
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button onClick={sendCode} disabled={busy}>
                {busy ? "Sending…" : "Send code"}
              </Button>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={busy}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>
                {copy.sentNote} <strong className="break-all">{sentTo}</strong>. It
                expires in 10 minutes.
              </span>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="verify-code">Verification code</Label>
              <Input
                id="verify-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                className="text-center font-mono text-lg tracking-[0.4em]"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void submitCode();
                  }
                }}
                disabled={busy}
              />
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button onClick={submitCode} disabled={busy || code.length !== 6}>
                {busy ? "Checking…" : "Confirm change"}
              </Button>
              <Button
                variant="outline"
                onClick={sendCode}
                disabled={busy || cooldown > 0}
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setStep("value")}
                disabled={busy}
              >
                Back
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
