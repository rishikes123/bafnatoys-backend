const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Category = require("../models/categoryModel.js");
const cloudinary = require("../config/cloudinary");
const multer = require("multer");

// 🧠 Multer setup (for image upload)
const storage = multer.memoryStorage();
const upload = multer({ storage });

/* ------------------------------------------------------------------
📦 Product Schema (with auto order increment)
------------------------------------------------------------------ */
const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    sku: { type: String, required: true, unique: true, trim: true },
    price: { type: Number, default: 0 },
    description: { type: String, trim: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: "Category" },
    images: [{ type: String }],
    bulkPricing: [
      {
        inner: String,
        qty: { type: Number, min: 1 },
        price: { type: Number, min: 0 },
      },
    ],
    taxFields: { type: [String], default: [] },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

/* ------------------------------------------------------------------
✨ Auto Increment Order Before Save
------------------------------------------------------------------ */
productSchema.pre("save", async function (next) {
  if (this.isNew) {
    try {
      // Find last order in same category
      const last = await mongoose
        .model("Product")
        .findOne({ category: this.category })
        .sort({ order: -1 });
      this.order = last ? last.order + 1 : 1;
    } catch (err) {
      console.error("Error setting product order:", err);
    }
  }
  next();
});

const Product =
  mongoose.models.Product || mongoose.model("Product", productSchema);

/* ------------------------------------------------------------------
✅ GET all products (sorted by order)
------------------------------------------------------------------ */
router.get("/", async (_req, res) => {
  try {
    const products = await Product.find()
      .populate("category")
      .sort({ order: 1 });
    res.json(products);
  } catch (err) {
    console.error("❌ Fetch error:", err);
    res.status(500).json({ message: "Failed to fetch products" });
  }
});

/* ------------------------------------------------------------------
✅ GET single product
------------------------------------------------------------------ */
router.get("/:id", async (req, res) => {
  try {
    const prod = await Product.findById(req.params.id).populate("category");
    if (!prod) return res.status(404).json({ message: "Product not found" });
    res.json(prod);
  } catch (err) {
    console.error("❌ Single fetch error:", err);
    res.status(400).json({ message: "Invalid product ID" });
  }
});

/* ------------------------------------------------------------------
✅ CREATE product (with Cloudinary upload)
------------------------------------------------------------------ */
router.post("/", upload.array("images", 5), async (req, res) => {
  try {
    let imageUrls = [];

    // 🖼️ Upload all images to Cloudinary
    if (req.files?.length > 0) {
      for (const file of req.files) {
        const result = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: "bafnatoys/products" },
            (error, result) => (error ? reject(error) : resolve(result))
          );
          stream.end(file.buffer);
        });
        imageUrls.push(result.secure_url);
      }
    }

    const prod = new Product({ ...req.body, images: imageUrls });
    await prod.save();
    console.log("✅ Product created:", prod.name);
    res.status(201).json(prod);
  } catch (err) {
    console.error("❌ Create error:", err);
    res
      .status(400)
      .json({ message: err.message || "Failed to create product" });
  }
});

/* ------------------------------------------------------------------
✅ UPDATE product (with Cloudinary upload)
------------------------------------------------------------------ */
router.put("/:id", upload.array("images", 5), async (req, res) => {
  try {
    let updateData = { ...req.body };

    // 🖼️ Upload new images if present
    if (req.files?.length > 0) {
      const uploaded = [];
      for (const file of req.files) {
        const result = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: "bafnatoys/products" },
            (error, result) => (error ? reject(error) : resolve(result))
          );
          stream.end(file.buffer);
        });
        uploaded.push(result.secure_url);
      }
      updateData.images = uploaded;
    }

    const prod = await Product.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
    });

    if (!prod) return res.status(404).json({ message: "Product not found" });

    console.log("✅ Product updated:", prod.name);
    res.json(prod);
  } catch (err) {
    console.error("❌ Update error:", err);
    res
      .status(400)
      .json({ message: err.message || "Failed to update product" });
  }
});

/* ------------------------------------------------------------------
✅ DELETE product
------------------------------------------------------------------ */
router.delete("/:id", async (req, res) => {
  try {
    const prod = await Product.findByIdAndDelete(req.params.id);
    if (!prod) return res.status(404).json({ message: "Product not found" });

    console.log("🗑️ Deleted product:", prod.name);
    res.json({ message: "Product deleted successfully" });
  } catch (err) {
    console.error("❌ Delete error:", err);
    res.status(400).json({ message: "Invalid product ID" });
  }
});

/* ------------------------------------------------------------------
✅ REORDER PRODUCTS (Bulk drag/drop)
------------------------------------------------------------------ */
router.put("/reorder", async (req, res) => {
  try {
    const { products } = req.body;
    if (!Array.isArray(products) || products.length === 0)
      return res.status(400).json({ message: "Invalid data format" });

    const bulkOps = products.map((item) => ({
      updateOne: {
        filter: { _id: item._id },
        update: { $set: { order: item.order } },
      },
    }));

    await Product.bulkWrite(bulkOps);
    console.log("✅ Product order updated successfully!");
    res.json({ ok: true, message: "Product order updated successfully!" });
  } catch (err) {
    console.error("❌ Reorder error:", err);
    res.status(500).json({ message: "Failed to reorder products" });
  }
});

/* ------------------------------------------------------------------
✅ MOVE PRODUCT UP / DOWN (Within Same Category, Auto Reindex)
------------------------------------------------------------------ */
router.put("/:id/move", async (req, res) => {
  try {
    const { direction } = req.body;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ message: "Invalid product ID" });

    const product = await Product.findById(id);
    if (!product) return res.status(404).json({ message: "Product not found" });

    const categoryId = product.category;

    // 🧠 Get all products from the same category
    let products = await Product.find({ category: categoryId }).sort({ order: 1 });
    const index = products.findIndex((p) => p._id.toString() === id.toString());

    if (index === -1)
      return res.status(400).json({ message: "Product not found in category" });

    // 🚫 Prevent moving outside bounds
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= products.length)
      return res.status(400).json({ message: "Already at boundary" });

    // 🔄 Swap in-memory
    [products[index], products[swapIndex]] = [products[swapIndex], products[index]];

    // 🔢 Reassign clean order numbers (1 → N)
    for (let i = 0; i < products.length; i++) {
      products[i].order = i + 1;
      await products[i].save();
    }

    const updatedCategoryProducts = await Product.find({ category: categoryId })
      .sort({ order: 1 })
      .populate("category");

    console.log(`✅ Product moved ${direction} within category: ${product.name}`);
    res.json({
      ok: true,
      message: `Product moved ${direction} successfully within category!`,
      updatedCategoryProducts,
    });
  } catch (err) {
    console.error("❌ Move product error:", err);
    res.status(500).json({ message: "Failed to move product" });
  }
});

module.exports = router;
