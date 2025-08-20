require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

// DB
const connectDB = require("./config/db");
connectDB();

// Middlewares
const { notFound, errorHandler } = require("./middleware/errorMiddleware");

const app = express();

/* ---------- Core middleware ---------- */
app.use(
  cors({
    origin: [
      "http://localhost:8082", // customer frontend (local)
      "http://localhost:8081", // admin panel (local)
      "http://localhost:3000", // vite local
      process.env.FRONTEND_URL || "" // ✅ deployed frontend
    ],
    credentials: true,
  })
);

// Body parsers
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

// Static assets
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/images", express.static(path.join(__dirname, "images")));

/* ---------- Routes ---------- */
app.use("/api/categories", require("./routes/categoryRoutes"));
app.use("/api/upload", require("./routes/uploadRoutes"));
app.use("/api/products", require("./routes/productRoutes"));
app.use("/api/banners", require("./routes/bannerRoutes"));
app.use("/api/auth", require("./routes/auth"));
app.use("/api/admin", require("./routes/adminRoutes"));
app.use("/api/registrations", require("./routes/registrationRoutes"));
app.use("/api/orders", require("./routes/orderRoutes"));
app.use("/api/whatsapp", require("./routes/whatsappRoutes"));

// Health check
app.get("/api/test", (_req, res) => {
  res.json({ ok: true, message: "✅ Server is working!", timestamp: new Date().toISOString() });
});

// Root
app.get("/", (_req, res) => res.send("Bafnatoys API running"));

/* ---------- Error handlers ---------- */
app.use(notFound);
app.use(errorHandler);

/* ---------- Start ---------- */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
