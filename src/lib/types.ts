// src/lib/types.ts
export type Merchant = {
  id: string;                // same as Firebase auth uid
  email: string;
  phone: string;
  businessName: string;
  displayName?: string;
  status: "active" | "blocked";
  kycStatus?: "pending" | "verified" | "rejected";
  commissionRate?: number;   // e.g., 0.10 for 10%
  createdAt: number;         // Date.now()
  payoutInfo?: {
    upi?: string;
    bank?: { acct?: string; ifsc?: string; name?: string };
  };
};

export type MerchantProduct = {
  id: string;                // Firestore doc id
  merchantId: string;
  title: string;
  description: string;
  price: number;
  currency: "INR";
  status: "draft" | "active" | "archived";
  sku?: string;              // merchantProductId, will be SKU on Shopify
  shopifyProductId?: string;
  shopifyVariantIds?: string[];
  tags?: string[];
  imageUrls?: string[];
  inventoryQty?: number;
  createdAt: number;
  updatedAt: number;
};