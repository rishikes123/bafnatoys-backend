const express = require("express");
const router = express.Router();
const Product = require("../models/Product");
const Category = require("../models/categoryModel");

router.get("/sitemap.xml", async (req, res) => {
  try {
    const baseUrl = "https://bafnatoys.com"; // ⚙️ apni live URL yaha daal

    // 🧩 Fetch all products and categories
    const [products, categories] = await Promise.all([
      Product.find().select("slug updatedAt"),
      Category.find().select("name updatedAt"),
    ]);

    // 🧠 XML header
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

    // 🏠 Homepage
    xml += `
      <url>
        <loc>${baseUrl}</loc>
        <changefreq>daily</changefreq>
        <priority>1.0</priority>
      </url>
    `;

    // 📂 Categories
    categories.forEach((cat) => {
      const slug = cat.name.toLowerCase().replace(/\s+/g, "-");
      xml += `
        <url>
          <loc>${baseUrl}/products?category=${encodeURIComponent(slug)}</loc>
          <lastmod>${cat.updatedAt.toISOString()}</lastmod>
          <changefreq>weekly</changefreq>
          <priority>0.8</priority>
        </url>
      `;
    });

    // 🧸 Products
    products.forEach((p) => {
      const slug = p.slug || p._id; // fallback if slug missing
      xml += `
        <url>
          <loc>${baseUrl}/product/${encodeURIComponent(slug)}</loc>
          <lastmod>${p.updatedAt.toISOString()}</lastmod>
          <changefreq>weekly</changefreq>
          <priority>0.9</priority>
        </url>
      `;
    });

    // 👇 Close sitemap
    xml += `</urlset>`;

    // ✅ Set correct content type
    res.header("Content-Type", "application/xml");
    res.send(xml);
  } catch (err) {
    console.error("❌ Sitemap generation error:", err);
    res.status(500).send("Sitemap generation failed");
  }
});

module.exports = router;
