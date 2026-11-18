// src/lib/generateShippingLabel.ts
//
// The shipping label DRIPPR prints for a local (hyperlocal) delivery.
//
// Orders leaving the seller's city travel with the courier's own label, which
// the admin uploads. Orders delivered locally have no courier, so this is the
// label: it is what the rider reads and what goes on the parcel.
//
// It is a 4x6 inch page, the size every thermal label printer takes, and it
// deliberately carries NO buyer phone number. A label is handled by everyone
// the parcel passes and is often left on the packaging after delivery; the
// rider gets the contact number through the app, where it can be withdrawn.

import jsPDF from "jspdf";
import { encode as encodeBarcode } from "./code128";
import type { CustomerAddress } from "./orderCustomer";

// ─── Types ───────────────────────────────────────────────────────────

export type LabelLineItem = {
  title?: string;
  name?: string;
  sku?: string;
  variantTitle?: string | null;
  quantity?: number;
};

export type LabelOrder = {
  orderNumber?: string;
  shopifyOrderId: string;
  createdAt: number;
  financialStatus?: string | null;
  shippingAddress?: CustomerAddress | null;
  lineItems?: LabelLineItem[];
};

export type LabelSeller = {
  storeName?: string;
  businessName?: string;
  name?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  phone?: string;
};

export type ShippingLabelOptions = {
  order: LabelOrder;
  seller?: LabelSeller | null;
};

// ─── Layout ──────────────────────────────────────────────────────────

/** 4 x 6 inch, in millimetres: the standard thermal shipping label. */
const PAGE_W = 101.6;
const PAGE_H = 152.4;
const MARGIN = 5;
const CONTENT_W = PAGE_W - MARGIN * 2;

const INK: [number, number, number] = [0, 0, 0];
const MUTED: [number, number, number] = [90, 90, 90];
const RULE: [number, number, number] = [0, 0, 0];

// ─── Helpers ─────────────────────────────────────────────────────────

const text = (value: unknown) => String(value ?? "").trim();

function sellerName(seller?: LabelSeller | null) {
  return (
    text(seller?.businessName) ||
    text(seller?.storeName) ||
    text(seller?.name) ||
    "DRIPPR Seller"
  );
}

function sellerLines(seller?: LabelSeller | null) {
  const cityLine = [seller?.city, seller?.state, seller?.pincode]
    .map(text)
    .filter(Boolean)
    .join(", ");
  return [text(seller?.address), cityLine].filter(Boolean);
}

/**
 * The buyer's address, minus the phone number.
 *
 * `phone` is not read here at all, rather than read and dropped, so the
 * omission cannot be undone by a later edit that "tidies up" the formatter.
 */
function buyerLines(address?: CustomerAddress | null) {
  if (!address) return [] as string[];
  return [text(address.address1), text(address.address2)].filter(Boolean);
}

function paymentBadge(order: LabelOrder) {
  const status = String(order.financialStatus || "").toLowerCase();
  if (status === "paid" || status === "partially_paid") return "PREPAID";
  return "COLLECT ON DELIVERY";
}

function fmtDate(ms: number) {
  const d = new Date(ms || Date.now());
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Stable, short, human-readable handle used on the barcode. */
export function labelReference(order: LabelOrder) {
  const digits = String(order.orderNumber || order.shopifyOrderId || "")
    .replace(/[^0-9]/g, "")
    .slice(-10);
  return "DRP" + (digits || "0");
}

async function loadLogo(): Promise<string | null> {
  for (const path of ["/logo_small.png", "/logo_rounded.png"]) {
    try {
      const response = await fetch(path);
      if (!response.ok) continue;
      const blob = await response.blob();
      const dataUrl = await new Promise<string | null>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
      if (dataUrl) return dataUrl;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

// ─── Sections ────────────────────────────────────────────────────────

function rule(doc: jsPDF, y: number, weight = 0.4) {
  doc.setDrawColor(...RULE);
  doc.setLineWidth(weight);
  doc.line(MARGIN, y, MARGIN + CONTENT_W, y);
}

function sectionLabel(doc: jsPDF, y: number, label: string) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  doc.setTextColor(...MUTED);
  doc.text(label.toUpperCase(), MARGIN, y);
  return y + 3.6;
}

function drawHeader(doc: jsPDF, y: number, logo: string | null, order: LabelOrder) {
  const h = 13;
  if (logo) {
    try {
      doc.addImage(logo, "PNG", MARGIN, y, h, h);
    } catch {
      /* fall through to the wordmark */
    }
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...INK);
  doc.text("DRIPPR", MARGIN + (logo ? h + 2.5 : 0), y + 8.5);

  // Payment stance, boxed so it reads at arm's length.
  const badge = paymentBadge(order);
  doc.setFontSize(badge.length > 8 ? 7 : 9);
  const badgeW = doc.getTextWidth(badge) + 5;
  const badgeX = MARGIN + CONTENT_W - badgeW;
  doc.setFillColor(...INK);
  doc.rect(badgeX, y + 3, badgeW, 7, "F");
  doc.setTextColor(255, 255, 255);
  doc.text(badge, badgeX + badgeW / 2, y + 7.9, { align: "center" });

  doc.setTextColor(...INK);
  return y + h + 2;
}

function drawBuyer(doc: jsPDF, y: number, order: LabelOrder) {
  let cursor = sectionLabel(doc, y + 3.5, "Deliver to");

  const address = order.shippingAddress || null;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...INK);
  const name = text(address?.name) || "Customer";
  for (const line of doc.splitTextToSize(name, CONTENT_W)) {
    doc.text(line, MARGIN, cursor);
    cursor += 5;
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  for (const raw of buyerLines(address)) {
    for (const line of doc.splitTextToSize(raw, CONTENT_W)) {
      doc.text(line, MARGIN, cursor);
      cursor += 4.2;
    }
  }

  const cityLine = [address?.city, address?.province]
    .map(text)
    .filter(Boolean)
    .join(", ");
  if (cityLine) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    for (const line of doc.splitTextToSize(cityLine, CONTENT_W)) {
      doc.text(line, MARGIN, cursor);
      cursor += 4.6;
    }
  }

  // The PIN decides the route, so it is the largest thing on the label.
  const zip = text(address?.zip);
  if (zip) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(17);
    doc.text(zip, MARGIN, cursor + 3.5);
    cursor += 8;
  }

  return cursor + 1.5;
}

function drawBarcode(doc: jsPDF, y: number, reference: string) {
  const symbol = encodeBarcode(reference);
  const barsH = 13;

  if (symbol) {
    const moduleW = CONTENT_W / symbol.modules;
    doc.setFillColor(...INK);
    for (const bar of symbol.bars) {
      doc.rect(MARGIN + bar.start * moduleW, y, bar.width * moduleW, barsH, "F");
    }
    y += barsH + 3.4;
  } else {
    // Never print a symbol that could not be built; the text alone is
    // honest and still keyable at the counter.
    y += 1;
  }

  doc.setFont("courier", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...INK);
  doc.text(reference, PAGE_W / 2, y, { align: "center" });
  return y + 2.5;
}

function drawSeller(doc: jsPDF, y: number, seller?: LabelSeller | null) {
  let cursor = sectionLabel(doc, y + 3.5, "Pickup from / return to");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  for (const line of doc.splitTextToSize(sellerName(seller), CONTENT_W)) {
    doc.text(line, MARGIN, cursor);
    cursor += 4;
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  for (const raw of sellerLines(seller)) {
    for (const line of doc.splitTextToSize(raw, CONTENT_W)) {
      doc.text(line, MARGIN, cursor);
      cursor += 3.6;
    }
  }
  // The seller's number is a return contact, not the buyer's detail.
  if (text(seller?.phone)) {
    doc.text("Tel " + text(seller?.phone), MARGIN, cursor);
    cursor += 3.6;
  }

  doc.setTextColor(...INK);
  return cursor + 1;
}

function drawMeta(doc: jsPDF, y: number, order: LabelOrder) {
  const h = 9;
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.3);
  doc.rect(MARGIN, y, CONTENT_W, h);

  const cells: Array<[string, string]> = [
    ["ORDER", String(order.orderNumber || order.shopifyOrderId || "-")],
    ["DATE", fmtDate(order.createdAt)],
    ["MODE", "LOCAL"],
  ];
  const colW = CONTENT_W / cells.length;
  cells.forEach(([label, value], index) => {
    const x = MARGIN + colW * index;
    if (index) doc.line(x, y, x, y + h);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.6);
    doc.setTextColor(...MUTED);
    doc.text(label, x + 1.8, y + 3.4);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...INK);
    doc.text(doc.splitTextToSize(value, colW - 3.4)[0], x + 1.8, y + 7.2);
  });

  return y + h + 1.5;
}

function drawContents(doc: jsPDF, y: number, order: LabelOrder, limitY: number) {
  let cursor = sectionLabel(doc, y + 3, "Contents");
  const items = order.lineItems || [];

  doc.setFontSize(7.5);
  let shown = 0;
  for (const item of items) {
    if (cursor > limitY - 4) break;
    const qty = Math.max(1, Number(item.quantity) || 1);
    const title = text(item.name || item.title) || "Item";

    doc.setFont("helvetica", "bold");
    doc.setTextColor(...INK);
    doc.text(String(qty) + "x", MARGIN, cursor);

    doc.setFont("helvetica", "normal");
    const line = doc.splitTextToSize(title, CONTENT_W - 7)[0];
    doc.text(line, MARGIN + 6, cursor);
    cursor += 3.3;

    if (text(item.sku)) {
      doc.setFont("courier", "normal");
      doc.setFontSize(6.6);
      doc.setTextColor(...MUTED);
      doc.text(
        doc.splitTextToSize(text(item.sku), CONTENT_W - 7)[0],
        MARGIN + 6,
        cursor,
      );
      doc.setFontSize(7.5);
      doc.setTextColor(...INK);
      cursor += 3.3;
    }
    shown += 1;
  }

  const remaining = items.length - shown;
  if (remaining > 0 && cursor < limitY) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(`+${remaining} more item${remaining > 1 ? "s" : ""}`, MARGIN, cursor);
    doc.setTextColor(...INK);
  }
}

function drawFooter(doc: jsPDF) {
  const y = PAGE_H - MARGIN - 4.5;
  rule(doc, y - 2.5, 0.3);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.8);
  doc.setTextColor(...MUTED);
  doc.text(
    "Do not accept if the seal is broken. Keep this label on the parcel until delivery.",
    PAGE_W / 2,
    y + 1.2,
    { align: "center" },
  );
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6);
  doc.setTextColor(...INK);
  doc.text("drippr.in", PAGE_W / 2, y + 4.4, { align: "center" });
}

// ─── Main generator ──────────────────────────────────────────────────

export async function generateShippingLabel(
  options: ShippingLabelOptions,
): Promise<Blob> {
  const { order, seller } = options;

  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: [PAGE_W, PAGE_H],
    compress: true,
  });

  const logo = await loadLogo();

  let y = MARGIN;
  y = drawHeader(doc, y, logo, order);
  rule(doc, y, 0.6);

  y = drawBuyer(doc, y, order);
  rule(doc, y, 0.3);

  y = drawBarcode(doc, y + 2.5, labelReference(order));
  rule(doc, y, 0.3);

  y = drawSeller(doc, y, seller);
  rule(doc, y, 0.3);

  y = drawMeta(doc, y + 1.5, order);
  drawContents(doc, y, order, PAGE_H - MARGIN - 10);
  drawFooter(doc);

  return doc.output("blob");
}
