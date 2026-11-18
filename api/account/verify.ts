// api/account/verify.ts
//
// Changing the email address or phone number on a seller account.
//
// Both are identity: the email is how the account is signed into and how a
// password reset arrives, and the phone is how a rider reaches the seller. So
// neither is taken on the seller's word. A six digit code is sent to the new
// address or number, and the change is applied only once that code comes
// back - which proves the seller can actually receive at the new destination,
// and that a stolen session cannot quietly move the account somewhere else.
//
// Codes are stored hashed, expire in ten minutes, allow five attempts and
// cannot be re-sent more than once a minute.
//
// Mail and SMS both go through Brevo; see BREVO_* in .env.example.

import crypto from "node:crypto";
import { getAdmin } from "../_lib/firebaseAdmin.js";

type RequestLike = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type ResponseLike = {
  status: (code: number) => {
    json: (body: unknown) => unknown;
    send: (body: string) => unknown;
  };
};

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

type Channel = "email" | "phone";

function isChannel(value: unknown): value is Channel {
  return value === "email" || value === "phone";
}

/** Deliberately strict: a typo here locks the seller out of their account. */
function normalizeEmail(raw: unknown) {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value || value.length > 254) return "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) ? value : "";
}

/**
 * Indian mobile numbers, stored E.164 so SMS and display agree.
 * Accepts 98765 43210, 09876543210, +91 98765 43210.
 */
function normalizePhone(raw: unknown) {
  const digits = String(raw ?? "").replace(/[^\d]/g, "");
  const local = digits.length === 12 && digits.startsWith("91")
    ? digits.slice(2)
    : digits.length === 11 && digits.startsWith("0")
      ? digits.slice(1)
      : digits;
  return /^[6-9]\d{9}$/.test(local) ? "+91" + local : "";
}

function hashCode(code: string, uid: string, channel: Channel) {
  return crypto
    .createHash("sha256")
    .update(`${uid}:${channel}:${code}`)
    .digest("hex");
}

function newCode() {
  // randomInt is uniform; Math.random is not, and this guards an account.
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

async function sendEmailCode(to: string, code: string, sellerName: string) {
  const apiKey = process.env.BREVO_API_KEY || "";
  if (!apiKey) throw new Error("BREVO_API_KEY is not set");
  const senderEmail = process.env.BREVO_SENDER_EMAIL || "contact@drippr.in";
  const senderName = process.env.BREVO_SENDER_NAME || "DRIPPR";

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender: { name: senderName, email: senderEmail },
      to: [{ email: to }],
      subject: `${code} is your DRIPPR verification code`,
      htmlContent: `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f6f6;font-family:Helvetica,Arial,sans-serif;color:#111">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:28px">
    <p style="margin:0 0 4px;font-size:13px;color:#6b7280">DRIPPR Seller</p>
    <h1 style="margin:0 0 16px;font-size:20px">Confirm your new email address</h1>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.6">
      ${sellerName ? escapeHtml(sellerName) + ", e" : "E"}nter this code in the
      seller panel to finish changing the email on your account.
    </p>
    <p style="margin:0 0 20px;font-size:32px;font-weight:700;letter-spacing:6px">${code}</p>
    <p style="margin:0 0 8px;font-size:13px;color:#6b7280">
      The code expires in 10 minutes.
    </p>
    <p style="margin:0;font-size:13px;color:#6b7280">
      If you did not ask to change your email, ignore this message and your
      address stays as it is.
    </p>
  </div>
</body></html>`,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Brevo rejected the email (${response.status}). ${detail.slice(0, 200)}`,
    );
  }
}

async function sendSmsCode(to: string, code: string) {
  const apiKey = process.env.BREVO_API_KEY || "";
  if (!apiKey) throw new Error("BREVO_API_KEY is not set");
  const sender = (process.env.BREVO_SMS_SENDER || "DRIPPR").slice(0, 11);

  const response = await fetch("https://api.brevo.com/v3/transactionalSMS/sms", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender,
      // Brevo wants the number without a leading "+".
      recipient: to.replace(/^\+/, ""),
      content: `${code} is your DRIPPR verification code. It expires in 10 minutes.`,
      type: "transactional",
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Brevo rejected the SMS (${response.status}). ${detail.slice(0, 200)}`,
    );
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default async function handler(req: RequestLike, res: ResponseLike) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  const { adminAuth, adminDb } = getAdmin();

  // --- who is asking -------------------------------------------------
  const header = String(req.headers.authorization || req.headers.Authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return res.status(401).json({ ok: false, error: "Not signed in" });

  let uid = "";
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    uid = String(decoded.uid || "");
  } catch {
    return res.status(401).json({ ok: false, error: "Session expired. Sign in again." });
  }
  if (!uid) return res.status(401).json({ ok: false, error: "Not signed in" });

  const body = (req.body || {}) as Record<string, unknown>;
  const action = String(body.action || "");
  const channel = body.channel;
  if (!isChannel(channel)) {
    return res.status(400).json({ ok: false, error: "channel must be email or phone" });
  }

  const ref = adminDb.collection("accountVerifications").doc(`${uid}_${channel}`);
  const now = Date.now();

  // --- send a code ---------------------------------------------------
  if (action === "start") {
    const value =
      channel === "email" ? normalizeEmail(body.value) : normalizePhone(body.value);
    if (!value) {
      return res.status(400).json({
        ok: false,
        error:
          channel === "email"
            ? "Enter a valid email address."
            : "Enter a valid 10-digit Indian mobile number.",
      });
    }

    // Nothing to verify if it is what the account already has.
    try {
      const user = await adminAuth.getUser(uid);
      if (channel === "email" && String(user.email || "").toLowerCase() === value) {
        return res.status(400).json({
          ok: false,
          error: "That is already your email address.",
        });
      }
    } catch {
      /* the account check below is the one that matters */
    }

    if (channel === "email") {
      // Catch the clash now rather than after the seller has waited for a
      // code and typed it in.
      try {
        const existing = await adminAuth.getUserByEmail(value);
        if (existing && existing.uid !== uid) {
          return res.status(409).json({
            ok: false,
            error: "Another DRIPPR account already uses that email address.",
          });
        }
      } catch {
        /* not found is the good case */
      }
    }

    const previous = await ref.get();
    if (previous.exists) {
      const data = previous.data() as { sentAt?: number } | undefined;
      const since = now - Number(data?.sentAt || 0);
      if (since < RESEND_COOLDOWN_MS) {
        return res.status(429).json({
          ok: false,
          error: `Wait ${Math.ceil((RESEND_COOLDOWN_MS - since) / 1000)}s before asking for another code.`,
        });
      }
    }

    const code = newCode();
    try {
      if (channel === "email") {
        let sellerName = "";
        try {
          const profile = await adminDb.collection("merchants").doc(uid).get();
          sellerName = String((profile.data() as { name?: string })?.name || "");
        } catch {
          /* the greeting is optional */
        }
        await sendEmailCode(value, code, sellerName);
      } else {
        await sendSmsCode(value, code);
      }
    } catch (error) {
      console.error("[account/verify] send failed:", error);
      return res.status(502).json({
        ok: false,
        error:
          channel === "email"
            ? "Could not send the email just now. Try again in a moment."
            : "Could not send the SMS just now. Try again in a moment.",
      });
    }

    // Only the hash is stored: a leaked database row must not be a usable
    // code, and nothing here ever needs to read it back.
    await ref.set({
      uid,
      channel,
      value,
      codeHash: hashCode(code, uid, channel),
      sentAt: now,
      expiresAt: now + CODE_TTL_MS,
      attempts: 0,
    });

    return res.status(200).json({
      ok: true,
      sentTo: channel === "email" ? value : value.replace(/\d(?=\d{2})/g, "•"),
      expiresInSeconds: Math.floor(CODE_TTL_MS / 1000),
    });
  }

  // --- confirm a code ------------------------------------------------
  if (action === "confirm") {
    const code = String(body.code ?? "").replace(/\D/g, "");
    if (code.length !== 6) {
      return res.status(400).json({ ok: false, error: "Enter the 6-digit code." });
    }

    const snap = await ref.get();
    if (!snap.exists) {
      return res.status(400).json({
        ok: false,
        error: "No code was requested. Start again.",
      });
    }

    const record = snap.data() as {
      value?: string;
      codeHash?: string;
      expiresAt?: number;
      attempts?: number;
    };

    if (Number(record.expiresAt || 0) < now) {
      await ref.delete();
      return res.status(400).json({
        ok: false,
        error: "That code has expired. Ask for a new one.",
      });
    }

    const attempts = Number(record.attempts || 0);
    if (attempts >= MAX_ATTEMPTS) {
      await ref.delete();
      return res.status(429).json({
        ok: false,
        error: "Too many wrong codes. Ask for a new one.",
      });
    }

    const expected = String(record.codeHash || "");
    const actual = hashCode(code, uid, channel);
    const matches =
      expected.length === actual.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));

    if (!matches) {
      await ref.set({ attempts: attempts + 1 }, { merge: true });
      const left = MAX_ATTEMPTS - attempts - 1;
      return res.status(400).json({
        ok: false,
        error: left > 0
          ? `That code is not right. ${left} attempt${left === 1 ? "" : "s"} left.`
          : "That code is not right. Ask for a new one.",
      });
    }

    const value = String(record.value || "");
    if (!value) {
      await ref.delete();
      return res.status(400).json({ ok: false, error: "Start again." });
    }

    try {
      if (channel === "email") {
        // Firebase Auth is the system of record for signing in; the merchant
        // profile is the copy the panel reads. Auth goes first, so a failure
        // leaves both holding the old address rather than disagreeing.
        await adminAuth.updateUser(uid, { email: value, emailVerified: true });
        await adminDb
          .collection("merchants")
          .doc(uid)
          .set({ email: value, updatedAt: now }, { merge: true });
      } else {
        await adminDb
          .collection("merchants")
          .doc(uid)
          .set({ phone: value, phoneVerifiedAt: now, updatedAt: now }, { merge: true });
      }
    } catch (error) {
      console.error("[account/verify] apply failed:", error);
      const message = String((error as { message?: string })?.message || "");
      return res.status(500).json({
        ok: false,
        error: /email-already-exists/.test(message)
          ? "Another DRIPPR account already uses that email address."
          : "Verified, but the change could not be saved. Try again.",
      });
    }

    await ref.delete();
    return res.status(200).json({ ok: true, channel, value });
  }

  return res.status(400).json({ ok: false, error: "Unknown action" });
}
