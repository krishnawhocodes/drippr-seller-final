// src/lib/accountApi.ts
//
// Changing the email address or phone number on the signed-in seller account.
// Both go through a code sent to the new destination; see api/account/verify.

import { auth } from "@/lib/firebase";

export type VerificationChannel = "email" | "phone";

async function post(payload: Record<string, unknown>) {
  const user = auth.currentUser;
  if (!user) throw new Error("Please sign in again.");
  const token = await user.getIdToken();

  const response = await fetch("/api/account/verify", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}) as Record<string, unknown>);
  if (!response.ok || (data as { ok?: boolean })?.ok === false) {
    const reported = String((data as { error?: string })?.error || "").trim();
    if (reported) throw new Error(reported);
    // No JSON body: the request never reached the handler. Say which part
    // failed rather than a shrug, so a misconfigured deploy is obvious.
    throw new Error(
      response.status === 404
        ? "Verification is not available on this deployment yet."
        : `Could not reach the server (${response.status}).`,
    );
  }
  return data as Record<string, unknown>;
}

/** Sends a code to the new address or number. */
export async function startVerification(
  channel: VerificationChannel,
  value: string,
): Promise<{ sentTo: string; expiresInSeconds: number }> {
  const data = await post({ action: "start", channel, value });
  return {
    sentTo: String(data.sentTo || value),
    expiresInSeconds: Number(data.expiresInSeconds || 600),
  };
}

/** Submits the code; on success the change is already applied. */
export async function confirmVerification(
  channel: VerificationChannel,
  code: string,
): Promise<{ value: string }> {
  const data = await post({ action: "confirm", channel, code });
  return { value: String(data.value || "") };
}
