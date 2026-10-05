import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const CATALOG = "https://catalog.lwc.co.uk";
const UA = "Mozilla/5.0 (compatible; MeasuredStock/1.0)";

const SEARCH_QUERY = `query Search($q: String!, $n: Int!) {
  site {
    search {
      searchProducts(filters: { searchTerm: $q }) {
        products(first: $n) {
          edges {
            node {
              entityId
              name
              sku
              path
              brand { name }
              categories { edges { node { name path } } }
              customFields { edges { node { name value } } }
              defaultImage { url(width: 80) }
            }
          }
        }
      }
    }
  }
}`;

let tokenCache: { token: string; until: number } | null = null;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function cleanQuery(raw: string) {
  return String(raw || "").replace(/\s+/g, " ").trim().slice(0, 120);
}

function extractGraphqlToken(html: string): string {
  const m = html.match(/id="BC_GraphQL_Token"[^>]*>([^<]+)/);
  if (!m?.[1]) throw new Error("Catalog search token not found");
  const raw = m[1].trim();
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string" && parsed) return parsed;
  } catch {
    // fall through
  }
  return raw.replace(/^"|"$/g, "");
}

async function catalogToken(): Promise<string> {
  if (tokenCache && tokenCache.until > Date.now()) return tokenCache.token;
  const res = await fetch(`${CATALOG}/`, {
    headers: { "User-Agent": UA, Accept: "text/html" },
  });
  if (!res.ok) throw new Error(`Catalog unavailable (${res.status})`);
  const html = await res.text();
  const token = extractGraphqlToken(html);
  tokenCache = { token, until: Date.now() + 20 * 60_000 };
  return token;
}

function customMap(edges: Array<{ node?: { name?: string; value?: string } }> | undefined) {
  const out: Record<string, string> = {};
  for (const edge of edges || []) {
    const name = edge?.node?.name;
    if (name) out[name] = String(edge.node?.value || "");
  }
  return out;
}

function toHit(node: Record<string, unknown> | null | undefined) {
  if (!node) return null;
  const name = String(node.name || "").trim();
  if (!name) return null;
  const fields = customMap(
    (node.customFields as { edges?: Array<{ node?: { name?: string; value?: string } }> })?.edges,
  );
  const cat = (node.categories as { edges?: Array<{ node?: { name?: string; path?: string } }> })
    ?.edges?.[0]?.node;
  const path = String(node.path || "").trim();
  const image = (node.defaultImage as { url?: string } | null)?.url || "";
  const brand = (node.brand as { name?: string } | null)?.name || fields.Producer || "";
  return {
    entityId: node.entityId,
    id: String(node.entityId || path || name),
    name,
    sku: String(node.sku || "").trim() || null,
    path,
    url: path ? `${CATALOG}${path.startsWith("/") ? path : `/${path}`}` : "",
    brand: String(brand).trim(),
    productCategory: fields["Product Category"] || cat?.name || "",
    productType: fields["Product Type"] || "",
    categoryPath: cat?.path || "",
    unitSize: fields["Unit Size"] || "",
    abv: fields["Alcohol By Volume"] || "",
    container: fields.Container || "",
    image,
    defaultImage: image ? { url: image } : null,
    customFields: node.customFields,
    categories: node.categories,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (req.method !== "GET") {
    return json({ error: "GET only" }, 405);
  }

  try {
    const url = new URL(req.url);
    const q = cleanQuery(url.searchParams.get("q") || "");
    const n = Math.min(Math.max(Number(url.searchParams.get("n") || 12) || 12, 1), 16);
    if (q.length < 3) return json({ results: [], query: q });

    const token = await catalogToken();
    const gql = await fetch(`${CATALOG}/graphql`, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query: SEARCH_QUERY, variables: { q, n } }),
    });
    if (!gql.ok) {
      tokenCache = null;
      return json({ error: `Catalog search failed (${gql.status})`, results: [] }, 502);
    }
    const payload = await gql.json();
    if (payload?.errors?.length) {
      tokenCache = null;
      const message = String(payload.errors[0]?.message || "Catalog query failed");
      return json({ error: message, results: [] }, 502);
    }
    const edges = payload?.data?.site?.search?.searchProducts?.products?.edges || [];
    const results = edges.map((e: { node?: Record<string, unknown> }) => toHit(e?.node)).filter(Boolean);
    return json({ results, query: q, source: "lwc-catalog" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message, results: [] }, 500);
  }
});
