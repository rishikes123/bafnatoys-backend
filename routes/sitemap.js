const express = require("express");
const router = express.Router();
const Product = require("../models/Product");
const Category = require("../models/categoryModel");

router.get("/sitemap.xml", async (req, res) => {
  try {
    const baseUrl = "https://bafnatoys.com";

    const [products, categories] = await Promise.all([
      Product.find().select("slug name images updatedAt").lean(),
      Category.find().select("name slug updatedAt").lean(),
    ]);

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n`;

    // 🏠 Homepage
    xml += `  <url>
    <loc>${baseUrl}/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>\n`;

    // 🛍️ Static Pages
    const staticPages = [
      { path: "/products",    freq: "daily",   priority: "0.9" },
      { path: "/hot-deals",   freq: "daily",   priority: "0.9" },
      { path: "/categories",  freq: "weekly",  priority: "0.8" },
      { path: "/about",       freq: "monthly", priority: "0.7" },
      { path: "/contact",     freq: "monthly", priority: "0.8" },
      { path: "/privacy-policy",    freq: "monthly", priority: "0.4" },
      { path: "/terms-conditions",  freq: "monthly", priority: "0.4" },
      { path: "/return-policy",     freq: "monthly", priority: "0.4" },
    ];
    staticPages.forEach(({ path, freq, priority }) => {
      xml += `  <url>
    <loc>${baseUrl}${path}</loc>
    <changefreq>${freq}</changefreq>
    <priority>${priority}</priority>
  </url>\n`;
    });

    // 📂 Categories
    categories.forEach((cat) => {
      const slug = cat.slug || cat.name.toLowerCase().replace(/\s+/g, "-");
      const lastmod = cat.updatedAt ? new Date(cat.updatedAt).toISOString() : "";
      xml += `  <url>
    <loc>${baseUrl}/products?category=${encodeURIComponent(slug)}</loc>
    ${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>\n`;
    });

    // 🧸 Products (with image sitemap)
    products.forEach((p) => {
      const slug = p.slug || p._id;
      const lastmod = p.updatedAt ? new Date(p.updatedAt).toISOString() : "";
      let imageTag = "";
      if (p.images && p.images.length > 0) {
        const img = p.images[0];
        const imgUrl = img.startsWith("http") ? img : `${baseUrl}/uploads/${img}`;
        const safeTitle = (p.name || "").replace(/[<>&"]/g, " ");
        imageTag = `
    <image:image>
      <image:loc>${imgUrl}</image:loc>
      <image:title>${safeTitle}</image:title>
    </image:image>`;
      }
      xml += `  <url>
    <loc>${baseUrl}/product/${encodeURIComponent(slug)}</loc>
    ${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>${imageTag}
  </url>\n`;
    });

    xml += `</urlset>`;

    res.setHeader("Content-Type", "application/xml");
    res.setHeader("Cache-Control", "public, max-age=3600"); // 1 hour cache
    res.send(xml);
  } catch (err) {
    console.error("❌ Sitemap generation error:", err);
    res.status(500).send("Sitemap generation failed");
  }
});

module.exports = router;
