export type VariantDraft = {
  options: { name: string; values: string[] }[];
  variants: {
    options?: string[];
    optionValues: string[];
    title?: string;
    price?: number;
    compareAtPrice?: number;
    sku?: string;
    quantity?: number;
    barcode?: string;
    weightGrams?: number;
    measurements?: {
      bust?: number | null;
      waist?: number | null;
      hip?: number | null;
      length?: number | null;
      unit?: "in";
    } | null;
  }[];
};

export type QueueProduct = {
  id: string;
  merchantId: string;
  title: string;
  description?: string;
  image?: string | null;
  images?: string[];
  price?: number;
  productType?: string | null;
  status: "in_review" | "draft" | "active" | "rejected";
  published?: boolean;
  tags?: string[];
  createdAt: number;
  variantDraft?: VariantDraft | null;
  adminNotes?: string | null;
  merchant?: { name?: string; email?: string };
};

export type Merchant = {
  uid: string;
  email?: string;
  name?: string;
  phone?: string;
  storeName?: string;
  businessCategory?: string;
  gstin?: string;
  address?: string;
  enabled?: boolean;
  createdAt?: number;
};

export type SupportTicket = {
  id: string;
  merchantId: string;
  subject: string;
  message: string;
  category: "order" | "payment" | "product" | "account" | "technical" | "other";
  priority: "low" | "medium" | "high" | "critical";
  status: "pending" | "processing" | "resolved";
  email?: string;
  name?: string;
  createdAt: number;
  timeline: { at: number; by: "merchant" | "admin"; type: "created" | "message" | "status"; note: string }[];
  adminReply?: string;
};

export type AdminOverview = {
  productsInReview: number;
  activeSellers: number;
  openTickets: number;
  mtdOrders: number;
  mtdRevenue: number;
  ordersSeries: { day: string; orders: number }[];
  revenueSeries: { day: string; revenue: number }[];
};
