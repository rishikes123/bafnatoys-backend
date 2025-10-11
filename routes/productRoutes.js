const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const slugify = require("slugify");
const Category = require("../models/categoryModel.js");
const cloudinary = require("../config/cloudinary");
const multer = require("multer");

// 🧠 Multer setup
const storage = multer.memoryStorage();
const upload = multer({ storage });

/* ------------------------------------------------------------------
📦 Product Schema (with related products)
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
    slug: { type: String, unique: true, trim: true },

    // ✅ Related Products field (manual select)
    relatedProducts: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
  },
  { timestamps: true }
);

/* ------------------------------------------------------------------
✨ Auto Slug + Order Before Save
------------------------------------------------------------------ */
productSchema.pre("save", async function (next) {
  try {
    if (this.isModified("name") || !this.slug) {
      this.slug = slugify(this.name, { lower: true, strict: true });
    }

    if (this.isNew) {
      const last = await mongoose
        .model("Product")
        .findOne({ category: this.category })
        .sort({ order: -1 });
      this.order = last ? last.order + 1 : 1;
    }

    next();
  } catch (err) {
    console.error("Error in pre-save:", err);
    next(err);
  }
});

const Product =
  mongoose.models.Product || mongoose.model("Product", productSchema);

/* ------------------------------------------------------------------
✅ GET all products (with category name)
------------------------------------------------------------------ */
router.get("/", async (_req, res) => {
  try {
    const products = await Product.find()
      .populate("category", "name") // ✅ only name of category
      .sort({ order: 1 });
    res.json(products);
  } catch (err) {
    console.error("❌ Fetch error:", err);
    res.status(500).json({ message: "Failed to fetch products" });
  }
});

/* ------------------------------------------------------------------
✅ GET single product by slug or ID (with related + category)
------------------------------------------------------------------ */
router.get("/:slugOrId", async (req, res) => {
  try {
    const { slugOrId } = req.params;
    const query = mongoose.Types.ObjectId.isValid(slugOrId)
      ? { _id: slugOrId }
      : { slug: slugOrId };

    const prod = await Product.findOne(query)
      .populate("category", "name") // ✅ show category name
      .populate({
        path: "relatedProducts",
        populate: { path: "category", select: "name" }, // ✅ show related category name
      });

    if (!prod) return res.status(404).json({ message: "Product not found" });

    res.json(prod);
  } catch (err) {
    console.error("❌ Single fetch error:", err);
    res.status(400).json({ message: "Invalid product ID or slug" });
  }
});

/* ------------------------------------------------------------------
✅ CREATE product (with Cloudinary upload)
------------------------------------------------------------------ */
router.post("/", upload.array("images", 5), async (req, res) => {
  try {
    let imageUrls = [];

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

    const slug = slugify(req.body.name, { lower: true, strict: true });

    const prod = new Product({
      ...req.body,
      images: imageUrls,
      slug,
      relatedProducts: req.body.relatedProducts || [],
    });

    await prod.save();
    console.log("✅ Product created:", prod.name);
    res.status(201).json(prod);
  } catch (err) {
    console.error("❌ Create error:", err);
    res.status(400).json({ message: err.message || "Failed to create product" });
  }
});

/* ------------------------------------------------------------------
✅ UPDATE product (with Cloudinary upload)
------------------------------------------------------------------ */
router.put("/:id", upload.array("images", 5), async (req, res) => {
  try {
    let updateData = { ...req.body };

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

    if (updateData.name) {
      updateData.slug = slugify(updateData.name, { lower: true, strict: true });
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
    res.status(400).json({ message: err.message || "Failed to update product" });
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
✅ REORDER PRODUCTS
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
✅ MOVE PRODUCT UP / DOWN
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
    let products = await Product.find({ category: categoryId }).sort({ order: 1 });
    const index = products.findIndex((p) => p._id.toString() === id.toString());

    if (index === -1)
      return res.status(400).json({ message: "Product not found in category" });

    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= products.length)
      return res.status(400).json({ message: "Already at boundary" });

    [products[index], products[swapIndex]] = [products[swapIndex], products[index]];

    for (let i = 0; i < products.length; i++) {
      products[i].order = i + 1;
      await products[i].save();
    }

    const updatedCategoryProducts = await Product.find({ category: categoryId })
      .sort({ order: 1 })
      .populate("category", "name");

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

/* ------------------------------------------------------------------
✨ AUTO-RELATED PRODUCTS (same category)
------------------------------------------------------------------ */
router.get("/:id/related", async (req, res) => {
  try {
    const prod = await Product.findById(req.params.id);
    if (!prod) return res.status(404).json({ message: "Product not found" });

    const related = await Product.find({
      category: prod.category,
      _id: { $ne: prod._id },
    })
      .limit(6)
      .populate("category", "name"); // ✅ show related category name

    res.json(related);
  } catch (err) {
    console.error("❌ Related fetch error:", err);
    res.status(500).json({ message: "Failed to fetch related products" });
  }
});

module.exports = router;
