// src/lib/generateInvoicePdf.ts
// Professional Tax Invoice / Billing Slip PDF — matches Delhivery invoice format exactly
// Used by both seller panel (billing slip) and admin (invoice)

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// ─── Types ───────────────────────────────────────────────────────────

export type InvoiceLineItem = {
  title: string;
  name?: string;            // full name from Shopify (title - variant)
  sku?: string;
  quantity: number;
  price: number;            // unit price
  total: number;            // price × quantity (before discount)
  discount?: number;        // per-line discount amount
  discountedTotal?: number; // total after discount
  variantTitle?: string;    // e.g. "32 / Black"
  variant_id?: string;
  product_id?: string;
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
  type: "billing_slip" | "invoice";
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
  // Generate a short alphanumeric hash from the order ID (like reference: m5tna272278)
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let hash = "";
  for (let i = 0; i < 10; i++) {
    const code = orderId.charCodeAt(i % orderId.length) + i * 7;
    hash += chars[code % chars.length];
  }
  return hash;
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

// Rotate an image using an offscreen canvas
async function createRotatedImage(dataUrl: string, angleDeg: number): Promise<string | null> {
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

// Parse variant title into size + color (Shopify convention: "Size / Color")
function parseVariant(variantTitle?: string | null): { size: string; color: string } {
  if (!variantTitle) return { size: "-", color: "-" };
  const parts = variantTitle.split("/").map((s) => s.trim());
  return {
    size: parts[0] || "-",
    color: parts[1] || "-",
  };
}

// ─── Main Generator ──────────────────────────────────────────────────

export async function generateInvoicePdf(options: InvoiceOptions): Promise<Blob> {
  const { type, order, merchant } = options;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();   // 210
  const margin = 10;
  const contentW = pageW - margin * 2;

  // Load logo and pre-rotate for top-right placement
  const logoData = await loadLogo();
  let rotatedLogoData: string | null = null;
  if (logoData) {
    try {
      rotatedLogoData = await createRotatedImage(logoData, 45);
    } catch { /* skip */ }
  }

  let y = margin;

  // Common data
  const addr = order.shippingAddress;
  const customerName = addr?.name || order.customerName || order.customerEmail || "—";
  const sellerName = merchant?.businessName || merchant?.storeName || merchant?.name || "Drippr Marketplace Seller";
  const items = order.lineItems || [];

  // ═══════════════════════════════════════════════════════════════════
  //  SECTION 1: TOP BOX — Customer Address (left) + Drippr Logo (right)
  //  Matches: bordered rectangle, vertical divider, exactly like reference
  // ═══════════════════════════════════════════════════════════════════

  const topBoxH = 82;
  const halfW = contentW / 2;

  // Outer border
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.4);
  doc.rect(margin, y, contentW, topBoxH);

  // Vertical divider
  doc.line(margin + halfW, y, margin + halfW, y + topBoxH);

  // --- LEFT HALF: Customer Address ---
  let leftY = y + 6;
  const leftX = margin + 4;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.text("Customer Address", leftX, leftY);
  leftY += 6;

  // Customer name (bold, larger)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(customerName, leftX, leftY);
  leftY += 6;

  // Address lines
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  if (addr) {
    if (addr.address1) { doc.text(addr.address1, leftX, leftY); leftY += 5; }
    if (addr.address2) { doc.text(addr.address2, leftX, leftY); leftY += 5; }
    const cityLine = [addr.city, addr.province, addr.zip].filter(Boolean).join(", ");
    if (cityLine) { doc.text(cityLine, leftX, leftY); leftY += 5; }
  } else if (order.customerEmail) {
    doc.text(order.customerEmail, leftX, leftY);
    leftY += 5;
  }

  leftY += 5;

  // "If undelivered, return to:" section
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("If undelivered, return to:", leftX, leftY);
  leftY += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(sellerName, leftX, leftY);
  leftY += 5;

  if (merchant?.address) {
    const maxLineW = halfW - 10;
    const sellerAddrLines = doc.splitTextToSize(merchant.address, maxLineW);
    for (const line of sellerAddrLines) {
      doc.text(line, leftX, leftY);
      leftY += 4.5;
    }
  }

  // --- RIGHT HALF: Drippr Logo (tilted 45°) ---
  if (rotatedLogoData) {
    try {
      const logoSize = 65;
      const logoX = margin + halfW + (halfW - logoSize) / 2;
      const logoY = y + (topBoxH - logoSize) / 2;
      doc.addImage(rotatedLogoData, "PNG", logoX, logoY, logoSize, logoSize);
    } catch { /* skip */ }
  }

  y += topBoxH;

  // ═══════════════════════════════════════════════════════════════════
  //  SECTION 2: PRODUCT DETAILS — matches reference exactly
  // ═══════════════════════════════════════════════════════════════════

  y += 2;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  doc.text("Product Details", margin + 2, y + 5);
  y += 8;

  // Draw a horizontal line under "Product Details" heading
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);
  doc.line(margin, y, margin + contentW, y);
  y += 1;

  // Product details table (plain style — like reference)
  const pdHead = [["SKU", "Size", "Qty", "Color", "Order No."]];
  const pdBody: string[][] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const variant = parseVariant(item.variantTitle);
    pdBody.push([
      item.title || item.sku || "Product",
      variant.size,
      String(item.quantity || 1),
      variant.color,
      `${order.shopifyOrderId}_${i + 1}`,
    ]);
  }

  if (pdBody.length === 0) {
    pdBody.push(["-", "-", "-", "-", order.shopifyOrderId]);
  }

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: pdHead,
    body: pdBody,
    theme: "plain",
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      fontSize: 8,
      fontStyle: "bold",
      cellPadding: 2,
    },
    bodyStyles: {
      fontSize: 8,
      textColor: [0, 0, 0],
      cellPadding: 2,
    },
    columnStyles: {
      0: { cellWidth: 64 },   // SKU (product name)
      1: { cellWidth: 22 },   // Size
      2: { cellWidth: 22 },   // Qty
      3: { cellWidth: 28 },   // Color
      4: { cellWidth: 54 },   // Order No.
    },
  });

  y = (doc as any).lastAutoTable.finalY + 2;

  // ═══════════════════════════════════════════════════════════════════
  //  SECTION 3: TAX INVOICE BAR — dark bar, white text, exactly like reference
  // ═══════════════════════════════════════════════════════════════════

  const docLabel = type === "billing_slip" ? "BILLING SLIP" : "TAX INVOICE";

  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.4);

  // Dark bar
  doc.setFillColor(0, 0, 0);
  doc.rect(margin, y, contentW, 7, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(255, 255, 255);
  doc.text(docLabel, pageW / 2, y + 5, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("Original For Recipient", pageW - margin - 3, y + 5, { align: "right" });

  y += 9;

  // ═══════════════════════════════════════════════════════════════════
  //  SECTION 4: BILL TO / SHIP TO (left) + SOLD BY (right)
  //  Matches reference layout exactly — same text flow and spacing
  // ═══════════════════════════════════════════════════════════════════

  const sec4StartY = y;
  const rightX = margin + halfW + 4;

  // --- LEFT: BILL TO / SHIP TO ---
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(0, 0, 0);
  doc.text("BILL TO / SHIP TO", margin + 2, y + 4);
  y += 7;

  // Customer name + address as one flowing text (like reference)
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);

  let billToText = customerName;
  if (addr) {
    const addrParts = [addr.address1, addr.address2].filter(Boolean);
    const cityParts = [addr.city, addr.province, addr.zip].filter(Boolean).join(", ");
    if (addrParts.length > 0 || cityParts) {
      billToText += " - " + [...addrParts, cityParts].filter(Boolean).join(", ");
    }
  }

  const billToWrapped = doc.splitTextToSize(billToText, halfW - 6);
  for (const line of billToWrapped) {
    doc.text(line, margin + 2, y);
    y += 4;
  }

  // Place of Supply
  const placeOfSupply = addr?.province || "—";
  doc.text(`, Place of Supply: ${placeOfSupply}`, margin + 2, y);
  y += 5;

  const leftBottomY = y;

  // --- RIGHT: SOLD BY ---
  let ry = sec4StartY;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(0, 0, 0);

  // "Sold by : [Business Name]"
  const soldByLabel = `Sold by : ${sellerName}`;
  const soldByWrapped = doc.splitTextToSize(soldByLabel, halfW - 8);
  for (const line of soldByWrapped) {
    doc.text(line, rightX, ry + 4);
    ry += 4;
  }

  // Seller address
  if (merchant?.address) {
    const sellerAddrWrapped = doc.splitTextToSize(merchant.address, halfW - 8);
    for (const line of sellerAddrWrapped) {
      doc.text(line, rightX, ry + 4);
      ry += 4;
    }
  }

  ry += 4;

  // GSTIN
  const gstinValue = merchant?.gstin || "N/A";
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text(`GSTIN - ${gstinValue}`, rightX, ry + 4);
  ry += 8;

  // Purchase Order No.
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("Purchase Order No.", rightX, ry + 4);
  ry += 4;
  doc.setFont("helvetica", "bold");
  doc.text(order.shopifyOrderId, rightX, ry + 4);
  ry += 7;

  // Invoice No. | Order Date | Invoice Date — three column sub-row
  const invColX = rightX;
  const odColX = rightX + 32;
  const idColX = rightX + 58;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text("Invoice No.", invColX, ry + 4);
  doc.text("Order Date", odColX, ry + 4);
  doc.text("Invoice Date", idColX, ry + 4);
  ry += 5;

  const invoiceNo = generateInvoiceNumber(order.shopifyOrderId);
  const orderDate = fmtDate(order.createdAt);
  const invoiceDate = fmtDate(Date.now());

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text(invoiceNo, invColX, ry + 4);
  doc.text(orderDate, odColX, ry + 4);
  doc.text(invoiceDate, idColX, ry + 4);
  ry += 6;

  y = Math.max(leftBottomY, ry) + 4;

  // Separator line below BILL TO / SOLD BY section
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);
  doc.line(margin, y, margin + contentW, y);
  y += 2;

  // ═══════════════════════════════════════════════════════════════════
  //  SECTION 5: LINE ITEMS TABLE — grid borders, exactly like reference
  // ═══════════════════════════════════════════════════════════════════

  const tableHead = [
    ["Description", "HSN", "Qty", "Gross Amount", "Discount", "Taxable Value", "Taxes", "Total"],
  ];

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

    grandTax += igst;
    grandTotal += total;

    // Build description — full product name including variant
    let desc = item.name || item.title || "Product";
    if (item.variantTitle && !desc.includes(item.variantTitle)) {
      desc += ` - ${item.variantTitle}`;
    }

    tableBody.push([
      desc,
      "-",                  // HSN — dash as requested
      String(qty),
      fmtMoney(grossAmt),
      fmtMoney(discount),
      fmtMoney(taxableValue),
      `IGST @5.0%\n${fmtMoney(igst)}`,
      fmtMoney(total),
    ]);
  }

  // Draw the line items table (grid theme — black borders like reference)
  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: tableHead,
    body: tableBody,
    theme: "grid",
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      fontSize: 7,
      fontStyle: "bold",
      halign: "center",
      valign: "middle",
      cellPadding: 2,
      lineColor: [0, 0, 0],
      lineWidth: 0.3,
    },
    bodyStyles: {
      fontSize: 7,
      textColor: [0, 0, 0],
      cellPadding: 2,
      valign: "middle",
      lineColor: [0, 0, 0],
      lineWidth: 0.3,
    },
    columnStyles: {
      0: { cellWidth: 55, halign: "left" },   // Description
      1: { cellWidth: 14, halign: "center" },  // HSN
      2: { cellWidth: 12, halign: "center" },  // Qty
      3: { cellWidth: 24, halign: "right" },   // Gross Amount
      4: { cellWidth: 21, halign: "right" },   // Discount
      5: { cellWidth: 24, halign: "right" },   // Taxable Value
      6: { cellWidth: 22, halign: "center" },  // Taxes
      7: { cellWidth: 18, halign: "right" },   // Total
    },
  });

  const tableEndY = (doc as any).lastAutoTable.finalY;

  // TOTAL ROW — same grid style, bold
  autoTable(doc, {
    startY: tableEndY,
    margin: { left: margin, right: margin },
    body: [["Total", "", "", "", "", "", fmtMoney(grandTax), fmtMoney(grandTotal)]],
    theme: "grid",
    bodyStyles: {
      fontSize: 7,
      fontStyle: "bold",
      textColor: [0, 0, 0],
      cellPadding: 2,
      lineColor: [0, 0, 0],
      lineWidth: 0.3,
    },
    columnStyles: {
      0: { cellWidth: 55, halign: "left" },
      1: { cellWidth: 14 },
      2: { cellWidth: 12 },
      3: { cellWidth: 24 },
      4: { cellWidth: 21 },
      5: { cellWidth: 24 },
      6: { cellWidth: 22, halign: "center" },
      7: { cellWidth: 18, halign: "right" },
    },
  });

  y = (doc as any).lastAutoTable.finalY + 6;

  // ═══════════════════════════════════════════════════════════════════
  //  SECTION 6: FOOTER — disclaimer text, exactly like reference
  // ═══════════════════════════════════════════════════════════════════

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(0, 0, 0);

  const footerText =
    "Tax is not payable on reverse charge basis. This is a computer generated invoice and does not require signature. " +
    "Includes discounts for your city and/or for online payments (as applicable)";

  const footerWrapped = doc.splitTextToSize(footerText, contentW - 4);
  for (const line of footerWrapped) {
    doc.text(line, margin + 2, y);
    y += 3.5;
  }

  return doc.output("blob");
}
