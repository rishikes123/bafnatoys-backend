require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const connectDB = require("./config/db");
const { notFound, errorHandler } = require("./middleware/errorMiddleware");

const app = express();

/* ------------------------- CONNECT DATABASE ------------------------- */
connectDB();

/* --------------------------- CORS CONFIG ---------------------------- */
const allowedOrigins = [
  process.env.FRONTEND_URL,       // e.g. https://bafnatoys.com
  process.env.ADMIN_URL,          // e.g. https://admin.bafnatoys.com
  "https://bafnatoys.com",        // ensure root domain is allowed
  "https://admin.bafnatoys.com",  // ensure admin subdomain is allowed
  "http://localhost:3000",        // CRA
  "http://localhost:5173",        // Vite
  "http://localhost:8080",
  "http://localhost:8081",
  "http://localhost:8082",
];

// Regex: allow *.vercel.app (preview deployments)
const vercelRegex = /\.vercel\.app$/;

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true); // Postman/curl, server-to-server

      try {
        const hostname = new URL(origin).hostname;

        if (
          allowedOrigins.includes(origin) ||
          vercelRegex.test(hostname) ||
          origin.startsWith("http://localhost:")
        ) {
          callback(null, true);
        } else {
          console.log("❌ CORS blocked:", origin);
          callback(new Error("Not allowed by CORS"));
        }
      } catch (err) {
        callback(new Error("Invalid Origin"));
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

/* --------------------------- ROUTES --------------------------------- */
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
app.use("/api/addresses", require("./routes/addressRoutes")); // ✅ NEW addresses route

// ✅ NEW Sitemap Route (SEO optimization)
app.use("/", require("./routes/sitemap")); // 🌐 Sitemap for Google indexing

/* ------------------------- HEALTH CHECK ----------------------------- */
app.get("/api/test", (_req, res) => {
  res.json({
    ok: true,
    message: "✅ Server is working!",
    timestamp: new Date().toISOString(),
  });
});

/* ----------------------------- ROOT --------------------------------- */
app.get("/", (_req, res) => res.send("🚀 Bafnatoys API running"));

/* ----------------------- ERROR HANDLERS ----------------------------- */
app.use(notFound);
app.use(errorHandler);

/* -------------------------- START SERVER ---------------------------- */
const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
