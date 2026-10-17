// Mongo (5001) vs Postgres (5002): har endpoint ka time + data milaan. Sirf GET (read-only).
const B = require("node:path").resolve(__dirname, "../..");
require(B + "/node_modules/dotenv").config({ path: B + "/.env" });
const jwt = require(B + "/node_modules/jsonwebtoken");
const { canonical } = require(B + "/database/postgres/codec");
const token = jwt.sign({ isEnvAdmin: true, username: "migration-read-only-check", role: "superadmin" }, process.env.JWT_SECRET, { expiresIn: "30m" });

async function get(base, ep) {
  const s = Date.now();
  const r = await fetch(base + ep, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(90000) });
  const ms = Date.now() - s;
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, ms, body };
}

(async () => {
  const A = process.env.A || "http://localhost:5003", P = process.env.P || "http://localhost:5002";
  const eps = ["/api/products", "/api/categories", "/api/banners", "/api/home-config", "/api/grid-layout", "/api/trust-settings",
    "/api/discount-rules", "/api/custom-boxes", "/api/settings/cod", "/api/settings/shipping", "/api/settings/reviews", "/api/blogs",
    "/api/orders?limit=200", "/api/orders/analytics/top-selling", "/api/admin/customers?limit=100", "/api/reviews/all/list",
    "/api/products/search/all?query=car", "/api/products/search/all?query=doll", "/sitemap.xml", "/api/shipping", "/api/registrations"];
  const prods = (await get(A, "/api/products")).body;
  const list = Array.isArray(prods) ? prods : prods.products;
  for (const p of list.filter((_, i) => i % 40 === 0)) {
    eps.push(`/api/products/${p.slug || p._id}`, `/api/reviews/${p._id}`, `/api/products/related/${p._id}`);
  }
  const cats = (await get(A, "/api/categories")).body;
  for (const c of cats.slice(0, 8)) if (c.slug) eps.push(`/api/categories/${encodeURIComponent(c.slug)}`);

  // warm-up once (products has a 2-min in-memory cache; measure the cold path first)
  const rows = [];
  for (const ep of eps) {
    try {
      const [m, g] = [await get(A, ep), await get(P, ep)];
      const same = m.status === g.status && canonical(m.body) === canonical(g.body);
      rows.push({ ep, mongo: m.ms, pg: g.ms, status: `${m.status}/${g.status}`, same });
    } catch (e) { rows.push({ ep, error: e.message }); }
  }
  for (const r of rows) console.log((r.error ? "ERR " : r.same ? "OK  " : "DIFF") + " " + String(r.mongo ?? "-").padStart(6) + "ms " + String(r.pg ?? "-").padStart(6) + "ms " + (r.status || "") + " " + r.ep.slice(0, 90) + (r.error ? " " + r.error : ""));
  const ok = rows.filter(r => r.same).length;
  const slow = rows.filter(r => r.pg > 3000);
  console.log(`\nSAME ${ok}/${rows.length}; PG>3s: ${slow.length}; PG max ${Math.max(...rows.map(r => r.pg || 0))}ms`);
  require("fs").writeFileSync(B + "/migration-backups/api-parity-timed.json", JSON.stringify(rows, null, 2));
})();
