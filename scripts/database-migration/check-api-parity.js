"use strict";

require("dotenv").config();
const fs = require("node:fs/promises");
const jwt = require("jsonwebtoken");
const { canonical } = require("../../database/postgres/codec");

const source = process.argv[2] || "http://localhost:5001";
const target = process.argv[3] || "http://localhost:5002";
const reportFile = process.argv[4] || "migration-backups/api-parity.json";
const token = jwt.sign({ isEnvAdmin: true, username: "migration-read-only-check", role: "superadmin" }, process.env.JWT_SECRET, { expiresIn: "15m" });

async function get(base, endpoint) {
  const response = await fetch(base + endpoint, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const endpoints = ["/api/categories", "/api/products", "/api/banners", "/api/home-config", "/api/grid-layout", "/api/trust-settings", "/api/discount-rules", "/api/custom-boxes", "/api/settings/cod", "/api/settings/shipping", "/api/settings/reviews", "/api/blogs", "/api/orders?limit=200", "/api/orders/analytics/top-selling", "/api/admin/customers?limit=100", "/api/reviews/all/list"];
  const categories = await get(source, "/api/categories");
  for (const category of categories) if (category.slug) endpoints.push(`/api/categories/${encodeURIComponent(category.slug)}`);
  const products = await get(source, "/api/products");
  const list = Array.isArray(products) ? products : products.products;
  for (const product of list.slice(0, 5)) {
    endpoints.push(`/api/products/${product.slug || product._id}`);
    endpoints.push(`/api/reviews/${product._id}`);
  }
  const report = [];
  for (const endpoint of endpoints) {
    try {
      const [left, right] = await Promise.all([get(source, endpoint), get(target, endpoint)]);
      const match = canonical(left) === canonical(right);
      report.push({ endpoint, match, sourceBytes: JSON.stringify(left).length, targetBytes: JSON.stringify(right).length });
      console.log(`${match ? "MATCH" : "DIFFERENT"} ${endpoint}`);
    } catch (error) { report.push({ endpoint, match: false, error: error.message }); console.log(`FAIL ${endpoint}: ${error.message}`); }
  }
  await fs.writeFile(reportFile, JSON.stringify({ source, target, checkedAt: new Date().toISOString(), report }, null, 2));
  const failures = report.filter(row => !row.match).length;
  console.log(`API comparison: ${report.length - failures}/${report.length} matched`);
  if (failures) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
