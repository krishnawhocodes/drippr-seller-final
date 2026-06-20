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
  const json = await res.json();
  if (!res.ok || json.errors || json.data?.userErrors?.length) {
    throw new Error(JSON.stringify(json));
  }
  return json;
}
