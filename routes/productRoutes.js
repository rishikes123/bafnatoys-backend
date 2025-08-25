const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Category = require("../models/categoryModel.js");
const cloudinary = require("../config/cloudinary");
const multer = require("multer");

const storage = multer.memoryStorage();
const upload = multer({ storage });

// ---------------- Schema ----------------
const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    sku: { type: String, required: true, unique: true, trim: true },
    price: { type: Number, default: 0 },
    description: { type: String, trim: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: "Category" },
    images: [{ type: String }], // ✅ Cloudinary URLs
    bulkPricing: [
      {
        inner: String,
        qty: { type: Number, min: 1 },
        price: { type: Number, min: 0 },
      },
    ],
    taxFields: { type: [String], default: [] },
  },
  { timestamps: true }
);

const Product =
  mongoose.models.Product || mongoose.model("Product", productSchema);

// ---------------- Routes ----------------

// ✅ GET all products
router.get("/", async (_req, res) => {
  try {
    const prods = await Product.find().populate("category");
    res.json(prods);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch products" });
  }
});

// ✅ GET one product
router.get("/:id", async (req, res) => {
  try {
    const prod = await Product.findById(req.params.id).populate("category");
    if (!prod) return res.status(404).json({ message: "Product not found" });
    res.json(prod);
  } catch (err) {
    res.status(400).json({ message: "Invalid product ID" });
  }
});

// ✅ CREATE product (with Cloudinary upload)
router.post("/", upload.array("images", 5), async (req, res) => {
  try {
    let imageUrls = [];

    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const result = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: "bafnatoys/products" },
            (error, result) => {
              if (error) reject(error);
              else resolve(result);
            }
          );
          stream.end(file.buffer);
        });

        imageUrls.push(result.secure_url);
      }
    }

    if (req.body.images && Array.isArray(req.body.images)) {
      imageUrls = [...imageUrls, ...req.body.images];
    }

    const prod = new Product({
      ...req.body,
      images: imageUrls,
    });

    await prod.save();
    res.status(201).json(prod);
  } catch (err) {
    console.error("❌ Create error:", err);
    res.status(400).json({ message: err.message || "Failed to create product" });
  }
});

// ✅ UPDATE product (with Cloudinary upload)
router.put("/:id", upload.array("images", 5), async (req, res) => {
  try {
    let updateData = { ...req.body };

    if (req.files && req.files.length > 0) {
      const uploadedImages = [];
      for (const file of req.files) {
        const result = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: "bafnatoys/products" },
            (error, result) => {
              if (error) reject(error);
              else resolve(result);
            }
          );
          stream.end(file.buffer);
        });
        uploadedImages.push(result.secure_url);
      }
      updateData.images = uploadedImages;
    }

    const prod = await Product.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
    });

    if (!prod) return res.status(404).json({ message: "Product not found" });
    res.json(prod);
  } catch (err) {
    console.error("❌ Update error:", err);
    res.status(400).json({ message: err.message || "Failed to update product" });
  }
});

// ✅ DELETE product
router.delete("/:id", async (req, res) => {
  try {
    const prod = await Product.findByIdAndDelete(req.params.id);
    if (!prod) return res.status(404).json({ message: "Product not found" });
    res.json({ message: "Product deleted" });
  } catch (err) {
    res.status(400).json({ message: "Invalid product ID" });
  }
});

module.exports = router;
