const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

// Product Schema with SKU + taxFields!
const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  sku: { type: String, required: true, trim: true }, // SKU field, required
  price: Number,
  description: String,
  category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
  images: [String],
  bulkPricing: [{
    inner: String,
    qty: Number,
    price: Number,
  }],
  taxFields: {               // ⭐️⭐️⭐️ ADD THIS FIELD!
    type: [String],
    default: []
  },
}, { timestamps: true });

const Product = mongoose.models.Product || mongoose.model('Product', productSchema);

// Get all products
router.get('/', async (req, res) => {
  try {
    const prods = await Product.find().populate('category');
    res.json(prods);
  } catch (e) {
    res.status(500).json({ message: "Failed to fetch products" });
  }
});

// Get one product by ID
router.get('/:id', async (req, res) => {
  try {
    const prod = await Product.findById(req.params.id).populate('category');
    if (!prod) return res.status(404).json({ message: "Product not found" });
    res.json(prod);
  } catch (e) {
    res.status(404).json({ message: "Product not found" });
  }
});

// Create product
router.post('/', async (req, res) => {
  try {
    const prod = new Product(req.body);   // taxFields aa jayega agar payload me hai!
    await prod.save();
    res.status(201).json(prod);
  } catch (e) {
    res.status(400).json({ message: e.message || "Failed to create product" });
  }
});

// Update product
router.put('/:id', async (req, res) => {
  try {
    const prod = await Product.findByIdAndUpdate(
      req.params.id,
      req.body,         // taxFields update ho jayega agar payload me hai!
      { new: true, runValidators: true }
    );
    if (!prod) return res.status(404).json({ message: "Product not found" });
    res.json(prod);
  } catch (e) {
    res.status(400).json({ message: e.message || "Failed to update product" });
  }
});

// Delete product
router.delete('/:id', async (req, res) => {
  try {
    const prod = await Product.findByIdAndDelete(req.params.id);
    if (!prod) return res.status(404).json({ message: "Product not found" });
    res.json({ message: "Deleted" });
  } catch (e) {
    res.status(404).json({ message: "Product not found" });
  }
});

module.exports = router;
