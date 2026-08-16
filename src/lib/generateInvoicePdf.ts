// src/lib/generateInvoicePdf.ts
// Professional Tax Invoice / Billing Slip PDF generator using jsPDF
// Used by both seller panel (billing slip) and admin (invoice)

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// ─── Types ───────────────────────────────────────────────────────────

export type InvoiceLineItem = {
  title: string;
  sku?: string;
  quantity: number;
  price: number;         // unit price
  total: number;         // price × quantity (before discount)
  discount?: number;     // per-line discount amount
  discountedTotal?: number; // total after discount
};

export type InvoiceOrder = {
  orderNumber?: string;
  shopifyOrderId: string;
  createdAt: number;           // epoch ms
  lineItems?: InvoiceLineItem[];
  subtotal?: number;
  discountedSubtotal?: number;
  totalDiscounts?: number;
  totalPrice?: number;
  currency?: string;

  // Customer info
  customerEmail?: string | null;
  customerName?: string | null;
  shippingAddress?: {
    name?: string;
    address1?: string;
    address2?: string;
    city?: string;
    province?: string;
    zip?: string;
    country?: string;
    phone?: string;
  } | null;
};

export type InvoiceMerchant = {
  storeName?: string;
  businessName?: string;
  name?: string;
  address?: string;
  gstin?: string;
  phone?: string;
  email?: string;
};

export type InvoiceOptions = {
  type: "billing_slip" | "invoice";  // billing_slip for seller, invoice for admin
  order: InvoiceOrder;
  merchant?: InvoiceMerchant | null;
};

// ─── Helpers ─────────────────────────────────────────────────────────

function fmtDate(ms: number): string {
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

function fmtMoney(v: number): string {
  return `Rs.${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function generateInvoiceNumber(orderId: string): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const short = String(orderId).slice(-8);
  return `INV-${yy}${mm}-${short}`;
}

// Load the Drippr logo from the public folder and return as base64 data URL
async function loadLogo(): Promise<string | null> {
  try {
    const response = await fetch("/logo_rounded.png");
    if (!response.ok) return null;
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// Rotate an image using an offscreen canvas and return a new data URL
async function createRotatedImage(
  dataUrl: string,
  angleDeg: number,
): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const rad = (angleDeg * Math.PI) / 180;
      const sin = Math.abs(Math.sin(rad));
      const cos = Math.abs(Math.cos(rad));
      const newW = Math.ceil(img.width * cos + img.height * sin);
      const newH = Math.ceil(img.width * sin + img.height * cos);

      const canvas = document.createElement("canvas");
      canvas.width = newW;
      canvas.height = newH;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(null); return; }

      ctx.translate(newW / 2, newH / 2);
      ctx.rotate(rad);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

// ─── Main Generator ──────────────────────────────────────────────────

export async function generateInvoicePdf(options: InvoiceOptions): Promise<Blob> {
  const { type, order, merchant } = options;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();   // 210
  const pageH = doc.internal.pageSize.getHeight();  // 297
  const margin = 12;
  const contentW = pageW - margin * 2;

  // Load logo and pre-rotate it for watermark use
  const logoData = await loadLogo();
  let rotatedLogoData: string | null = null;
  if (logoData) {
    try {
      rotatedLogoData = await createRotatedImage(logoData, 45);
    } catch {
      // skip rotation
    }
  }

  let y = margin;

  // ═══════════════════════════════════════════════════════════════════
  //  HEADER: DRIPPR branding
  // ═══════════════════════════════════════════════════════════════════

  // Dark header bar
  doc.setFillColor(26, 26, 26);
  doc.rect(0, 0, pageW, 28, "F");

  // Drippr text
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(255, 255, 255);
  doc.text("DRIPPR", margin + 2, 12);

  // Tagline
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(180, 180, 180);
  doc.text("India's Multi-Vendor Streetwear Marketplace", margin + 2, 18);

  // Document type label
  const docLabel = type === "billing_slip" ? "BILLING SLIP" : "TAX INVOICE";
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(255, 255, 255);
  doc.text(docLabel, pageW - margin - 2, 12, { align: "right" });

  // "Original For Recipient"
  doc.setFontSize(7);
  doc.setFont("helvetica", "italic");
  doc.setTextColor(180, 180, 180);
  doc.text("Original For Recipient", pageW - margin - 2, 18, { align: "right" });

  // Tilted logo watermark in the header area (low opacity via light color)
  if (rotatedLogoData) {
    // Use a canvas to draw the logo at low opacity onto a new data URL
    try {
      const fadedLogo = await createFadedImage(rotatedLogoData, 0.08);
      if (fadedLogo) {
        doc.addImage(fadedLogo, "PNG", pageW - 78, -12, 85, 85);
      }
    } catch {
      // Skip watermark silently
    }
  }

  y = 34;

  // ═══════════════════════════════════════════════════════════════════
  //  ORDER INFO BAR
  // ═══════════════════════════════════════════════════════════════════

  doc.setFillColor(245, 245, 245);
  doc.rect(margin, y, contentW, 16, "F");
  doc.setDrawColor(200, 200, 200);
  doc.rect(margin, y, contentW, 16, "S");

  const orderNum = order.orderNumber || `#${order.shopifyOrderId}`;
  const orderDate = fmtDate(order.createdAt);
  const invoiceNo = generateInvoiceNumber(order.shopifyOrderId);
  const invoiceDate = fmtDate(Date.now());

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(100, 100, 100);

  const col1 = margin + 4;
  const col2 = margin + contentW * 0.28;
  const col3 = margin + contentW * 0.56;
  const col4 = margin + contentW * 0.78;

  doc.text("Order No.", col1, y + 5);
  doc.text("Invoice No.", col2, y + 5);
  doc.text("Order Date", col3, y + 5);
  doc.text("Invoice Date", col4, y + 5);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(26, 26, 26);

  doc.text(orderNum, col1, y + 11);
  doc.text(invoiceNo, col2, y + 11);
  doc.text(orderDate, col3, y + 11);
  doc.text(invoiceDate, col4, y + 11);

  y += 22;

  // ═══════════════════════════════════════════════════════════════════
  //  BILL TO / SOLD BY (two-column layout)
  // ═══════════════════════════════════════════════════════════════════

  const halfW = contentW / 2 - 2;

  // BILL TO / SHIP TO header
  doc.setFillColor(26, 26, 26);
  doc.rect(margin, y, halfW, 6, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(255, 255, 255);
  doc.text("BILL TO / SHIP TO", margin + 3, y + 4.2);

  // SOLD BY header
  doc.rect(margin + halfW + 4, y, halfW, 6, "F");
  doc.text("SOLD BY", margin + halfW + 7, y + 4.2);

  y += 8;

  // Bill To content
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(50, 50, 50);

  const addr = order.shippingAddress;
  const customerName = addr?.name || order.customerName || order.customerEmail || "—";

  const billToLines: string[] = [customerName];
  if (addr) {
    if (addr.address1) billToLines.push(addr.address1);
    if (addr.address2) billToLines.push(addr.address2);
    const cityLine = [addr.city, addr.province].filter(Boolean).join(", ");
    if (cityLine) billToLines.push(cityLine);
    if (addr.zip) billToLines[billToLines.length - 1] += ` - ${addr.zip}`;
    if (addr.country && addr.country !== "IN" && addr.country !== "India") {
      billToLines.push(addr.country);
    }
    if (addr.phone) billToLines.push(`Ph: ${addr.phone}`);
  } else if (order.customerEmail) {
    billToLines.push(order.customerEmail);
  }

  let billY = y;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.text(billToLines[0], margin + 3, billY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  for (let i = 1; i < billToLines.length; i++) {
    billY += 4;
    doc.text(billToLines[i], margin + 3, billY);
  }

  // Sold By content
  const sellerName = merchant?.businessName || merchant?.storeName || merchant?.name || "Drippr Marketplace Seller";
  const soldByLines: string[] = [sellerName];
  if (merchant?.address) {
    const addrWords = merchant.address.split(/,\s*/);
    let currentLine = "";
    for (const word of addrWords) {
      if (currentLine && (currentLine + ", " + word).length > 45) {
        soldByLines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = currentLine ? currentLine + ", " + word : word;
      }
    }
    if (currentLine) soldByLines.push(currentLine);
  }

  const gstinValue = merchant?.gstin || "N/A";
  soldByLines.push("");
  soldByLines.push(`GSTIN: ${gstinValue}`);

  let soldY = y;
  const soldX = margin + halfW + 7;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.text(soldByLines[0], soldX, soldY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  for (let i = 1; i < soldByLines.length; i++) {
    soldY += 4;
    if (soldByLines[i].startsWith("GSTIN:")) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
    }
    doc.text(soldByLines[i], soldX, soldY);
  }

  y = Math.max(billY, soldY) + 10;

  // ═══════════════════════════════════════════════════════════════════
  //  LINE ITEMS TABLE
  // ═══════════════════════════════════════════════════════════════════

  const items = order.lineItems || [];

  const tableHead = [
    ["Description", "HSN", "Qty", "Gross Amt", "Discount", "Taxable Value", "Taxes", "Total"],
  ];

  let grandGross = 0;
  let grandDiscount = 0;
  let grandTaxable = 0;
  let grandTax = 0;
  let grandTotal = 0;

  const tableBody: string[][] = [];

  for (const item of items) {
    const qty = item.quantity || 1;
    const grossAmt = item.total || item.price * qty;
    const discount = item.discount || 0;
    const netAmt = item.discountedTotal != null ? item.discountedTotal : grossAmt - discount;

    // Reverse-calculate IGST @5% from the net amount (inclusive of tax)
    const taxableValue = Number((netAmt / 1.05).toFixed(2));
    const igst = Number((netAmt - taxableValue).toFixed(2));
    const total = netAmt;

    grandGross += grossAmt;
    grandDiscount += discount;
    grandTaxable += taxableValue;
    grandTax += igst;
    grandTotal += total;

    let desc = item.title || "Product";
    if (item.sku) {
      desc += `\nSKU: ${item.sku}`;
    }

    tableBody.push([
      desc,
      "-",             // HSN - dash as requested
      String(qty),
      fmtMoney(grossAmt),
      fmtMoney(discount),
      fmtMoney(taxableValue),
      `IGST @5%\n${fmtMoney(igst)}`,
      fmtMoney(total),
    ]);
  }

  // Draw the table
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: tableHead,
    body: tableBody,
    theme: "grid",
    headStyles: {
      fillColor: [26, 26, 26],
      textColor: [255, 255, 255],
      fontSize: 7,
      fontStyle: "bold",
      halign: "center",
      valign: "middle",
      cellPadding: 2,
    },
    bodyStyles: {
      fontSize: 7,
      textColor: [50, 50, 50],
      cellPadding: 2,
      valign: "middle",
    },
    columnStyles: {
      0: { cellWidth: 52, halign: "left" },   // Description
      1: { cellWidth: 14, halign: "center" },  // HSN
      2: { cellWidth: 12, halign: "center" },  // Qty
      3: { cellWidth: 22, halign: "right" },   // Gross Amt
      4: { cellWidth: 22, halign: "right" },   // Discount
      5: { cellWidth: 24, halign: "right" },   // Taxable Value
      6: { cellWidth: 22, halign: "center" },  // Taxes
      7: { cellWidth: 18, halign: "right" },   // Total
    },
    alternateRowStyles: {
      fillColor: [250, 250, 250],
    },
  });

  // Total row below the table
  const tableEndY = (doc as any).lastAutoTable.finalY;

  // Draw a totals bar
  doc.setFillColor(240, 240, 240);
  doc.rect(margin, tableEndY, contentW, 8, "F");
  doc.setDrawColor(200, 200, 200);
  doc.rect(margin, tableEndY, contentW, 8, "S");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(26, 26, 26);
  doc.text("Total", margin + 3, tableEndY + 5.5);

  // Position totals to align roughly with table columns
  const totalsBaseX = margin + 52 + 14 + 12; // after Description + HSN + Qty
  doc.text(fmtMoney(grandGross), totalsBaseX + 20, tableEndY + 5.5, { align: "right" });
  doc.text(fmtMoney(grandDiscount), totalsBaseX + 42, tableEndY + 5.5, { align: "right" });
  doc.text(fmtMoney(grandTaxable), totalsBaseX + 66, tableEndY + 5.5, { align: "right" });
  doc.text(fmtMoney(grandTax), totalsBaseX + 86, tableEndY + 5.5, { align: "right" });
  doc.text(fmtMoney(grandTotal), totalsBaseX + 106, tableEndY + 5.5, { align: "right" });

  y = tableEndY + 14;

  // ═══════════════════════════════════════════════════════════════════
  //  AMOUNT SUMMARY BOX (right-aligned)
  // ═══════════════════════════════════════════════════════════════════

  const summaryX = pageW - margin - 70;
  const summaryW = 70;

  doc.setDrawColor(200, 200, 200);
  doc.setFillColor(250, 250, 250);
  doc.roundedRect(summaryX - 2, y - 2, summaryW + 4, 34, 1, 1, "FD");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(80, 80, 80);

  const labelX = summaryX;
  const valX = summaryX + summaryW - 2;

  doc.text("Subtotal:", labelX, y + 4);
  doc.text(fmtMoney(grandGross), valX, y + 4, { align: "right" });

  doc.text("Discount:", labelX, y + 10);
  doc.setTextColor(220, 50, 50);
  doc.text(`- ${fmtMoney(grandDiscount)}`, valX, y + 10, { align: "right" });
  doc.setTextColor(80, 80, 80);

  doc.text("Taxable Value:", labelX, y + 16);
  doc.text(fmtMoney(grandTaxable), valX, y + 16, { align: "right" });

  doc.text("IGST @5%:", labelX, y + 22);
  doc.text(fmtMoney(grandTax), valX, y + 22, { align: "right" });

  // Separator line
  doc.setDrawColor(26, 26, 26);
  doc.line(labelX, y + 25, valX, y + 25);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(26, 26, 26);
  doc.text("Total Amount:", labelX, y + 31);
  doc.text(fmtMoney(grandTotal), valX, y + 31, { align: "right" });

  y += 42;

  // ═══════════════════════════════════════════════════════════════════
  //  AMOUNT IN WORDS
  // ═══════════════════════════════════════════════════════════════════

  doc.setFont("helvetica", "italic");
  doc.setFontSize(7);
  doc.setTextColor(100, 100, 100);
  doc.text(`Amount in words: ${numberToWords(grandTotal)} only`, margin + 2, y);

  y += 8;

  // ═══════════════════════════════════════════════════════════════════
  //  FOOTER NOTES
  // ═══════════════════════════════════════════════════════════════════

  doc.setDrawColor(200, 200, 200);
  doc.line(margin, y, pageW - margin, y);
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(120, 120, 120);

  const footerLines = [
    "Tax is not payable on reverse charge basis. This is a computer generated invoice and does not require signature.",
    "Includes discounts for your city and/or for online payments (as applicable).",
    "For any queries, contact seller through the Drippr Seller Panel.",
  ];

  for (const line of footerLines) {
    doc.text(line, margin + 2, y);
    y += 3.5;
  }

  // ═══════════════════════════════════════════════════════════════════
  //  CENTER WATERMARK (tilted 45° Drippr logo)
  // ═══════════════════════════════════════════════════════════════════

  if (rotatedLogoData) {
    try {
      const fadedCenter = await createFadedImage(rotatedLogoData, 0.04);
      if (fadedCenter) {
        doc.addImage(fadedCenter, "PNG", pageW / 2 - 45, pageH / 2 - 45, 90, 90);
      }
    } catch {
      // Skip center watermark silently
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  BOTTOM BRAND BAR
  // ═══════════════════════════════════════════════════════════════════

  const barY = pageH - 10;
  doc.setFillColor(26, 26, 26);
  doc.rect(0, barY, pageW, 10, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(180, 180, 180);
  doc.text("DRIPPR — India's Multi-Vendor Streetwear Marketplace", pageW / 2, barY + 5.5, { align: "center" });

  return doc.output("blob");
}

// ─── Helper: Create a faded (low-opacity) version of an image via canvas ──

async function createFadedImage(dataUrl: string, opacity: number): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(null); return; }

      ctx.globalAlpha = opacity;
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

// ─── Helper: Number to words (Indian format) ────────────────────────

function numberToWords(num: number): string {
  if (num === 0) return "Zero Rupees";

  const ones = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
    "Seventeen", "Eighteen", "Nineteen",
  ];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  function belowHundred(n: number): string {
    if (n < 20) return ones[n];
    return tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : "");
  }

  function belowThousand(n: number): string {
    if (n < 100) return belowHundred(n);
    return ones[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " and " + belowHundred(n % 100) : "");
  }

  const rupees = Math.floor(num);
  const paise = Math.round((num - rupees) * 100);

  let result = "";
  let remaining = rupees;

  if (remaining >= 10000000) {
    result += belowThousand(Math.floor(remaining / 10000000)) + " Crore ";
    remaining = remaining % 10000000;
  }
  if (remaining >= 100000) {
    result += belowHundred(Math.floor(remaining / 100000)) + " Lakh ";
    remaining = remaining % 100000;
  }
  if (remaining >= 1000) {
    result += belowHundred(Math.floor(remaining / 1000)) + " Thousand ";
    remaining = remaining % 1000;
  }
  if (remaining > 0) {
    result += belowThousand(Math.floor(remaining));
  }

  result = result.trim() + " Rupees";

  if (paise > 0) {
    result += " and " + belowHundred(paise) + " Paise";
  }

  return result;
}
