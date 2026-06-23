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

export type GarmentCategory = "Tops" | "Bottoms";
export type FitType = "Slim" | "Regular" | "Oversized";

export interface Variant {
  options: string[];
  title: string;
  price?: number;
  compareAtPrice?: number;
  sku?: string;
  quantity?: number;
  barcode?: string;
  weightGrams?: number;
  chest?: number | null;
  length?: number | null;
  shoulder?: number | null;
  waist?: number | null;
  hip?: number | null;
  inseam?: number | null;
  mediaUrls?: string[];
}

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
