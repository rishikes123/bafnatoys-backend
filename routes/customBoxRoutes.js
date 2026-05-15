const express = require("express");
const router = express.Router();
const CustomBox = require("../models/customBoxModel");
const { adminProtect, isAdmin } = require("../middleware/authMiddleware");

// GET all custom boxes (admin only)
router.get("/", adminProtect, async (req, res) => {
  try {
    const boxes = await CustomBox.find({ isActive: true }).sort({ createdAt: -1 });
    res.json(boxes);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST create new custom box
router.post("/", adminProtect, isAdmin, async (req, res) => {
  try {
    const { name, length, breadth, height } = req.body;
    if (!name || !length || !breadth || !height) {
      return res.status(400).json({ message: "Sab fields required hain" });
    }
    const box = new CustomBox({ name, length, breadth, height });
    const saved = await box.save();
    res.status(201).json(saved);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// PUT update
router.put("/:id", adminProtect, isAdmin, async (req, res) => {
  try {
    const box = await CustomBox.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!box) return res.status(404).json({ message: "Box not found" });
    res.json(box);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// DELETE
router.delete("/:id", adminProtect, isAdmin, async (req, res) => {
  try {
    await CustomBox.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
