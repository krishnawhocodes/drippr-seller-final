// src/lib/generateInvoicePdf.ts
// Professional GST tax invoice for a DRIPPR marketplace order.
//
// This is the invoice ONLY. The shipping label is a separate artefact uploaded
// by the admin when an order ships out of city, and is never mixed in here.
//
// All money comes from src/lib/invoiceTax.ts, which derives every figure
// backwards from the tax-inclusive amount the customer actually paid, so the
// grand total on this document always equals the amount charged.

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  amountInWords,
  buildInvoiceTotals,
  invoiceNumberFor,
  type InvoiceTotals,
  type SourceLineItem,
} from "./invoiceTax";

// ─── Types ───────────────────────────────────────────────────────────

export type InvoiceLineItem = SourceLineItem & {
  variant_id?: string;
  product_id?: string;
};

export type InvoiceAddress = {
  name?: string;
  address1?: string;
  address2?: string;
  city?: string;
  province?: string;
  zip?: string;
  country?: string;
  phone?: string;
};

export type InvoiceOrder = {
  orderNumber?: string;
  shopifyOrderId: string;
  createdAt: number;
  lineItems?: InvoiceLineItem[];
  subtotal?: number;
  discountedSubtotal?: number;
  totalDiscounts?: number;
  totalPrice?: number;
  currency?: string;
  financialStatus?: string | null;
  customerEmail?: string | null;
  customerName?: string | null;
  shippingAddress?: InvoiceAddress | null;
};

export type InvoiceMerchant = {
  storeName?: string;
  businessName?: string;
  name?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  gstin?: string;
  phone?: string;
  email?: string;
};

export type InvoiceOptions = {
  /** "invoice" marks the recipient copy, "billing_slip" the supplier copy. */
  type: "billing_slip" | "invoice";
  order: InvoiceOrder;
  merchant?: InvoiceMerchant | null;
};

// ─── Layout constants ────────────────────────────────────────────────

const PAGE_W = 210;
const MARGIN = 12;
const CONTENT_W = PAGE_W - MARGIN * 2;
const INK: [number, number, number] = [17, 17, 17];
const MUTED: [number, number, number] = [110, 110, 110];
const RULE: [number, number, number] = [205, 205, 205];
const WASH: [number, number, number] = [246, 246, 246];

// ─── Helpers ─────────────────────────────────────────────────────────

function fmtDate(ms: number): string {
  const d = new Date(ms || Date.now());
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** jsPDF's core fonts have no rupee glyph, so money is prefixed "Rs." */
function money(value: number): string {
  return `Rs.${(Number(value) || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function cleanLines(values: Array<string | undefined | null>) {
  return values.map((v) => String(v || "").trim()).filter(Boolean);
}

function formatAddress(address?: InvoiceAddress | null) {
  if (!address) return [] as string[];
  const cityLine = cleanLines([
    address.city,
    address.province,
    address.zip,
  ]).join(", ");
  return cleanLines([
    address.address1,
    address.address2,
    cityLine,
    address.country,
    address.phone ? `Phone: ${address.phone}` : "",
  ]);
}

function sellerAddressLines(merchant?: InvoiceMerchant | null) {
  if (!merchant) return [] as string[];
  const cityLine = cleanLines([
    merchant.city,
    merchant.state,
    merchant.pincode,
  ]).join(", ");
  return cleanLines([merchant.address, cityLine]);
}

function paymentMode(order: InvoiceOrder) {
  const status = String(order.financialStatus || "").toLowerCase();
  if (status === "paid" || status === "partially_paid") return "Prepaid";
  if (status === "pending" || status === "authorized") return "Pay on Delivery";
  return status ? status.replace(/_/g, " ") : "Prepaid";
}

/** Loads the DRIPPR mark as a data URL. Returns null if it cannot be read. */
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

// ─── Section renderers ───────────────────────────────────────────────

function drawHeader(
  doc: jsPDF,
  y: number,
  logo: string | null,
  copyLabel: string,
) {
  const boxH = 26;
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.3);
  doc.rect(MARGIN, y, CONTENT_W, boxH);

  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.text("TAX INVOICE", MARGIN + 5, y + 11);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text(copyLabel, MARGIN + 5, y + 18);

  // DRIPPR mark, top right, square aspect preserved.
  const logoSize = 17;
  const logoX = MARGIN + CONTENT_W - logoSize - 5;
  const logoY = y + (boxH - logoSize) / 2;
  if (logo) {
    try {
      doc.addImage(logo, "PNG", logoX, logoY, logoSize, logoSize);
    } catch {
      /* fall through to the wordmark */
    }
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...INK);
  doc.text("DRIPPR", logoX - 3, y + boxH / 2 + 1.5, { align: "right" });

  return y + boxH;
}

function drawParties(
  doc: jsPDF,
  y: number,
  order: InvoiceOrder,
  merchant: InvoiceMerchant | null | undefined,
  totals: InvoiceTotals,
) {
  const halfW = CONTENT_W / 2;
  const padX = 5;
  const headerH = 7;

  const buyerName =
    order.shippingAddress?.name ||
    order.customerName ||
    order.customerEmail ||
    "Customer";
  const buyerLines = formatAddress(order.shippingAddress);
  if (!buyerLines.length && order.customerEmail) {
    buyerLines.push(String(order.customerEmail));
  }

  const sellerName =
    merchant?.businessName ||
    merchant?.storeName ||
    merchant?.name ||
    "DRIPPR Marketplace Seller";
  const sellerLines = sellerAddressLines(merchant);

  // Measure both columns first so the two halves share one height.
  const wrap = (lines: string[]) =>
    lines.flatMap((line) => doc.splitTextToSize(line, halfW - padX * 2));
  doc.setFontSize(8.5);
  const buyerWrapped = wrap(buyerLines);
  const sellerWrapped = wrap(sellerLines);
  const rows = Math.max(buyerWrapped.length, sellerWrapped.length);
  const boxH = headerH + 6 + rows * 4 + 7;

  doc.setDrawColor(...RULE);
  doc.rect(MARGIN, y, CONTENT_W, boxH);
  doc.line(MARGIN + halfW, y, MARGIN + halfW, y + boxH);

  doc.setFillColor(...WASH);
  doc.rect(MARGIN + 0.15, y + 0.15, CONTENT_W - 0.3, headerH - 0.3, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...INK);
  doc.text("BILL TO / SHIP TO", MARGIN + padX, y + 4.8);
  doc.text("SOLD BY", MARGIN + halfW + padX, y + 4.8);

  const writeColumn = (
    x: number,
    name: string,
    lines: string[],
    footer: string,
  ) => {
    let cursor = y + headerH + 5;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...INK);
    doc.text(name, x, cursor);
    cursor += 4.5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(60, 60, 60);
    for (const line of lines) {
      doc.text(line, x, cursor);
      cursor += 4;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...INK);
    doc.text(footer, x, y + boxH - 2.5);
  };

  writeColumn(
    MARGIN + padX,
    buyerName,
    buyerWrapped,
    `Place of Supply: ${totals.placeOfSupply || "-"}`,
  );
  writeColumn(
    MARGIN + halfW + padX,
    sellerName,
    sellerWrapped,
    `GSTIN: ${merchant?.gstin || "Not provided"}`,
  );

  return y + boxH;
}

function drawMetaStrip(doc: jsPDF, y: number, order: InvoiceOrder) {
  const cells: Array<[string, string]> = [
    ["Invoice No.", invoiceNumberFor(String(order.orderNumber || order.shopifyOrderId), order.createdAt)],
    ["Invoice Date", fmtDate(Date.now())],
    ["Order No.", String(order.orderNumber || order.shopifyOrderId)],
    ["Order Date", fmtDate(order.createdAt)],
    ["Payment", paymentMode(order)],
  ];
  const boxH = 12;
  const colW = CONTENT_W / cells.length;

  doc.setDrawColor(...RULE);
  doc.rect(MARGIN, y, CONTENT_W, boxH);

  cells.forEach(([label, value], index) => {
    const x = MARGIN + colW * index;
    if (index) doc.line(x, y, x, y + boxH);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(label, x + 3, y + 4.6);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...INK);
    doc.text(
      doc.splitTextToSize(value, colW - 6)[0] || value,
      x + 3,
      y + 9.4,
    );
  });

  return y + boxH;
}

function drawItemsTable(doc: jsPDF, y: number, totals: InvoiceTotals) {
  // The rate is identical on every row and is stated in full in the totals
  // block, so the column header stays short. Spelling the regime out per cell
  // squeezed the column until amounts wrapped mid-number.
  const head = [
    [
      "#",
      "Description",
      "HSN",
      "Qty",
      "Gross",
      "Discount",
      "Taxable Value",
      "Tax",
      "Total",
    ],
  ];
  const body = totals.rows.map((row, index) => [
    String(index + 1),
    row.description,
    row.hsn,
    String(row.quantity),
    money(row.gross),
    row.discount ? money(row.discount) : "-",
    money(row.taxableValue),
    money(row.tax.kind === "igst" ? row.tax.igst : row.tax.cgst + row.tax.sgst),
    money(row.net),
  ]);

  autoTable(doc, {
    startY: y,
    head,
    body,
    theme: "grid",
    margin: { left: MARGIN, right: MARGIN },
    // Never split a single item across a page break.
    rowPageBreak: "avoid",
    styles: {
      font: "helvetica",
      fontSize: 7.5,
      cellPadding: 2,
      lineColor: RULE,
      lineWidth: 0.2,
      textColor: INK,
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: WASH,
      textColor: INK,
      fontStyle: "bold",
      fontSize: 7.5,
      halign: "center",
    },
    columnStyles: {
      0: { cellWidth: 7, halign: "center" },
      1: { cellWidth: 58 },
      2: { cellWidth: 16, halign: "center" },
      3: { cellWidth: 9, halign: "center" },
      4: { cellWidth: 19, halign: "right" },
      5: { cellWidth: 18, halign: "right" },
      6: { cellWidth: 23, halign: "right" },
      7: { cellWidth: 16, halign: "right" },
      8: { cellWidth: 20, halign: "right", fontStyle: "bold" },
    },
  });

  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable
    .finalY;
}

function drawTotals(doc: jsPDF, y: number, totals: InvoiceTotals) {
  // This column must reconcile on its own: taxable value plus tax equals the
  // grand total. Discounts are already applied per line and shown in the items
  // table, so folding them in here would make the arithmetic look wrong.
  const rows: Array<[string, string, boolean]> = [
    ["Taxable Value", money(totals.taxableValue), false],
  ];
  if (totals.intraState) {
    rows.push(["CGST @2.5%", money(totals.cgst), false]);
    rows.push(["SGST @2.5%", money(totals.sgst), false]);
  } else {
    rows.push(["IGST @5.0%", money(totals.igst), false]);
  }
  rows.push(["Grand Total", money(totals.grandTotal), true]);

  const boxW = 78;
  const x = MARGIN + CONTENT_W - boxW;
  const rowH = 6.5;
  const boxH = rows.length * rowH;

  doc.setDrawColor(...RULE);
  doc.rect(x, y, boxW, boxH);

  rows.forEach(([label, value, strong], index) => {
    const rowY = y + rowH * index;
    if (strong) {
      doc.setFillColor(...WASH);
      doc.rect(x + 0.15, rowY + 0.15, boxW - 0.3, rowH - 0.3, "F");
    }
    if (index) {
      doc.setDrawColor(...RULE);
      doc.line(x, rowY, x + boxW, rowY);
    }
    doc.setFont("helvetica", strong ? "bold" : "normal");
    doc.setFontSize(strong ? 9.5 : 8.5);
    doc.setTextColor(...INK);
    doc.text(label, x + 4, rowY + rowH - 2);
    doc.text(value, x + boxW - 4, rowY + rowH - 2, { align: "right" });
  });

  return y + boxH;
}

function drawFooter(doc: jsPDF, y: number, totals: InvoiceTotals) {
  doc.setDrawColor(...RULE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...INK);
  doc.text("Amount in words:", MARGIN, y + 5);
  doc.setFont("helvetica", "normal");
  const words = doc.splitTextToSize(
    amountInWords(totals.grandTotal),
    CONTENT_W - 32,
  );
  doc.text(words, MARGIN + 30, y + 5);

  let cursor = y + 5 + words.length * 4;

  // Savings are informational, kept out of the totals column so that column
  // still reconciles.
  if (totals.discount > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...INK);
    doc.text("Total savings:", MARGIN, cursor + 4);
    doc.setFont("helvetica", "normal");
    doc.text(money(totals.discount), MARGIN + 30, cursor + 4);
    cursor += 4;
  }
  cursor += 3;
  doc.line(MARGIN, cursor, MARGIN + CONTENT_W, cursor);
  cursor += 5;

  doc.setFontSize(6.8);
  doc.setTextColor(...MUTED);
  const note =
    "All amounts are inclusive of GST. Tax is not payable on reverse charge basis. " +
    "Delivery charges, where shown, cover logistics for this order. " +
    "This is a computer generated invoice and does not require a signature.";
  const noteLines = doc.splitTextToSize(note, CONTENT_W);
  doc.text(noteLines, MARGIN, cursor);

  return cursor + noteLines.length * 3;
}

// ─── Main generator ──────────────────────────────────────────────────

export async function generateInvoicePdf(
  options: InvoiceOptions,
): Promise<Blob> {
  const { type, order, merchant } = options;

  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
    compress: true,
  });

  const totals = buildInvoiceTotals({
    lineItems: order.lineItems || [],
    gstin: merchant?.gstin,
    buyerState: order.shippingAddress?.province,
  });

  const logo = await loadLogo();
  const copyLabel =
    type === "invoice" ? "Original for Recipient" : "Duplicate for Supplier";

  let y = MARGIN;
  y = drawHeader(doc, y, logo, copyLabel);
  y = drawParties(doc, y, order, merchant, totals);
  y = drawMetaStrip(doc, y, order);
  y = drawItemsTable(doc, y, totals);

  // Keep the totals and footer together; push to a new page if they will not
  // fit under a long item table.
  const tailHeight = 60;
  if (y + tailHeight > 297 - MARGIN) {
    doc.addPage();
    y = MARGIN;
  }

  y = drawTotals(doc, y + 4, totals);
  drawFooter(doc, y + 4, totals);

  // Page numbers, added last so the count is final.
  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(
      `Page ${page} of ${pageCount}`,
      PAGE_W - MARGIN,
      297 - 6,
      { align: "right" },
    );
  }

  return doc.output("blob");
}
