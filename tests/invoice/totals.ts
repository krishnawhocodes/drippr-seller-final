// Invoice money assertions.
//
// These guard the one thing a tax invoice may never get wrong: every figure
// printed on it has to be non-negative and has to add up, whatever Shopify
// sends. A fully discounted order once printed a line of Rs.-100.00 because
// the flat delivery charge was peeled off the list price instead of off what
// the customer actually paid; the invariants below would have caught it.
//
// Run with:  npm run test:invoice

import {
  buildInvoiceTotals,
  isIntraState,
  resolveSellerState,
  type SourceLineItem,
} from "../../src/lib/invoiceTax";

let failures = 0;

function expect(condition: boolean, label: string, detail = "") {
  if (!condition) {
    failures += 1;
    console.log("  FAIL: " + label + (detail ? " -> " + detail : ""));
  }
}

const near = (a: number, b: number, tolerance = 0.011) =>
  Math.abs(a - b) < tolerance;

function check(
  label: string,
  args: {
    lineItems: SourceLineItem[];
    sellerState?: string;
    buyerState?: string;
  },
  expected: {
    grandTotal: number;
    rows?: number;
    intraState?: boolean;
    cgst?: number;
    sgst?: number;
    igst?: number;
  },
) {
  const totals = buildInvoiceTotals(args);
  console.log("\n" + label);

  for (const row of totals.rows) {
    const rowTax = row.tax.igst + row.tax.cgst + row.tax.sgst;
    console.log(
      "  " +
        row.description.slice(0, 34).padEnd(34) +
        " gross=" + row.gross +
        " disc=" + row.discount +
        " net=" + row.net +
        " taxable=" + row.taxableValue +
        " tax=" + rowTax.toFixed(2),
    );

    const asText = JSON.stringify(row);
    expect(
      row.gross >= 0 && row.net >= 0 && row.discount >= 0 && row.taxableValue >= 0 && rowTax >= 0,
      label + ": nothing on the row is negative",
      asText,
    );
    expect(
      near(row.gross - row.discount, row.net),
      label + ": row reconciles (gross - discount = net)",
      asText,
    );
    expect(
      near(row.taxableValue + rowTax, row.net),
      label + ": row tax reconciles (taxable + tax = net)",
      asText,
    );
  }

  expect(
    near(totals.taxableValue + totals.taxTotal, totals.grandTotal, 0.02),
    label + ": totals reconcile",
    `taxable=${totals.taxableValue} tax=${totals.taxTotal} grand=${totals.grandTotal}`,
  );
  expect(
    near(totals.gross - totals.discount, totals.grandTotal, 0.02),
    label + ": gross - discount = grand total",
  );
  expect(
    near(totals.grandTotal, expected.grandTotal),
    label + ": grand total is " + expected.grandTotal,
    "got " + totals.grandTotal,
  );
  if (expected.rows != null) {
    expect(
      totals.rows.length === expected.rows,
      label + ": has " + expected.rows + " rows",
      "got " + totals.rows.length,
    );
  }
  if (expected.intraState != null) {
    expect(
      totals.intraState === expected.intraState,
      label + ": intraState is " + expected.intraState,
    );
    // The split is the whole point of getting intraState right.
    if (expected.intraState) {
      expect(
        totals.igst === 0 && totals.cgst > 0 && totals.sgst > 0,
        label + ": splits into CGST and SGST, with no IGST",
        `igst=${totals.igst} cgst=${totals.cgst} sgst=${totals.sgst}`,
      );
      expect(
        near(totals.cgst + totals.sgst, totals.taxTotal),
        label + ": CGST + SGST is the whole tax",
      );
      // Each row is halved and rounded on its own, so the two sides can drift
      // by up to half a paisa per row. They must still be halves, not a split
      // that has gone lopsided.
      expect(
        Math.abs(totals.cgst - totals.sgst) <= 0.01 * totals.rows.length + 0.001,
        label + ": CGST and SGST are equal halves",
        `cgst=${totals.cgst} sgst=${totals.sgst} over ${totals.rows.length} rows`,
      );
    } else {
      expect(
        totals.cgst === 0 && totals.sgst === 0,
        label + ": carries no CGST or SGST",
        `cgst=${totals.cgst} sgst=${totals.sgst}`,
      );
    }
  }
  for (const [key, want] of [
    ["cgst", expected.cgst],
    ["sgst", expected.sgst],
    ["igst", expected.igst],
  ] as const) {
    if (want != null) {
      expect(
        near(totals[key], want),
        label + ": " + key + " is " + want,
        "got " + totals[key],
      );
    }
  }
}

const line = (over: Partial<SourceLineItem> = {}): SourceLineItem => ({
  title: "Oversized Tee",
  quantity: 1,
  price: 799,
  total: 799,
  discount: 0,
  discountedTotal: 799,
  ...over,
});

// The order from the field report: a 100% discount took the product line
// negative and left the invoice showing Rs.-100.00.
check(
  "Fully discounted order (regression: negative line)",
  {
    lineItems: [line({ discount: 799, discountedTotal: 0 })],
    buyerState: "Madhya Pradesh",
  },
  { grandTotal: 0 },
);

check(
  "Ordinary paid order",
  { lineItems: [line()], buyerState: "Madhya Pradesh" },
  { grandTotal: 799, rows: 2, intraState: false },
);

check(
  "Partial discount",
  {
    lineItems: [line({ discount: 200, discountedTotal: 599 })],
    buyerState: "Madhya Pradesh",
  },
  { grandTotal: 599, rows: 2 },
);

check(
  "Discount deeper than the product, shallower than the total",
  {
    lineItems: [line({ discount: 749, discountedTotal: 50 })],
    buyerState: "Madhya Pradesh",
  },
  { grandTotal: 50 },
);

check(
  "Multiple units",
  {
    lineItems: [line({ quantity: 3, total: 2397, discountedTotal: 2397 })],
    buyerState: "Madhya Pradesh",
  },
  { grandTotal: 2397, rows: 2 },
);

// Seller GSTIN starts "07" (Delhi) and the buyer is in Delhi, so the tax
// splits into CGST + SGST instead of IGST.
check(
  "Intra-state order splits into CGST + SGST",
  {
    lineItems: [line()],
    sellerState: resolveSellerState({ gstin: "07AABCU9603R1ZX" }),
    buyerState: "Delhi",
  },
  // 799 inclusive of 5% -> 38.05 tax, halved either side.
  { grandTotal: 799, rows: 2, intraState: true, cgst: 19.03, sgst: 19.02, igst: 0 },
);

check(
  "Seller shipping out of state stays on IGST",
  {
    lineItems: [line()],
    sellerState: resolveSellerState({ gstin: "07AABCU9603R1ZX" }),
    buyerState: "Karnataka",
  },
  { grandTotal: 799, intraState: false, igst: 38.05, cgst: 0, sgst: 0 },
);

// The case the panel hit in practice: a seller who has filled in their
// address but not yet their GSTIN. Before the state was read off the profile
// this fell through to IGST on every order, including local ones.
check(
  "Seller without a GSTIN still gets CGST + SGST on a local order",
  {
    lineItems: [line()],
    sellerState: resolveSellerState({ state: "Delhi" }),
    buyerState: "Delhi",
  },
  { grandTotal: 799, intraState: true, igst: 0 },
);

check(
  "State spelling and case do not change the verdict",
  {
    lineItems: [line()],
    sellerState: "TAMIL NADU",
    buyerState: "tamil-nadu",
  },
  { grandTotal: 799, intraState: true },
);

check(
  "An unknown buyer state falls back to IGST",
  { lineItems: [line()], sellerState: "Delhi", buyerState: "" },
  { grandTotal: 799, intraState: false },
);

// Priced below the delivery charge, so no delivery line can be split out.
check(
  "Legacy item cheaper than the delivery charge",
  {
    lineItems: [
      line({ title: "Sticker", price: 60, total: 60, discountedTotal: 60 }),
    ],
    buyerState: "Delhi",
  },
  { grandTotal: 60, rows: 1 },
);

check(
  "Several products on one order",
  {
    lineItems: [
      line({ quantity: 2, total: 1598, discount: 100, discountedTotal: 1498 }),
      line({ title: "Cap", price: 499, total: 499, discountedTotal: 499 }),
    ],
    buyerState: "Karnataka",
  },
  { grandTotal: 1997, rows: 3 },
);

// An order that never reached payment still has to render without throwing.
check(
  "Zero-quantity / empty order",
  { lineItems: [], buyerState: "" },
  { grandTotal: 0, rows: 0 },
);

console.log(
  failures
    ? "\n" + failures + " INVOICE ASSERTION(S) FAILED"
    : "\nAll invoice assertions passed.",
);
process.exit(failures ? 1 : 0);
