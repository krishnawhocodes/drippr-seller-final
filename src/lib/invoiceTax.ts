// src/lib/invoiceTax.ts
// Money and GST maths for the tax invoice, kept separate from rendering so the
// numbers can be tested on their own.
//
// Every price that reaches us from Shopify is tax-inclusive and already carries
// the delivery charge inside the variant price, so all figures here are derived
// backwards from what the customer actually paid. The grand total therefore
// equals the amount charged, by construction.

export const GST_RATE = 0.05;
/** Delivery baked into each unit's Shopify price by the seller panel. */
export const DELIVERY_PER_UNIT = 100;
/** Default HSN for knitted apparel; overridden per line when we know better. */
export const DEFAULT_HSN = "6109";
/** SAC for goods-transport / logistics services. */
export const DELIVERY_HSN = "996812";

export type TaxBreakdown = {
  kind: "igst" | "intra";
  igst: number;
  cgst: number;
  sgst: number;
  label: string;
};

export type InvoiceRow = {
  description: string;
  hsn: string;
  quantity: number;
  /** Line value before discount, tax inclusive. */
  gross: number;
  discount: number;
  /** gross - discount, tax inclusive. This is what the customer paid. */
  net: number;
  taxableValue: number;
  tax: TaxBreakdown;
};

export type InvoiceTotals = {
  rows: InvoiceRow[];
  gross: number;
  discount: number;
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  taxTotal: number;
  /** Equals the sum of row.net, i.e. exactly what the customer paid. */
  grandTotal: number;
  /** True when seller and buyer are in the same state (CGST + SGST). */
  intraState: boolean;
  placeOfSupply: string;
  sellerState: string;
};

function round2(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/** A GSTIN encodes the seller's state in its first two digits. */
export const GST_STATE_CODES: Record<string, string> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
};

/** Normalises "Tamil Nadu", "TAMILNADU" and "tamil-nadu" to one key. */
function stateKey(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

export function sellerStateFromGstin(gstin: unknown): string {
  const code = String(gstin || "").trim().slice(0, 2);
  return GST_STATE_CODES[code] || "";
}

/**
 * Where the supply is made from.
 *
 * A GSTIN encodes the state it was issued in, and that is the state GST law
 * cares about, so it outranks anything typed into a profile. Sellers who have
 * not given a GSTIN yet still have a state on their address, which is enough
 * to place the supply correctly.
 */
export function resolveSellerState(seller: {
  gstin?: unknown;
  state?: unknown;
}): string {
  const fromGstin = sellerStateFromGstin(seller?.gstin);
  if (fromGstin) return fromGstin;
  return String(seller?.state || "").trim();
}

/**
 * Intra-state supplies attract CGST + SGST; everything else attracts IGST.
 *
 * Both states have to be known to call it intra-state. An unknown state means
 * we cannot prove the supply stayed put, and IGST is the safer default on a
 * marketplace invoice: charging IGST where CGST + SGST was due is a
 * classification error, while under-collecting is a shortfall.
 */
export function isIntraState(sellerState: unknown, buyerState: unknown) {
  const seller = stateKey(sellerState);
  const buyer = stateKey(buyerState);
  if (!seller || !buyer) return false;
  return seller === buyer;
}

function splitTax(taxAmount: number, intraState: boolean): TaxBreakdown {
  if (intraState) {
    const half = round2(taxAmount / 2);
    // Any rounding remainder goes to SGST so cgst + sgst === taxAmount exactly.
    return {
      kind: "intra",
      igst: 0,
      cgst: half,
      sgst: round2(taxAmount - half),
      label: "CGST @2.5% + SGST @2.5%",
    };
  }
  return {
    kind: "igst",
    igst: round2(taxAmount),
    cgst: 0,
    sgst: 0,
    label: "IGST @5.0%",
  };
}

/** Reverse-calculates the taxable value and tax from a tax-inclusive amount. */
export function reverseGst(inclusiveAmount: number, intraState: boolean) {
  const net = round2(inclusiveAmount);
  const taxableValue = round2(net / (1 + GST_RATE));
  // Derive tax as the remainder so taxableValue + tax === net to the paisa.
  const taxAmount = round2(net - taxableValue);
  return { net, taxableValue, tax: splitTax(taxAmount, intraState) };
}

export type SourceLineItem = {
  title?: string;
  name?: string;
  sku?: string;
  variantTitle?: string | null;
  quantity?: number;
  price?: number;
  total?: number;
  discount?: number;
  discountedTotal?: number;
  hsn?: string;
};

function lineLabel(item: SourceLineItem) {
  const base = String(item.name || item.title || "Item").trim();
  const variant = String(item.variantTitle || "").trim();
  return variant && !base.toLowerCase().includes(variant.toLowerCase())
    ? base + " - " + variant
    : base;
}

/**
 * Builds the invoice rows.
 *
 * Delivery is itemised as its own line because the seller panel bakes a flat
 * amount per unit into the Shopify price, and both customers and auditors
 * expect to see it separately. Splitting it never changes the total: the
 * product line plus the delivery line always add back to what was charged.
 */
export function buildInvoiceTotals(args: {
  lineItems: SourceLineItem[];
  /** Where the seller supplies from; see resolveSellerState. */
  sellerState?: unknown;
  buyerState?: unknown;
  deliveryPerUnit?: number;
}): InvoiceTotals {
  const intraState = isIntraState(args.sellerState, args.buyerState);
  const deliveryPerUnit = Number.isFinite(Number(args.deliveryPerUnit))
    ? Number(args.deliveryPerUnit)
    : DELIVERY_PER_UNIT;

  const rows: InvoiceRow[] = [];
  let deliveryGrossTotal = 0;
  let deliveryNetTotal = 0;

  for (const item of args.lineItems || []) {
    const quantity = Math.max(0, Number(item.quantity) || 0);
    const unitPrice = Number(item.price) || 0;
    const gross = round2(
      item.total != null && Number.isFinite(Number(item.total))
        ? Number(item.total)
        : unitPrice * quantity,
    );
    const discount = round2(Number(item.discount) || 0);
    const net = round2(
      item.discountedTotal != null
        ? Number(item.discountedTotal)
        : gross - discount,
    );
    if (!quantity && !net) continue;

    // Only peel out delivery when the unit price can actually carry it, so a
    // legacy order priced below the delivery charge is never driven negative.
    const carriesDelivery = deliveryPerUnit > 0 && unitPrice > deliveryPerUnit;
    const wantedDelivery = carriesDelivery
      ? round2(deliveryPerUnit * quantity)
      : 0;
    // Split the delivery out of the list price and out of what was actually
    // paid separately. A heavily discounted line can pay less than the full
    // delivery charge - at 100% off it pays nothing at all - and capping each
    // side at what is there keeps every figure on the invoice at or above
    // zero. Taking the full charge off a discounted line is what produced
    // negative taxable values on fully discounted orders.
    const deliveryGross = Math.min(wantedDelivery, Math.max(0, gross));
    const deliveryNet = Math.min(wantedDelivery, Math.max(0, net));

    const productGross = round2(Math.max(0, gross - deliveryGross));
    const productNet = round2(Math.max(0, net - deliveryNet));

    deliveryGrossTotal = round2(deliveryGrossTotal + deliveryGross);
    deliveryNetTotal = round2(deliveryNetTotal + deliveryNet);

    const { taxableValue, tax } = reverseGst(productNet, intraState);
    rows.push({
      description: lineLabel(item),
      hsn: String(item.hsn || DEFAULT_HSN),
      quantity,
      gross: productGross,
      // Derived rather than copied from Shopify so that every row reconciles:
      // gross - discount === net, on each line and in the totals.
      discount: round2(productGross - productNet),
      net: productNet,
      taxableValue,
      tax,
    });
  }

  if (deliveryGrossTotal > 0) {
    const { taxableValue, tax } = reverseGst(deliveryNetTotal, intraState);
    rows.push({
      description: "Delivery Charges",
      hsn: DELIVERY_HSN,
      quantity: 1,
      gross: deliveryGrossTotal,
      discount: round2(deliveryGrossTotal - deliveryNetTotal),
      net: deliveryNetTotal,
      taxableValue,
      tax,
    });
  }

  const sum = (pick: (row: InvoiceRow) => number) =>
    round2(rows.reduce((total, row) => total + pick(row), 0));

  const igst = sum((row) => row.tax.igst);
  const cgst = sum((row) => row.tax.cgst);
  const sgst = sum((row) => row.tax.sgst);

  return {
    rows,
    gross: sum((row) => row.gross),
    discount: sum((row) => row.discount),
    taxableValue: sum((row) => row.taxableValue),
    igst,
    cgst,
    sgst,
    taxTotal: round2(igst + cgst + sgst),
    grandTotal: sum((row) => row.net),
    intraState,
    placeOfSupply: String(args.buyerState || "").trim(),
    sellerState: String(args.sellerState || "").trim(),
  };
}

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];

const TENS = [
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety",
];

function twoDigits(value: number): string {
  if (value < 20) return ONES[value];
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  return ones ? TENS[tens] + " " + ONES[ones] : TENS[tens];
}

function threeDigits(value: number): string {
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  const parts: string[] = [];
  if (hundreds) parts.push(ONES[hundreds] + " Hundred");
  if (rest) parts.push(twoDigits(rest));
  return parts.join(" ");
}

/** Indian numbering: crore / lakh / thousand. */
function wholeToWords(value: number): string {
  if (value === 0) return "Zero";
  const crore = Math.floor(value / 10000000);
  const lakh = Math.floor((value % 10000000) / 100000);
  const thousand = Math.floor((value % 100000) / 1000);
  const rest = value % 1000;
  const parts: string[] = [];
  if (crore) parts.push(threeDigits(crore) + " Crore");
  if (lakh) parts.push(threeDigits(lakh) + " Lakh");
  if (thousand) parts.push(threeDigits(thousand) + " Thousand");
  if (rest) parts.push(threeDigits(rest));
  return parts.join(" ").trim();
}

/** "Nine Hundred Ninety Nine Rupees and Fifty Paise Only" */
export function amountInWords(amount: number): string {
  const safe = Math.abs(round2(amount));
  const rupees = Math.floor(safe);
  const paise = Math.round((safe - rupees) * 100);
  const head = wholeToWords(rupees) + (rupees === 1 ? " Rupee" : " Rupees");
  return paise
    ? head + " and " + wholeToWords(paise) + " Paise Only"
    : head + " Only";
}

/**
 * Stable, readable invoice number derived from the order, so re-downloading an
 * invoice always produces the same number.
 */
export function invoiceNumberFor(orderNumber: string, createdAt: number) {
  const digits = String(orderNumber || "").replace(/[^0-9]/g, "");
  const serial = (digits || "0").slice(-6).padStart(6, "0");
  const date = new Date(createdAt || Date.now());
  const year = date.getFullYear();
  // Indian financial year runs April to March.
  const fyStart = date.getMonth() >= 3 ? year : year - 1;
  const fyEnd = String((fyStart + 1) % 100).padStart(2, "0");
  return "DRP/" + fyStart + "-" + fyEnd + "/" + serial;
}
