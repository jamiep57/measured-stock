import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const TWE = "https://www.thewhiskyexchange.com";
const TWE_IMG = "https://img.thewhiskyexchange.com";
const UA = "Mozilla/5.0 (compatible; MeasuredStock/1.0)";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function cleanQuery(raw: string) {
  return String(raw || "").replace(/\s+/g, " ").trim().slice(0, 120);
}

function slugify(name: string) {
  return String(name || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function tweFamily(name: string) {
  const n = name.toLowerCase();
  if (/champagne|prosecco|\bwine\b|burgundy|bordeaux|sauvignon|chardonnay/.test(n)) return "wine";
  if (/\bcider\b/.test(n)) return "cider";
  if (/\bbeer\b|\blager\b/.test(n)) return "beer";
  return "spirits";
}

function packFromName(name: string, family: string) {
  const pack = name.match(/(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(ml|cl|l)\b/i);
  if (pack) return `${pack[1]}×${pack[2]}${pack[3].toLowerCase()}`;
  const bottle = name.match(/(\d+(?:\.\d+)?)\s*(cl|ml)\b/i);
  if (bottle) {
    const n = Number(bottle[1]);
    const u = bottle[2].toLowerCase();
    if (u === "cl" && n === 75) return "750ml";
    if (u === "ml" && n === 750) return "750ml";
    if (u === "ml" && n === 700) return "70cl";
    return u === "cl" ? `${bottle[1]}cl` : `${bottle[1]}ml`;
  }
  if (/miniature|\bmini\b/i.test(name)) return "";
  return family === "wine" ? "750ml" : "70cl";
}

function toHit(row: { value?: string; data?: { otype?: string; oid?: string | number } }) {
  const data = row?.data || {};
  if (String(data.otype || "").toLowerCase() !== "product") return null;
  const name = String(row?.value || "").trim();
  const oid = String(data.oid || "").trim();
  if (!name || !oid) return null;
  const family = tweFamily(name);
  const slug = slugify(name);
  const unitSize = packFromName(name, family);
  return {
    id: `twe-${oid}`,
    name,
    sku: oid,
    url: `${TWE}/p/${encodeURIComponent(oid)}${slug ? `/${slug}` : ""}`,
    brand: name.split(/\s+\/\s+/)[0].split(/\s+/).slice(0, 2).join(" "),
    productCategory: family === "wine" ? "Wine" : family === "cider" ? "Cider" : family === "beer" ? "Beer" : "Spirits",
    productType: "",
    categoryPath: family === "wine" ? "/wine" : "/spirits",
    unitSize,
    abv: "",
    container: "Glass Bottle",
    image: `${TWE_IMG}/80/${encodeURIComponent(oid)}.jpg`,
    source: "twe",
    sourceLabel: "TWE",
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
    const n = Math.min(Math.max(Number(url.searchParams.get("n") || 8) || 8, 1), 16);
    if (q.length < 3) return json({ results: [], query: q });

    const tweUrl = `${TWE}/api/search/suggest?query=${encodeURIComponent(q)}`;
    const tweRes = await fetch(tweUrl, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
        Referer: `${TWE}/`,
        "X-Requested-With": "XMLHttpRequest",
      },
    });
    if (!tweRes.ok) {
      return json({ error: `Catalogue search failed (${tweRes.status})`, results: [] }, 502);
    }
    const payload = await tweRes.json();
    const suggestions = Array.isArray(payload?.suggestions) ? payload.suggestions : [];
    const results = suggestions.map(toHit).filter(Boolean).slice(0, n);
    return json({ results, query: q, source: "twe-catalog" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message, results: [] }, 500);
  }
});
