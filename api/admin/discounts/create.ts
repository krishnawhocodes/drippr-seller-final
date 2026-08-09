// api/admin/discounts/create.ts
// Creates a private 100% discount code via Shopify Admin GraphQL.
// Only callable by authenticated admins.

import { getAdmin } from "../../_lib/firebaseAdmin.js";
import { shopifyGraphQL } from "../../_lib/shopify.js";

const ADMIN_UIDS = (process.env.ADMIN_UIDS || "").split(",").map((s) => s.trim()).filter(Boolean);

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    // Auth check
    const { adminAuth } = getAdmin();
    const authHeader = String(req.headers.authorization || "");
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return res.status(401).json({ ok: false, error: "Missing Authorization" });

    const decoded = await adminAuth.verifyIdToken(token);
    if (!ADMIN_UIDS.includes(decoded.uid)) {
      return res.status(403).json({ ok: false, error: "Not an admin" });
    }

    // Parse request body
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const code = String(body.code || "").trim();
    const title = String(body.title || code || "Admin Test Discount");

    if (!code) {
      return res.status(400).json({ ok: false, error: "Missing 'code' in request body" });
    }

    // Create a 100% discount using Shopify's discountCodeBasicCreate mutation
    // This creates a private code — NOT visible to customers unless they type it
    const mutation = `
      mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
        discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
          codeDiscountNode {
            id
            codeDiscount {
              ... on DiscountCodeBasic {
                title
                status
                codes(first: 1) {
                  nodes {
                    code
                  }
                }
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      basicCodeDiscount: {
        title,
        code,
        startsAt: new Date().toISOString(),
        // No endsAt = never expires
        customerGets: {
          value: {
            percentage: 1.0, // 100% discount
          },
          items: {
            all: true, // applies to all products
          },
        },
        customerSelection: {
          all: true, // any customer can use it (if they know the code)
        },
        usageLimit: null, // unlimited uses for testing
        appliesOncePerCustomer: false,
      },
    };

    const result = await shopifyGraphQL(mutation, variables);

    const userErrors = result?.data?.discountCodeBasicCreate?.userErrors || [];
    if (userErrors.length > 0) {
      return res.status(400).json({
        ok: false,
        error: "Shopify userErrors",
        userErrors,
      });
    }

    const created = result?.data?.discountCodeBasicCreate?.codeDiscountNode;
    return res.status(200).json({
      ok: true,
      discount: {
        id: created?.id,
        title: created?.codeDiscount?.title,
        status: created?.codeDiscount?.status,
        code: created?.codeDiscount?.codes?.nodes?.[0]?.code || code,
      },
    });
  } catch (e: any) {
    console.error("[discounts/create] Error:", e?.message || e);
    return res.status(500).json({ ok: false, error: e?.message || "Internal error" });
  }
}
