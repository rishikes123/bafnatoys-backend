require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const connectDB = require("./config/db");
const { notFound, errorHandler } = require("./middleware/errorMiddleware");
const Product = require("./models/Product");

const app = express();

/* ------------------------- CONNECT DATABASE ------------------------- */
connectDB();

/* --------------------------- CORS CONFIG ---------------------------- */
const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.ADMIN_URL,
  "https://bafnatoys.com",
  "https://admin.bafnatoys.com",
  "http://localhost:3000",
  "http://localhost:5173",
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);

      if (
        allowedOrigins.some((o) => origin && origin.startsWith(o)) ||
        origin.includes("localhost")
      ) {
        callback(null, true);
      } else {
        console.log("❌ CORS blocked:", origin);
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

/* ------------------------ BODY PARSERS ------------------------------ */
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

/* ------------------------ STATIC FILES ------------------------------- */
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/images", express.static(path.join(__dirname, "images")));

/* ====================================================================
   ✅ FINAL SEO + WHATSAPP PREVIEW ROUTE
   ==================================================================== */
app.get("/product/:id", async (req, res) => {
  // Point to frontend build index.html
  const indexPath = path.resolve(__dirname, "../frontend/dist/index.html");

  try {
    const product = await Product.findById(req.params.id);
    
    // Read the index.html file
    let html = fs.readFileSync(indexPath, "utf8");

    if (product) {
      const title = `${product.name} | Bafna Toys`;
      const description = product.description
        ? product.description.substring(0, 150)
        : `Buy ${product.name} at wholesale prices`;

      // ✅ IMAGE MUST BE PUBLIC & HTTPS
      let image = "https://bafnatoys.com/logo.webp";

      if (product.images && product.images.length > 0) {
        const img = product.images[0];
        image = img.startsWith("http")
          ? img
          : `https://bafnatoys.com/${img.replace(/^\/+/, "")}`;
      }

      // Inject Meta Tags for SEO/WhatsApp
      html = html
        .replace(/<title>.*<\/title>/, `<title>${title}</title>`)
        .replace(
          "</head>",
          `
            <meta property="og:site_name" content="Bafna Toys" />
            <meta property="og:title" content="${title}" />
            <meta property="og:description" content="${description}" />
            <meta property="og:image" content="${image}" />
            <meta property="og:image:width" content="600" />
            <meta property="og:image:height" content="600" />
            <meta property="og:type" content="product" />
            <meta property="og:url" content="https://bafnatoys.com/product/${product._id}" />
            <meta name="twitter:card" content="summary_large_image" />
            <meta name="twitter:image" content="${image}" />
            </head>`
        );
    }

    res.send(html);
  } catch (err) {
    console.error("❌ SEO / OG ERROR:", err);
    // Fallback to normal index.html if error
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(500).send("Server Error: Frontend build not found");
    }
  }
});

/* --------------------------- API ROUTES ------------------------------ */
app.use("/api/categories", require("./routes/categoryRoutes"));
app.use("/api/upload", require("./routes/uploadRoutes"));
app.use("/api/products", require("./routes/productRoutes"));
app.use("/api/banners", require("./routes/bannerRoutes"));
app.use("/api/auth", require("./routes/auth"));
app.use("/api/admin", require("./routes/adminRoutes"));
app.use("/api/registrations", require("./routes/registrationRoutes"));
app.use("/api/orders", require("./routes/orderRoutes"));
app.use("/api/whatsapp", require("./routes/whatsappRoutes"));
app.use("/api/otp", require("./routes/otpRoutes"));
app.use("/api/addresses", require("./routes/addressRoutes"));
app.use("/api/settings", require("./routes/settingsRoutes"));
app.use("/api/shipping-rules", require("./routes/settings"));
app.use("/api/shipping", require("./routes/shippingRoutes"));
app.use("/api/payments", require("./routes/paymentRoutes"));
app.use("/api/discount-rules", require("./routes/discountRoutes"));

// ✅ NEW: Traffic Analytics Route
app.use("/api/analytics", require("./routes/analyticsRoutes"));

app.use("/", require("./routes/sitemap"));

/* ------------------------- HEALTH CHECK ----------------------------- */
app.get("/api/test", (_req, res) => {
  res.json({ ok: true, message: "✅ Server Working" });
});

/* ------------------------- FRONTEND SERVE ---------------------------- */
// Serve static assets from frontend build
app.use(express.static(path.join(__dirname, "../frontend/dist")));

// Handle React Routing, return index.html for all unknown routes
app.get("*", (req, res) => {
  const indexFile = path.resolve(__dirname, "../frontend/dist/index.html");
  if (fs.existsSync(indexFile)) {
      res.sendFile(indexFile);
  } else {
      res.status(404).send("Frontend build not found. Please run 'npm run build' in frontend folder.");
  }
});

/* ----------------------- ERROR HANDLERS ------------------------------ */
app.use(notFound);
app.use(errorHandler);

/* -------------------------- START SERVER ----------------------------- */
const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});