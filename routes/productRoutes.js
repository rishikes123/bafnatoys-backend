// backend/routes/productRoutes.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

// ---------------- Schema ----------------
const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    sku: { type: String, required: true, unique: true, trim: true }, // 🔑 SKU should be unique
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
    taxFields: {
      type: [String], // e.g. ["GST", "IGST"]
      default: [],
    },
  },
  { timestamps: true }
);

const Product =
  mongoose.models.Product || mongoose.model("Product", productSchema);

// ---------------- Routes ----------------

// GET all products
router.get("/", async (_req, res) => {
  try {
    const prods = await Product.find().populate("category");
    res.json(prods);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch products" });
  }
});

// GET one product
router.get("/:id", async (req, res) => {
  try {
    const prod = await Product.findById(req.params.id).populate("category");
    if (!prod) return res.status(404).json({ message: "Product not found" });
    res.json(prod);
  } catch (err) {
    res.status(400).json({ message: "Invalid product ID" });
  }
});

// CREATE product
router.post("/", async (req, res) => {
  try {
    const prod = new Product(req.body); // taxFields + bulkPricing included
    await prod.save();
    res.status(201).json(prod);
  } catch (err) {
    res.status(400).json({ message: err.message || "Failed to create product" });
  }
});

// UPDATE product
router.put("/:id", async (req, res) => {
  try {
    const prod = await Product.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!prod) return res.status(404).json({ message: "Product not found" });
    res.json(prod);
  } catch (err) {
    res.status(400).json({ message: err.message || "Failed to update product" });
  }
});

// DELETE product
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
