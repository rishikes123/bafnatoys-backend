const express = require("express");
const router = express.Router();
const GridLayout = require("../models/gridLayoutModel");
const { adminProtect, isAdmin } = require("../middleware/authMiddleware");

// GET: Frontend ke liye (public)
router.get("/", async (req, res) => {
  try {
    let layout = await GridLayout.findOne({});
    if (!layout) {
      layout = await GridLayout.create({ pcColumns: 5, mobileColumns: 2 });
    }
    res.json(layout);
  } catch (error) {
    res.status(500).json({ message: "Error fetching layout" });
  }
});

// PUT: Admin only
router.put("/", adminProtect, isAdmin, async (req, res) => {
  try {
    const { pcColumns, mobileColumns } = req.body;
    let layout = await GridLayout.findOne({});
    if (!layout) layout = new GridLayout();
    if (pcColumns) layout.pcColumns = Number(pcColumns);
    if (mobileColumns) layout.mobileColumns = Number(mobileColumns);
    await layout.save();
    res.json({ message: "Layout updated successfully!", layout });
  } catch (error) {
    res.status(500).json({ message: "Error saving layout" });
  }
});

module.exports = router;
