// /api/_lib/shopify.ts
const SHOP = process.env.SHOPIFY_STORE_DOMAIN!;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN!;
const API = process.env.SHOPIFY_API_VERSION || "2025-01";

const ENDPOINT = `https://${SHOP}/admin/api/${API}/graphql.json`;

export async function shopifyGraphQL(query: string, variables?: any) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json: any = await res.json();
  if (!res.ok || json.errors || json.data?.userErrors?.length) {
    throw new Error(JSON.stringify(json));
  }
  return json;
}

/**
 * Same request, but keeps whatever Shopify did return when it rejects only
 * part of a query.
 *
 * GraphQL answers field by field. A store on a plan without Level 2 customer
 * data gets `address1` and `zip` nulled with an error attached, while `city`
 * and `province` on the very same object come back fine. Throwing the whole
 * response away - which `shopifyGraphQL` rightly does for an all-or-nothing
 * mutation - would discard the parts we are allowed to read.
 *
 * Returns the data alongside any field errors, and throws only when the
 * request failed outright or produced no data at all.
 */
export type ShopifyPartialResult = {
  /** Arbitrarily shaped by the query; callers narrow at the use site. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  errors: Array<{ message?: string }>;
};

export async function shopifyGraphQLPartial(
  query: string,
  variables?: Record<string, unknown>,
): Promise<ShopifyPartialResult> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as {
    data?: unknown;
    errors?: Array<{ message?: string }>;
  };
  const errors = Array.isArray(json?.errors) ? json.errors : [];
  if (!res.ok || (json?.data == null && errors.length)) {
    throw new Error(JSON.stringify(json));
  }
  return { data: json?.data ?? null, errors };
}
