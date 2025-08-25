require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const connectDB = require("./config/db");
const { notFound, errorHandler } = require("./middleware/errorMiddleware");

const app = express();

// ✅ Connect DB
connectDB();

// ✅ CORS Setup
const allowedOrigins = [
  process.env.FRONTEND_URL,         // production frontend from .env
  "http://localhost:3000",          // CRA default
  "http://localhost:5173",          // Vite default
  "http://localhost:8080",
  "http://localhost:8081",
  "http://localhost:8082",
];

// Regex: allow all *.vercel.app subdomains
const vercelRegex = /\.vercel\.app$/;

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true); // Postman / curl

      // ✅ Allow: listed origins, vercel subdomains, OR localhost:any
      if (
        allowedOrigins.includes(origin) ||
        vercelRegex.test(origin) ||
        origin.startsWith("http://localhost:")
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

// ✅ Body parsers
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ✅ Static assets (if you still keep local uploads)
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/images", express.static(path.join(__dirname, "images")));

// ✅ Routes
app.use("/api/categories", require("./routes/categoryRoutes"));
app.use("/api/upload", require("./routes/uploadRoutes")); // 👉 Cloudinary integrated
app.use("/api/products", require("./routes/productRoutes"));
app.use("/api/banners", require("./routes/bannerRoutes"));
app.use("/api/auth", require("./routes/auth"));
app.use("/api/admin", require("./routes/adminRoutes"));
app.use("/api/registrations", require("./routes/registrationRoutes"));
app.use("/api/orders", require("./routes/orderRoutes"));
app.use("/api/whatsapp", require("./routes/whatsappRoutes"));

// ✅ Health check
app.get("/api/test", (_req, res) => {
  res.json({
    ok: true,
    message: "✅ Server is working!",
    timestamp: new Date().toISOString(),
  });
});

// ✅ Root
app.get("/", (_req, res) => res.send("🚀 Bafnatoys API running"));

// ✅ Error handlers
app.use(notFound);
app.use(errorHandler);

// ✅ Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
