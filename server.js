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
      // console.log("❌ CORS blocked:", origin); // Optional logging
      callback(null, true); // Allow to prevent blocking bots
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
   ✅ FINAL SEO ROUTE (Handles IDs + Slugs + Cloudinary)
   ==================================================================== */
app.get("/product/:id", async (req, res) => {
  const indexPath = path.resolve(__dirname, "../frontend/dist/index.html");

  try {
    const param = req.params.id;
    let product;

    // 🔍 STEP 1: Determine if 'id' is a MongoDB ID or a Slug
    if (param.match(/^[0-9a-fA-F]{24}$/)) {
      // It looks like an ID, try finding by ID
      product = await Product.findById(param);
    } 
    
    // If not found by ID (or it wasn't an ID), try finding by Slug
    if (!product) {
      product = await Product.findOne({ slug: param });
    }

    // Fallback: Try decoded slug (handles %20 spaces)
    if (!product) {
      product = await Product.findOne({ slug: decodeURIComponent(param) });
    }

    // Read index.html
    let html = fs.readFileSync(indexPath, "utf8");

    if (product) {
      // 📝 STEP 2: Prepare Data
      const title = `${product.name} | Bafna Toys`;
      const rawDesc = product.description || `Buy ${product.name} at wholesale prices from Bafna Toys.`;
      // Clean HTML tags and limit length
      const description = rawDesc.replace(/<[^>]*>?/gm, "").substring(0, 150).trim();

      // 🖼️ STEP 3: Image Logic
      let image = "https://bafnatoys.com/logo.webp"; // Default

      if (product.images && product.images.length > 0) {
        const imgPath = product.images[0];

        if (imgPath.startsWith("http")) {
          image = imgPath;
          // Cloudinary Optimization for WhatsApp (Square 600px)
          if (image.includes("res.cloudinary.com")) {
             image = image.replace("/upload/", "/upload/w_600,h_600,c_pad,b_white,q_auto/");
          }
        } else {
          // Local Upload Support
          const cleanPath = imgPath.replace(/^\/+/, "");
          image = `https://bafnatoys.com/${cleanPath.startsWith("uploads/") ? cleanPath : "uploads/" + cleanPath}`;
        }
      }

      // 🔄 STEP 4: Replace Meta Tags using Global Regex
      
      // Replace Title
      html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`);

      // Replace Description
      html = html.replace(/name="description" content="[\s\S]*?"/gi, `name="description" content="${description}"`);
      html = html.replace(/property="og:description" content="[\s\S]*?"/gi, `property="og:description" content="${description}"`);
      html = html.replace(/name="twitter:description" content="[\s\S]*?"/gi, `name="twitter:description" content="${description}"`);

      // Replace Image
      html = html.replace(/property="og:image" content="[\s\S]*?"/gi, `property="og:image" content="${image}"`);
      html = html.replace(/name="twitter:image" content="[\s\S]*?"/gi, `name="twitter:image" content="${image}"`);
      
      // Force replace specific default logo URL just in case
      html = html.replace("https://bafnatoys.com/logo.webp", image);

      // Replace URL & Title Meta
      html = html.replace(/property="og:url" content="[\s\S]*?"/gi, `property="og:url" content="https://bafnatoys.com/product/${product.slug || product._id}"`);
      html = html.replace(/property="og:title" content="[\s\S]*?"/gi, `property="og:title" content="${title}"`);
      html = html.replace(/name="twitter:title" content="[\s\S]*?"/gi, `name="twitter:title" content="${title}"`);
    }

    res.send(html);

  } catch (err) {
    console.error("❌ SEO Injection Error:", err);
    // Return default HTML on error so site still loads
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