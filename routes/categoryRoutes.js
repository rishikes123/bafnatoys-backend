const express = require("express");
const router = express.Router();
const Category = require("../models/categoryModel.js"); 
const cloudinary = require("cloudinary").v2;
const multer = require("multer");
const streamifier = require("streamifier");

const Product = require("../models/Product.js");
const HomeConfig = require("../models/homeConfigModel.js");

// 1️⃣ Cloudinary Config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// 2️⃣ Multer Setup (RAM Storage)
const upload = multer({ storage: multer.memoryStorage() });

// 🧠 Helper: Upload to Cloudinary using Stream
const uploadToCloudinary = (buffer) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder: "categories" },
      (error, result) => {
        if (result) resolve(result);
        else reject(error);
      }
    );
    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
};

// 🧠 Helper: Get next order
const getNextOrder = async () => {
  const last = await Category.findOne().sort({ order: -1 });
  return last ? last.order + 1 : 1;
};

// ==========================================
// ✅ ROUTES START
// ==========================================

// 1. GET All Categories (Menu ke liye)
router.get("/", async (req, res) => {
  try {
    const cats = await Category.find().sort({ order: 1 });
    res.json(cats);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ⭐ 2. GET SINGLE CATEGORY BY SLUG (WITH SMART FILTER & TIMER)
router.get("/:slug", async (req, res) => {
  try {
    const category = await Category.findOne({ slug: req.params.slug });
    if (!category) return res.status(404).json({ message: "Category not found" });

    let products;
    const catNameLower = category.name.toLowerCase().trim();

    // 🧠 SMART FILTER LOGIC: Check if name contains "under" OR is strictly a number ("99")
    const isSmartFilter = catNameLower.includes("under") || /^\d+$/.test(catNameLower);

    if (isSmartFilter) {
      // Name se number nikaalo (e.g., "Under 99" -> 99, "99" -> 99)
      const priceLimit = parseInt(catNameLower.replace(/[^0-9]/g, ""), 10);
      
      if (!isNaN(priceLimit)) {
        // Agar number mil gaya toh price ke base par filter karo
        products = await Product.find({ price: { $lte: priceLimit } })
          .sort({ price: 1 }) // Saste products pehle dikhane ke liye
          .lean();
      } else {
        // Agar number nahi mila toh normal behave karo
        products = await Product.find({ category: category._id }).sort({ order: 1 }).lean();
      }
    } else {
      // Normal Category Logic
      products = await Product.find({ category: category._id }).sort({ order: 1 }).lean();
    }

    const config = await HomeConfig.findOne().lean();
    const dealMap = {};
    
    if (config && config.hotDealsItems) {
      const now = new Date();
      config.hotDealsItems.forEach(item => {
        if (item.enabled && item.productId && item.endsAt) {
          const end = new Date(item.endsAt);
          if (end > now) {
            dealMap[item.productId.toString()] = item.endsAt;
          }
        }
      });
    }

    const productsWithTimer = products.map(p => {
      if (dealMap[p._id.toString()]) {
        return { ...p, sale_end_time: dealMap[p._id.toString()] };
      }
      return p;
    });

    res.json({ category, products: productsWithTimer });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ✅ CREATE Category
router.post("/", upload.single("image"), async (req, res) => {
  try {
    const { name, link } = req.body;
    if (!name) return res.status(400).json({ message: "Category name is required" });
    if (!req.file) return res.status(400).json({ message: "Category image is required" });

    const exists = await Category.findOne({ name });
    if (exists) return res.status(400).json({ message: "Category already exists" });

    const result = await uploadToCloudinary(req.file.buffer);
    const nextOrder = await getNextOrder();
    
    const slug = name.toLowerCase().replace(/ /g, '-').replace(/[^\w-]+/g, '');

    const cat = new Category({
      name,
      slug,
      link: link || "", 
      order: nextOrder,
      image: result.secure_url,
      imageId: result.public_id,
    });

    await cat.save();
    res.status(201).json(cat);
  } catch (error) {
    console.error("Create Error:", error);
    res.status(500).json({ message: error.message });
  }
});

// ✅ UPDATE Category
router.put("/:id", upload.single("image"), async (req, res) => {
  try {
    const cat = await Category.findById(req.params.id);
    if (!cat) return res.status(404).json({ message: "Category not found" });

    if (req.body.name) {
        cat.name = req.body.name;
        cat.slug = req.body.name.toLowerCase().replace(/ /g, '-').replace(/[^\w-]+/g, '');
    }

    if (req.body.link !== undefined) {
        cat.link = req.body.link;
    }

    if (req.file) {
      if (cat.imageId) {
        await cloudinary.uploader.destroy(cat.imageId).catch(() => {});
      }
      const result = await uploadToCloudinary(req.file.buffer);
      cat.image = result.secure_url;
      cat.imageId = result.public_id;
    }

    await cat.save();
    res.json(cat);
  } catch (error) {
    console.error("Update Error:", error);
    res.status(500).json({ message: error.message });
  }
});

// ✅ DELETE Category
router.delete("/:id", async (req, res) => {
  try {
    const cat = await Category.findById(req.params.id);
    if (!cat) return res.status(404).json({ message: "Category not found" });

    if (cat.imageId) {
      await cloudinary.uploader.destroy(cat.imageId).catch(() => {});
    }

    await cat.deleteOne();
    res.json({ message: "Category deleted" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ✅ MOVE Category
router.put("/:id/move", async (req, res) => {
  try {
    const { direction } = req.body;
    const current = await Category.findById(req.params.id);
    if (!current) return res.status(404).json({ message: "Category not found" });

    const target = await Category.findOne({
      order: direction === "up" ? { $lt: current.order } : { $gt: current.order },
    })
      .sort({ order: direction === "up" ? -1 : 1 })
      .limit(1);

    if (!target) return res.status(400).json({ message: "Already at boundary" });

    const temp = current.order;
    current.order = target.order;
    target.order = temp;

    await current.save();
    await target.save();

    res.json({ message: "Category moved successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;