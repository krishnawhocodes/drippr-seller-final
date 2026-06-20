// --- Admin check hook (Firestore-based) ---
import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc, setDoc, serverTimestamp, onSnapshot } from "firebase/firestore";

import { QueueProduct, Merchant, SupportTicket, AdminOverview } from "@/types/admin";



/**
 * Returns true if the current user has an enabled admin record at:
 *   admins/{uid} with { enabled: true }
 * Falls back to false if signed out or document missing/disabled.
 */
export function useIsAdmin(): boolean {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let unsubAdmin: (() => void) | undefined;

    const unsubAuth = onAuthStateChanged(auth, (u) => {
      // clear previous listener
      if (unsubAdmin) {
        unsubAdmin();
        unsubAdmin = undefined;
      }
      if (!u) {
        setIsAdmin(false);
        return;
      }
      const ref = doc(db, "admins", u.uid);
      unsubAdmin = onSnapshot(
        ref,
        (snap) => setIsAdmin(snap.exists() && snap.get("enabled") !== false),
        () => setIsAdmin(false)
      );
    });

    return () => {
      unsubAuth();
      if (unsubAdmin) unsubAdmin();
    };
  }, []);

  return isAdmin;
}


export function assignPickup(payload: {
  orderId: string;
  pickupWindow?: string | null;
  pickupAddress?: string | null;
  notes?: string | null;
  deliveryPartner?: {
    name?: string | null;
    phone?: string | null;
    etaText?: string | null;
    trackingUrl?: string | null;
  };
}) {
  return call("orders.assignPickup", payload);
}

let _publicationIdCache: string | null | undefined; // undefined => not fetched yet

/**
 * One-time fetch of the Shopify Publication (sales channel) GraphQL ID
 * from Firestore: adminSettings/shopify.publicationId
 */
export async function getPublicationId(): Promise<string | null> {
  if (_publicationIdCache !== undefined) return _publicationIdCache ?? null;

  const ref = doc(db, "adminSettings", "shopify");
  const snap = await getDoc(ref);
  const val = (snap.exists() ? (snap.data().publicationId as string | null | undefined) : null) ?? null;

  _publicationIdCache = val;
  return val;
}

/**
 * Realtime listener (optional) if your UI should update live.
 * Returns unsubscribe() like any Firestore onSnapshot.
 */
export function watchPublicationId(cb: (id: string | null) => void) {
  const ref = doc(db, "adminSettings", "shopify");
  return onSnapshot(ref, (snap) => {
    const val = (snap.exists() ? (snap.data().publicationId as string | null | undefined) : null) ?? null;
    _publicationIdCache = val;
    cb(val);
  });
}

/**
 * Write the Publication ID (admins only).
 * Saves admin uid + timestamp for audit.
 */
export async function setPublicationId(id: string | null): Promise<void> {
  const uid = auth.currentUser?.uid ?? null;
  const ref = doc(db, "adminSettings", "shopify");

  await setDoc(
    ref,
    {
      publicationId: (id ?? "").trim() || null,
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    },
    { merge: true }
  );

  _publicationIdCache = (id ?? "").trim() || null;
}



async function call(action: string, payload: any = {}) {
  const u = auth.currentUser;
  if (!u) throw new Error("Not signed in");
  const idToken = await u.getIdToken(true);

  const r = await fetch("/api/admin/admin?action=" + encodeURIComponent(action), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j?.ok === false) {
    throw new Error(j?.error || `Admin call failed: ${action}`);
  }
  return j;
}

// ---------- exported APIs used by your pages ----------
export const listMerchants = (params: { q?: string } = {}) =>
  call("merchants.list", params);

export const updateMerchant = (uid: string, patch: Record<string, any>) =>
  call("merchants.update", { uid, patch });

export const queueList = (params: { status?: string; limit?: number } = {}) =>
  call("queue.list", params);

export const queueApprove = (id: string, note?: string) =>
  call("queue.approve", { id, note });

export const queueReject = (id: string, reason?: string) =>
  call("queue.reject", { id, reason });

export const supportList = (params: { status?: string } = {}) =>
  call("support.list", params);

export const supportReply = (id: string, message: string, nextStatus?: string) =>
  call("support.reply", { id, message, nextStatus });






// Mock data
const mockQueueProducts: QueueProduct[] = [
  {
    id: "prod_001",
    merchantId: "merchant_001",
    title: "Premium Cotton T-Shirt",
    description: "High-quality cotton t-shirt with premium finish",
    image: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400",
    images: [
      "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400",
      "https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?w=400"
    ],
    price: 799,
    productType: "Apparel",
    status: "in_review",
    published: false,
    tags: ["cotton", "casual", "summer"],
    createdAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
    variantDraft: {
      options: [
        { name: "Size", values: ["S", "M", "L", "XL"] },
        { name: "Color", values: ["Black", "White", "Saffron"] }
      ],
      variants: [
        { optionValues: ["S", "Black"], price: 799, compareAtPrice: 999, sku: "TSH-S-BLK", quantity: 50, barcode: "123456789", weightGrams: 200 },
        { optionValues: ["S", "White"], price: 799, compareAtPrice: 999, sku: "TSH-S-WHT", quantity: 45, barcode: "123456790", weightGrams: 200 },
        { optionValues: ["M", "Black"], price: 799, compareAtPrice: 999, sku: "TSH-M-BLK", quantity: 60, barcode: "123456791", weightGrams: 220 },
        { optionValues: ["L", "Saffron"], price: 799, compareAtPrice: 999, sku: "TSH-L-SAF", quantity: 40, barcode: "123456792", weightGrams: 240 }
      ]
    },
    merchant: { name: "Fashion Hub", email: "fashion@example.com" }
  },
  {
    id: "prod_002",
    merchantId: "merchant_002",
    title: "Wireless Bluetooth Earbuds",
    description: "Premium sound quality with noise cancellation",
    image: "https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=400",
    images: ["https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=400"],
    price: 2499,
    productType: "Electronics",
    status: "in_review",
    published: false,
    tags: ["electronics", "audio", "wireless"],
    createdAt: Date.now() - 1 * 24 * 60 * 60 * 1000,
    merchant: { name: "Tech Store", email: "tech@example.com" }
  },
  {
    id: "prod_003",
    merchantId: "merchant_003",
    title: "Leather Wallet",
    description: "Genuine leather wallet with RFID protection",
    image: "https://images.unsplash.com/photo-1627123424574-724758594e93?w=400",
    images: ["https://images.unsplash.com/photo-1627123424574-724758594e93?w=400"],
    price: 1299,
    productType: "Accessories",
    status: "draft",
    published: false,
    tags: ["leather", "wallet", "accessories"],
    createdAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
    merchant: { name: "Leather Craft", email: "leather@example.com" }
  },
  {
    id: "prod_004",
    merchantId: "merchant_004",
    title: "Yoga Mat Premium",
    description: "Anti-slip yoga mat with carrying strap",
    image: "https://images.unsplash.com/photo-1601925260368-ae2f83cf8b7f?w=400",
    images: ["https://images.unsplash.com/photo-1601925260368-ae2f83cf8b7f?w=400"],
    price: 1599,
    productType: "Sports",
    status: "active",
    published: true,
    tags: ["yoga", "fitness", "sports"],
    createdAt: Date.now() - 10 * 24 * 60 * 60 * 1000,
    merchant: { name: "Fitness Pro", email: "fitness@example.com" }
  },
  {
    id: "prod_005",
    merchantId: "merchant_005",
    title: "Ceramic Coffee Mug Set",
    description: "Set of 4 handcrafted ceramic mugs",
    image: "https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?w=400",
    images: ["https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?w=400"],
    price: 899,
    productType: "Home & Kitchen",
    status: "rejected",
    published: false,
    tags: ["ceramic", "kitchen", "handmade"],
    createdAt: Date.now() - 7 * 24 * 60 * 60 * 1000,
    adminNotes: "Product images quality is poor. Please submit better images.",
    merchant: { name: "Home Essentials", email: "home@example.com" }
  }
];

const mockMerchants: Merchant[] = [
  {
    uid: "merchant_001",
    email: "fashion@example.com",
    name: "Rajesh Kumar",
    phone: "+91 98765 43210",
    storeName: "Fashion Hub",
    businessCategory: "Apparel",
    gstin: "27AABCU9603R1ZM",
    address: "123 MG Road, Mumbai, Maharashtra",
    enabled: true,
    createdAt: Date.now() - 90 * 24 * 60 * 60 * 1000
  },
  {
    uid: "merchant_002",
    email: "tech@example.com",
    name: "Priya Sharma",
    phone: "+91 98765 43211",
    storeName: "Tech Store",
    businessCategory: "Electronics",
    gstin: "29AABCU9603R1ZN",
    address: "456 Brigade Road, Bangalore, Karnataka",
    enabled: true,
    createdAt: Date.now() - 120 * 24 * 60 * 60 * 1000
  },
  {
    uid: "merchant_003",
    email: "leather@example.com",
    name: "Amit Patel",
    phone: "+91 98765 43212",
    storeName: "Leather Craft",
    businessCategory: "Accessories",
    gstin: "24AABCU9603R1ZO",
    address: "789 CG Road, Ahmedabad, Gujarat",
    enabled: false,
    createdAt: Date.now() - 60 * 24 * 60 * 60 * 1000
  },
  {
    uid: "merchant_004",
    email: "fitness@example.com",
    name: "Sneha Singh",
    phone: "+91 98765 43213",
    storeName: "Fitness Pro",
    businessCategory: "Sports & Fitness",
    gstin: "07AABCU9603R1ZP",
    address: "321 Connaught Place, New Delhi",
    enabled: true,
    createdAt: Date.now() - 150 * 24 * 60 * 60 * 1000
  },
  {
    uid: "merchant_005",
    email: "home@example.com",
    name: "Vikram Reddy",
    phone: "+91 98765 43214",
    storeName: "Home Essentials",
    businessCategory: "Home & Kitchen",
    gstin: "36AABCU9603R1ZQ",
    address: "654 Jubilee Hills, Hyderabad, Telangana",
    enabled: true,
    createdAt: Date.now() - 45 * 24 * 60 * 60 * 1000
  }
];

const mockSupportTickets: SupportTicket[] = [
  {
    id: "ticket_001",
    merchantId: "merchant_001",
    subject: "Payment not received for Order #12345",
    message: "I haven't received payment for my order placed 5 days ago. Please help.",
    category: "payment",
    priority: "high",
    status: "pending",
    email: "fashion@example.com",
    name: "Rajesh Kumar",
    createdAt: Date.now() - 1 * 24 * 60 * 60 * 1000,
    timeline: [
      { at: Date.now() - 1 * 24 * 60 * 60 * 1000, by: "merchant", type: "created", note: "Ticket created" }
    ]
  },
  {
    id: "ticket_002",
    merchantId: "merchant_002",
    subject: "How to add product variants?",
    message: "I need help understanding how to add size and color variants to my products.",
    category: "product",
    priority: "medium",
    status: "processing",
    email: "tech@example.com",
    name: "Priya Sharma",
    createdAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
    timeline: [
      { at: Date.now() - 3 * 24 * 60 * 60 * 1000, by: "merchant", type: "created", note: "Ticket created" },
      { at: Date.now() - 2 * 24 * 60 * 60 * 1000, by: "admin", type: "status", note: "Status changed to processing" },
      { at: Date.now() - 2 * 24 * 60 * 60 * 1000, by: "admin", type: "message", note: "We'll send you a detailed guide shortly." }
    ]
  },
  {
    id: "ticket_003",
    merchantId: "merchant_003",
    subject: "Account suspended without reason",
    message: "My account was suspended. I need to know the reason and how to resolve this.",
    category: "account",
    priority: "critical",
    status: "processing",
    email: "leather@example.com",
    name: "Amit Patel",
    createdAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
    timeline: [
      { at: Date.now() - 2 * 24 * 60 * 60 * 1000, by: "merchant", type: "created", note: "Ticket created" },
      { at: Date.now() - 1 * 24 * 60 * 60 * 1000, by: "admin", type: "status", note: "Status changed to processing" }
    ]
  },
  {
    id: "ticket_004",
    merchantId: "merchant_004",
    subject: "Website loading slow",
    message: "The seller dashboard is loading very slowly since yesterday.",
    category: "technical",
    priority: "medium",
    status: "resolved",
    email: "fitness@example.com",
    name: "Sneha Singh",
    createdAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
    timeline: [
      { at: Date.now() - 5 * 24 * 60 * 60 * 1000, by: "merchant", type: "created", note: "Ticket created" },
      { at: Date.now() - 4 * 24 * 60 * 60 * 1000, by: "admin", type: "status", note: "Status changed to processing" },
      { at: Date.now() - 3 * 24 * 60 * 60 * 1000, by: "admin", type: "message", note: "We've optimized the servers. Please check now." },
      { at: Date.now() - 3 * 24 * 60 * 60 * 1000, by: "admin", type: "status", note: "Status changed to resolved" }
    ]
  },
  {
    id: "ticket_005",
    merchantId: "merchant_005",
    subject: "Need help with order cancellation",
    message: "Customer wants to cancel order but option is not showing.",
    category: "order",
    priority: "low",
    status: "pending",
    email: "home@example.com",
    name: "Vikram Reddy",
    createdAt: Date.now() - 4 * 24 * 60 * 60 * 1000,
    timeline: [
      { at: Date.now() - 4 * 24 * 60 * 60 * 1000, by: "merchant", type: "created", note: "Ticket created" }
    ]
  }
];


export async function listSupport(params: {
  status?: string;
  q?: string;
  cursor?: string;
}): Promise<{ ok: true; items: SupportTicket[] }> {
  return new Promise((resolve) => {
    setTimeout(() => {
      let filtered = [...mockSupportTickets];

      if (params.status && params.status !== "all") {
        filtered = filtered.filter((t) => t.status === params.status);
      }

      if (params.q) {
        const query = params.q.toLowerCase();
        filtered = filtered.filter(
          (t) =>
            t.subject.toLowerCase().includes(query) ||
            t.name?.toLowerCase().includes(query)
        );
      }

      resolve({ ok: true, items: filtered });
    }, 400);
  });
}

export async function replySupport(
  id: string,
  message: string,
  newStatus?: "processing" | "resolved"
): Promise<{ ok: true }> {
  return new Promise((resolve) => {
    setTimeout(() => {
      const ticket = mockSupportTickets.find((t) => t.id === id);
      if (ticket) {
        ticket.timeline.push({
          at: Date.now(),
          by: "admin",
          type: "message",
          note: message,
        });
        if (newStatus) {
          ticket.status = newStatus;
          ticket.timeline.push({
            at: Date.now(),
            by: "admin",
            type: "status",
            note: `Status changed to ${newStatus}`,
          });
        }
      }
      resolve({ ok: true });
    }, 450);
  });
}
