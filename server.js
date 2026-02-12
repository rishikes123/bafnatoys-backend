require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const http = require("http");
const { Server } = require("socket.io");
const connectDB = require("./config/db");
const { notFound, errorHandler } = require("./middleware/errorMiddleware");
const Product = require("./models/Product");

const app = express();

/* ------------------------- SOCKET.IO SERVER SETUP ------------------------- */
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

let onlineUsersCount = 0;

io.on("connection", (socket) => {
  onlineUsersCount++;
  io.emit("updateUserCount", onlineUsersCount);

  socket.on("disconnect", () => {
    onlineUsersCount = Math.max(0, onlineUsersCount - 1);
    io.emit("updateUserCount", onlineUsersCount);
  });
});

/* ------------------------- CONNECT DATABASE ------------------------- */
connectDB();

/* --------------------------- CORS CONFIG ---------------------------- */
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (
        origin.includes("localhost") ||
        origin.endsWith(".vercel.app") ||
        origin.endsWith("bafnatoys.com")
      ) {
        return callback(null, true);
      }
      console.log("❌ CORS blocked:", origin);
      callback(new Error("Not allowed by CORS"));
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
   ✅ FINAL SEO ROUTE (Cloudinary Optimized)
   ==================================================================== */
app.get("/product/:id", async (req, res) => {
  const indexPath = path.resolve(__dirname, "../frontend/dist/index.html");

  try {
    const product = await Product.findById(req.params.id);
    let html = fs.readFileSync(indexPath, "utf8");

    if (product) {
      // 1. Title & Description
      const title = `${product.name} | Bafna Toys`;
      // Clean HTML tags from description if any exist
      const rawDesc = product.description || `Buy ${product.name} at wholesale prices.`;
      const description = rawDesc.replace(/<[^>]*>?/gm, "").substring(0, 150).trim();

      // 2. Image Logic (Cloudinary Support)
      let image = "https://bafnatoys.com/logo.webp"; // Default Fallback

      if (product.images && product.images.length > 0) {
        const imgPath = product.images[0];

        if (imgPath.startsWith("http")) {
          // ✅ Case 1: Cloudinary URL
          image = imgPath;

          // OPTIMIZATION: Resize for WhatsApp (600x600, padded, white background)
          // This ensures the whole toy is visible in the square preview
          if (image.includes("res.cloudinary.com")) {
             image = image.replace("/upload/", "/upload/w_600,h_600,c_pad,b_white,q_auto/");
          }

        } else {
          // ✅ Case 2: Local Upload (Legacy support)
          // Remove leading slashes just in case
          const cleanPath = imgPath.replace(/^\/+/, "");
          if (cleanPath.startsWith("uploads/")) {
             image = `https://bafnatoys.com/${cleanPath}`;
          } else {
             image = `https://bafnatoys.com/uploads/${cleanPath}`;
          }
        }
      }

      // 3. META TAG REPLACEMENT (Regex to overwrite default index.html tags)
      
      // Replace Title
      html = html.replace(/<title>.*?<\/title>/, `<title>${title}</title>`);

      // Replace Description
      html = html.replace(/name="description" content=".*?"/g, `name="description" content="${description}"`);
      html = html.replace(/property="og:description" content=".*?"/g, `property="og:description" content="${description}"`);
      html = html.replace(/name="twitter:description" content=".*?"/g, `name="twitter:description" content="${description}"`);

      // Replace Image (Targeting specific OG tags)
      html = html.replace(/property="og:image" content=".*?"/g, `property="og:image" content="${image}"`);
      html = html.replace(/name="twitter:image" content=".*?"/g, `name="twitter:image" content="${image}"`);
      
      // Also specifically replace the default logo URL if hardcoded
      html = html.replace(/content="https:\/\/bafnatoys\.com\/logo\.webp"/g, `content="${image}"`);

      // Update URL
      html = html.replace(/property="og:url" content=".*?"/g, `property="og:url" content="https://bafnatoys.com/product/${product._id}"`);
      
      // Update Title Meta
      html = html.replace(/property="og:title" content=".*?"/g, `property="og:title" content="${title}"`);
      html = html.replace(/name="twitter:title" content=".*?"/g, `name="twitter:title" content="${title}"`);
    }

    res.send(html);
  } catch (err) {
    console.error("❌ SEO Injection Error:", err);
    // Fallback if something fails
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(500).send("Frontend build not found");
    }
  }
});

/* --------------------------- API ROUTES ------------------------------ */
app.use("/api/categories", require("./routes/categoryRoutes"));
app.use("/api/upload", require("./routes/uploadRoutes"));
app.use("/api/products", require("./routes/productRoutes"));
app.use("/api/banners", require("./routes/bannerRoutes"));
app.use("/api/home-config", require("./routes/homeConfigRoutes"));
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
app.use("/api/analytics", require("./routes/analyticsRoutes"));
app.use("/", require("./routes/sitemap"));

/* ------------------------- HEALTH CHECK ----------------------------- */
app.get("/api/test", (_req, res) => {
  res.json({ ok: true, message: "✅ Server Working" });
});

/* ------------------------- FRONTEND SERVE ---------------------------- */
app.use(express.static(path.join(__dirname, "../frontend/dist")));

app.get("*", (req, res) => {
  const indexFile = path.resolve(__dirname, "../frontend/dist/index.html");
  fs.existsSync(indexFile)
    ? res.sendFile(indexFile)
    : res.status(404).send("Frontend build not found");
});

/* ----------------------- ERROR HANDLERS ------------------------------ */
app.use(notFound);
app.use(errorHandler);

/* -------------------------- START SERVER ----------------------------- */
const PORT = process.env.PORT || 5000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT} with Real-time Sockets`);
});