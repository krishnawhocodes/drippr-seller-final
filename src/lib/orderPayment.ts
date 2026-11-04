// src/lib/orderPayment.ts
//
// How an order's payment state is written and coloured in the order tables.
//
// Both panels import from here so the same order never reads one way to the
// seller and another to the admin. Shopify's own values are lower case
// machine tokens ("partially_refunded"); they stay that way for filtering and
// become prose only at the point of display.

export type PaymentTone = "settled" | "awaiting" | "reversed" | "neutral";

/** Shopify's raw token, lower case. Use for filtering, never for display. */
export function paymentKey(financialStatus?: string | null): string {
  return String(financialStatus || "pending").toLowerCase();
}

const PAYMENT_LABELS: Record<string, string> = {
  paid: "Paid",
  pending: "Payment pending",
  authorized: "Authorised",
  partially_paid: "Partially paid",
  refunded: "Refunded",
  partially_refunded: "Partially refunded",
  voided: "Voided",
  expired: "Expired",
};

/** Sentence-case wording for the interface. */
export function paymentLabel(financialStatus?: string | null): string {
  const key = paymentKey(financialStatus);
  if (PAYMENT_LABELS[key]) return PAYMENT_LABELS[key];
  // An unfamiliar future state still reads as words rather than as a token.
  const spaced = key.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function paymentTone(financialStatus?: string | null): PaymentTone {
  const key = paymentKey(financialStatus);
  if (key === "paid" || key === "partially_paid") return "settled";
  if (key === "pending" || key === "authorized") return "awaiting";
  if (key.includes("refund") || key === "voided" || key === "expired") {
    return "reversed";
  }
  return "neutral";
}

/**
 * A small dot carries the payment state beside the workflow badge.
 *
 * Two filled badges side by side read as two competing statuses, and only one
 * of them is being acted on, so payment is stated more quietly.
 */
export const PAYMENT_DOT_CLASS: Record<PaymentTone, string> = {
  settled: "bg-emerald-500",
  awaiting: "bg-amber-500",
  reversed: "bg-rose-500",
  neutral: "bg-slate-400",
};

export const PAYMENT_TEXT_CLASS: Record<PaymentTone, string> = {
  settled: "text-muted-foreground",
  awaiting: "text-amber-700",
  reversed: "text-rose-700",
  neutral: "text-muted-foreground",
};
