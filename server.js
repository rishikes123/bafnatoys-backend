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

// ✅ IMPORTANT: correct IP when behind proxy/CDN
app.set("trust proxy", true);

/* ------------------------- SOCKET.IO SERVER SETUP ------------------------- */
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
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
      callback(null, true); // allow all (same as your current)
    },
    credentials: true,
  })
);

/* ------------------------ BODY PARSERS ------------------------------ */
// 🔥 YAHAN LIMIT 50MB KAR DI GAYI HAI MULTIPLE IMAGES KE LIYE
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

/* ------------------------ STATIC FILES ------------------------------- */
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/images", express.static(path.join(__dirname, "images")));

/* ====================================================================
   ✅ INDIA ONLY REMOVED (Now Global Access Enabled)
   ==================================================================== */

/* ------------------------- HEALTH CHECK ----------------------------- */
app.get("/api/test", (_req, res) => {
  res.json({ ok: true, message: "✅ Server Working" });
});

/* --------------------------- API ROUTES ------------------------------ */
// 🔥 IMPORTANT FIX: API Routes MUST come BEFORE the SEO/HTML Catch-all routes
app.use("/api/categories", require("./routes/categoryRoutes"));
app.use("/api/upload", require("./routes/uploadRoutes"));
app.use("/api/products", require("./routes/productRoutes"));
app.use("/api/banners", require("./routes/bannerRoutes"));
app.use("/api/home-config", require("./routes/homeConfigRoutes"));
app.use("/api/auth", require("./routes/auth"));
app.use("/api/admin", require("./routes/adminRoutes"));

// ✅ YEH LINE ADD KI (Register adminAuth route)
app.use("/api/adminAuth", require("./routes/adminAuth")); 

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
app.use("/api/reviews", require("./routes/reviewRoutes")); 
app.use("/api/trust-settings", require("./routes/trustSettingsRoutes")); 

// ✅ NEW ANALYTICS ROUTE ADDED BELOW
app.use("/api/analytics", require("./routes/analytics")); 

// ✅ NEW GRID LAYOUT ROUTE ADDED HERE
app.use("/api/grid-layout", require("./routes/gridLayoutRoutes"));

// ✅ CHATBOT ROUTE ADDED HERE
app.use("/api/chatbot", require("./routes/chatbotRoutes"));

app.use("/", require("./routes/sitemap"));

/* ====================================================================
   ✅ FINAL SEO ROUTE (The Placeholder Method)
   ==================================================================== */
app.get("/product/:id", async (req, res) => {
  const indexPath = path.resolve(__dirname, "../frontend/dist/index.html");

  try {
    const param = req.params.id;
    let product;

    if (param.match(/^[0-9a-fA-F]{24}$/)) {
      product = await Product.findById(param);
    }
    if (!product) {
      product = await Product.findOne({ slug: param });
    }
    if (!product) {
      product = await Product.findOne({ slug: decodeURIComponent(param) });
    }

    let html = fs.readFileSync(indexPath, "utf8");

    let seoTags = "";

    if (product) {
      const title = `${product.name} | Bafna Toys`;
      const rawDesc =
        product.description || `Buy ${product.name} at wholesale prices.`;
      const description = rawDesc
        .replace(/<[^>]*>?/gm, "")
        .substring(0, 150)
        .trim();

      let image = "https://bafnatoys.com/logo.webp";
      if (product.images && product.images.length > 0) {
        const imgPath = product.images[0];
        if (imgPath.startsWith("http")) {
          image = imgPath;
          // 🔥 ImageKit SEO Optimization (Cloudinary removed)
          if (image.includes("ik.imagekit.io")) {
            try {
              const urlParts = new URL(image);
              urlParts.searchParams.set("tr", "w-600,h-600,cm-pad_resize,bg-FFFFFF");
              image = urlParts.toString();
            } catch (e) {
              console.log("Error parsing ImageKit URL for SEO");
            }
          } else if (image.includes("res.cloudinary.com")) {
            // Backup in case any old image was missed
            image = image.replace(
              "/upload/",
              "/upload/w_600,h_600,c_pad,b_white,q_auto/"
            );
          }
        } else {
          const cleanPath = imgPath.replace(/^\/+/, "");
          image = `https://bafnatoys.com/${
            cleanPath.startsWith("uploads/") ? cleanPath : "uploads/" + cleanPath
          }`;
        }
      }

      seoTags = `
        <title>${title}</title>
        <meta name="description" content="${description}" />
        <meta property="og:title" content="${title}" />
        <meta property="og:description" content="${description}" />
        <meta property="og:image" content="${image}" />
        <meta property="og:url" content="https://bafnatoys.com/product/${
          product.slug || product._id
        }" />
        <meta property="og:type" content="product" />
        <meta property="og:site_name" content="Bafna Toys" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="${title}" />
        <meta name="twitter:image" content="${image}" />
      `;
    } else {
      seoTags = `
        <title>Bafna Toys - Wholesale Supplier</title>
        <meta name="description" content="Best Toy Manufacturer in India" />
        <meta property="og:image" content="https://bafnatoys.com/logo.webp" />
        <meta property="og:title" content="Bafna Toys" />
      `;
    }

    // Safe injection:
    if (html.includes("</head>")) {
      html = html.replace("</head>", `${seoTags}\n</head>`);
    } else {
      html = html.replace("<head>", `<head>\n${seoTags}`);
    }

    res.send(html);
  } catch (err) {
    console.error("❌ SEO Injection Error:", err);
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(500).send("Frontend build not found");
    }
  }
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