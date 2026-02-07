const express = require("express");
const router = express.Router();
const Category = require("../models/categoryModel.js"); // File path check kar lena
const cloudinary = require("cloudinary").v2;
const multer = require("multer");
const streamifier = require("streamifier");

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
      { folder: "categories" }, // Cloudinary folder name
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

// ✅ GET All Categories
router.get("/", async (req, res) => {
  try {
    const cats = await Category.find().sort({ order: 1 });
    res.json(cats);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ✅ CREATE Category (With Image)
router.post("/", upload.single("image"), async (req, res) => {
  try {
    const { name } = req.body;

    // Validation
    if (!name) return res.status(400).json({ message: "Category name is required" });
    if (!req.file) return res.status(400).json({ message: "Category image is required" });

    // 1. Check duplicate
    const exists = await Category.findOne({ name });
    if (exists) return res.status(400).json({ message: "Category already exists" });

    // 2. Upload Image
    const result = await uploadToCloudinary(req.file.buffer);

    // 3. Create in DB
    const nextOrder = await getNextOrder();
    const cat = new Category({
      name,
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

    // Name Update
    if (req.body.name) cat.name = req.body.name;

    // Image Update (Agar nayi file aayi hai)
    if (req.file) {
      // Old image delete karein
      if (cat.imageId) {
        await cloudinary.uploader.destroy(cat.imageId).catch(() => {});
      }
      
      // New image upload karein
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

    // Cloudinary se image delete karein
    if (cat.imageId) {
      await cloudinary.uploader.destroy(cat.imageId).catch(() => {});
    }

    // Database se delete karein
    await cat.deleteOne();
    res.json({ message: "Category deleted" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ✅ MOVE Category (Order Swap)
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

    // Swap
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