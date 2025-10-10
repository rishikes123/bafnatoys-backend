const express = require("express");
const router = express.Router();
const Category = require("../models/categoryModel.js");

// 🧠 Helper: Get next order value
const getNextOrder = async () => {
  const last = await Category.findOne().sort({ order: -1 });
  return last ? last.order + 1 : 1;
};

// ✅ Get all categories (sorted by order)
router.get("/", async (req, res) => {
  try {
    const cats = await Category.find().sort({ order: 1 }); // Sorted by order
    res.json(cats);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ✅ Create category (auto order assign)
router.post("/", async (req, res) => {
  try {
    const nextOrder = await getNextOrder();
    const cat = new Category({ name: req.body.name, order: nextOrder });
    await cat.save();
    res.status(201).json(cat);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// ✅ Update category name
router.put("/:id", async (req, res) => {
  try {
    const cat = await Category.findById(req.params.id);
    if (!cat) return res.status(404).json({ message: "Category not found" });

    cat.name = req.body.name;
    await cat.save();
    res.json(cat);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// ✅ Delete category
router.delete("/:id", async (req, res) => {
  try {
    const cat = await Category.findById(req.params.id);
    if (!cat) return res.status(404).json({ message: "Category not found" });

    await cat.deleteOne();
    res.json({ message: "Deleted" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ✅ Move category (up/down)
router.put("/:id/move", async (req, res) => {
  try {
    const { direction } = req.body;
    console.log("🟡 Move request:", req.params.id, direction);

    const current = await Category.findById(req.params.id);
    if (!current) {
      console.log("❌ Category not found");
      return res.status(404).json({ message: "Category not found" });
    }

    console.log("➡️ Current order:", current.order);

    // Find adjacent category dynamically
    const target = await Category.findOne({
      order: direction === "up" ? { $lt: current.order } : { $gt: current.order },
    })
      .sort({ order: direction === "up" ? -1 : 1 })
      .limit(1);

    console.log("🎯 Target found:", target?.name, target?.order);

    if (!target) {
      console.log("⚠️ Already at boundary");
      return res.status(400).json({ message: "Already at boundary" });
    }

    // Swap orders
    const temp = current.order;
    current.order = target.order;
    target.order = temp;

    await current.save();
    await target.save();

    console.log("✅ Swapped:", current.name, "↔", target.name);
    res.json({ message: "Category moved successfully" });
  } catch (error) {
    console.error("🔥 Move category error:", error);
    res.status(500).json({ message: error.message });
  }
});


module.exports = router;
