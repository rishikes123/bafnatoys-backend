require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const connectDB = require("./config/db");
const { notFound, errorHandler } = require("./middleware/errorMiddleware");

const app = express();

// DB connect
connectDB();

// CORS
app.use(
  cors({
    origin: process.env.FRONTEND_URL
      ? [process.env.FRONTEND_URL, "http://localhost:8082", "http://localhost:8081", "http://localhost:3000"]
      : "*",
    credentials: true,
  })
);

// Body parsers
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

// Static assets
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/images", express.static(path.join(__dirname, "images")));

// Routes
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

// Error handlers
app.use(notFound);
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
